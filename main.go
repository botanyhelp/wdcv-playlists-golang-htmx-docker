package main

import (
	"embed"
	"encoding/csv"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed templates/*
var templateFS embed.FS

var (
	templates *template.Template
	store     *DataStore
)

const PageSize = 50

// Authoritative list of show names provided by the user
var officialShowsList = []string{
	"Alden", "All Roads", "alphabet soup", "Amana Bacon Radio Show", "aux on air", "Aux on Air", "bananapants", "Bell Bottom Blues", "BIOHAZARD", "Blue Hour", "Buckit!", "Canadian Tuxedo", "Carnation Station", "cellular", "cellular!", "Cranberry Juice", "Cranberry Juice!", "Curtain Call", "danielles punk rock hour!", "danielles punk rock hour! ", "day vixian", "DJ Joe George presents DIG!", "Dolly Parton Tribute Hour", "Ella Melrose Training #2", "El-on-Air", "El-On-Air", "Encore!", "etcetera...", "Etcetera...", "Etcetera... ", "Fake Tunes", "Fletcher Brown", "Goblin Tar Pit", "Hyperfix-statin", "hYPERFIX-STATION", "Hyperfix-station", "Hyperfix-station ", "Hyperfix-Station", "Hyperpopower", "inside elia's mind", "inside elias mind", "Inside elia's mind", "Internatinal Our", "International our", "International Our", "Internayional Our", "Jacksons Jams", "James Hicks", "James Hicks show", "James Hicks Show", "knox aux", "knox on aux", "Knox on Aux", "KONKRETE", "Ladybug Spots", "livewire", "live with liv", "Loose Ends", "Lounging with Lily ", "Margaret", "Margaret Nelson", "Marigold", "mayas magic hour", "mayas magic hr", "Mayas Magic Hr", "mini mamdani's", "Mini Mamdani's", "Mini Mamdani's ", "miscellaneous", "Must Be Hearing in On Things", "Must be Hearing Things", "Must Be hearing Things", "Must Be Hearing Things", "Must Be HEaring things", "MUST BE HEARING THINGS", "My Cup of Jo", "My Cup of JO", "Nico", "Nico & Fletch pre o", "Nico & Fletch Pre o", "No name #3", "No Name #3", "opening act", "opening act (+ training)", "Oskar's Training Session 2", "Oskar's Variety Hour", "Oxygen", "pre o", "pre o ", "Queen of Soup", "Record Rewind", "Record Rewind ", "Ryan 2nd Training ", "Ryan Second Training ", "Ryan Training", "Ryan Training ", "Sarah R", "Sarah R.", "scarlette & becky", "scarlette & becky's show", "science fiction/double feature", "Show Name", "Showtimes Showcase", "Showtunes", "Showtune Showcase", "Sierra's Sunshine Hour", "songs after the storm", "Spotlight on Sinatra", "SUBJECT TO CHANGE", "supasonic", "Swan Songs", "take a walk", "Take a Walk", "Take A Walk", "Talk A Walk", "taxikab", "taxikab!", "That's What You Missed", "the aud hour", "The Bronze", "The Crossroads", "The drift", "The Drift", "The Drift ", "The Eclipse", "The Flo", "The Flo ", "The Industry Punks", "The Radio of Kullerluk City (ROKC)", "The Radio of Kullerluk City (ROKC) ", "The ROKC", "The Space Station", "The Spirit of Radio", "The Spirit of Radio ", "The Testers", "The Tests", "Tilly Tunes", "Time", "Timeout", "time to claire the air", "Tucker's Radio Hour", "Tucker's Radio Hour ", "xnox on aux",
}

type Track struct {
	Timestamp  time.Time
	Artist     string
	Title      string
	ShowName   string
	IsFeatured bool
}

type FilterResult struct {
	Tracks      []Track
	TotalCount  int
	CurrentPage int
	TotalPages  int
	HasNext     bool
	HasPrev     bool
	NextPage    int
	PrevPage    int
}

type DataStore struct {
	sync.RWMutex
	Tracks      []Track
	Shows       []string
	LastUpdated time.Time
	SourceURL   string
}

func NewDataStore(sourceURL string) *DataStore {
	return &DataStore{
		SourceURL: sourceURL,
	}
}

// ExtractSpreadsheetID extracts the Google Sheets ID from various URL formats.
func ExtractSpreadsheetID(rawURL string) string {
	re := regexp.MustCompile(`/spreadsheets/d/([a-zA-Z0-9-_]+)`)
	matches := re.FindStringSubmatch(rawURL)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// DiscoverGIDs fetches pubhtml and htmlview pages of the Google Sheet, extracts all tab gids, and honors SHEET_GIDS env var.
func DiscoverGIDs(spreadsheetID string) []string {
	urls := []string{
		fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/pubhtml", spreadsheetID),
		fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/htmlview", spreadsheetID),
	}

	seen := make(map[string]bool)
	seen["0"] = true
	var gids []string
	gids = append(gids, "0")

	for _, u := range urls {
		resp, err := http.Get(u)
		if err != nil {
			continue
		}
		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}
		htmlStr := string(bodyBytes)

		patterns := []string{
			`gid=([0-9]+)`,
			`"gid"\s*:\s*"?([0-9]+)"?`,
			`sheetId["']?\s*:\s*"?([0-9]+)"?`,
			`id=["']sheet-button-([0-9]+)["']`,
			`data-sheet-id=["']?([0-9]+)["']?`,
		}

		for _, pat := range patterns {
			re := regexp.MustCompile(pat)
			matches := re.FindAllStringSubmatch(htmlStr, -1)
			for _, m := range matches {
				if len(m) > 1 {
					gid := m[1]
					if !seen[gid] {
						seen[gid] = true
						gids = append(gids, gid)
					}
				}
			}
		}
	}

	if envGids := os.Getenv("SHEET_GIDS"); envGids != "" {
		for _, g := range strings.Split(envGids, ",") {
			g = strings.TrimSpace(g)
			if g != "" && !seen[g] {
				seen[g] = true
				gids = append(gids, g)
			}
		}
	}

	log.Printf("Discovered total %d unique tab gid(s) for spreadsheet %s: %v", len(gids), spreadsheetID, gids)
	return gids
}

// normalizeShowKey creates a normalized key for grouping typo variants, casing, and spacing.
func normalizeShowKey(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.TrimPrefix(s, "the ")
	re := regexp.MustCompile(`[^a-z0-9]`)
	return re.ReplaceAllString(s, "")
}

// unifyShowNames groups similar show names (typos, casing, leading "The") and maps them to a single canonical display name.
func unifyShowNames(tracks []Track) []Track {
	rawCounts := make(map[string]int)
	for _, tr := range tracks {
		cleaned := strings.TrimSpace(tr.ShowName)
		if cleaned != "" && !strings.EqualFold(cleaned, "show name") {
			rawCounts[cleaned]++
		}
	}

	keyToRaws := make(map[string][]string)
	for raw := range rawCounts {
		key := normalizeShowKey(raw)
		keyToRaws[key] = append(keyToRaws[key], raw)
	}

	canonicalMap := make(map[string]string)
	for _, raws := range keyToRaws {
		bestRaw := raws[0]
		maxCount := rawCounts[bestRaw]
		for _, r := range raws {
			if rawCounts[r] > maxCount {
				bestRaw = r
				maxCount = rawCounts[r]
			} else if rawCounts[r] == maxCount {
				if len(r) > len(bestRaw) {
					bestRaw = r
				}
			}
		}
		for _, r := range raws {
			canonicalMap[r] = bestRaw
		}
	}

	for i := range tracks {
		cleaned := strings.TrimSpace(tracks[i].ShowName)
		if canonical, exists := canonicalMap[cleaned]; exists {
			tracks[i].ShowName = canonical
		}
	}

	return tracks
}

// parseCSVStream parses CSV rows using strict fixed column layout:
// Col A (0): Timestamp, Col B (1): Artist, Col C (2): Song Title, Col D (3): Show Name, Col E (4): Heavy Rotation
func parseCSVStream(r io.Reader) ([]Track, map[string]struct{}, error) {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1

	// Read and discard header
	_, err := reader.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read header: %w", err)
	}

	timeIdx := 0
	artistIdx := 1
	titleIdx := 2
	showIdx := 3
	featuredIdx := 4

	var tracks []Track
	showSet := make(map[string]struct{})

	timeFormats := []string{
		"1/2/2006 15:04:05",
		"01/02/2006 15:04:05",
		"1/2/2006 15:04",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05Z",
		"1/2/06 15:04",
		"1/2/06",
		"2006-01-02",
	}

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		rawTime := ""
		if timeIdx < len(row) {
			rawTime = strings.TrimSpace(row[timeIdx])
		}
		artist := ""
		if artistIdx < len(row) {
			artist = strings.TrimSpace(row[artistIdx])
		}
		title := ""
		if titleIdx < len(row) {
			title = strings.TrimSpace(row[titleIdx])
		}
		show := ""
		if showIdx < len(row) {
			show = strings.TrimSpace(row[showIdx])
		}

		// Skip header rows accidentally repeated in data
		if strings.EqualFold(show, "show name") || strings.EqualFold(show, "show") || strings.EqualFold(artist, "artist") {
			continue
		}

		featured := false
		if featuredIdx < len(row) && (strings.EqualFold(strings.TrimSpace(row[featuredIdx]), "yes") || strings.EqualFold(strings.TrimSpace(row[featuredIdx]), "true") || strings.EqualFold(strings.TrimSpace(row[featuredIdx]), "1")) {
			featured = true
		}

		var parsedTime time.Time
		for _, layout := range timeFormats {
			if t, err := time.Parse(layout, rawTime); err == nil {
				parsedTime = t
				break
			}
		}

		cleanedShow := strings.TrimSpace(show)
		if cleanedShow != "" {
			showSet[cleanedShow] = struct{}{}
		}

		tracks = append(tracks, Track{
			Timestamp:  parsedTime,
			Artist:     artist,
			Title:      title,
			ShowName:   cleanedShow,
			IsFeatured: featured,
		})
	}

	return tracks, showSet, nil
}

// FetchRemote loads show names using the official user-provided show list + first tab Column D, unified.
func (ds *DataStore) FetchRemote() error {
	if ds.SourceURL == "" {
		return fmt.Errorf("no SourceURL configured")
	}

	spreadsheetID := ExtractSpreadsheetID(ds.SourceURL)
	if spreadsheetID == "" {
		resp, err := http.Get(ds.SourceURL)
		if err != nil {
			return fmt.Errorf("HTTP get failed: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
		}
		tracks, _, err := parseCSVStream(resp.Body)
		if err != nil {
			return err
		}
		tracks = unifyShowNames(tracks)
		showSet := make(map[string]struct{})
		for _, tr := range tracks {
			if tr.ShowName != "" && !strings.EqualFold(tr.ShowName, "show name") {
				showSet[tr.ShowName] = struct{}{}
			}
		}
		var shows []string
		for s := range showSet {
			shows = append(shows, s)
		}
		sort.Strings(shows)

		ds.Lock()
		ds.Tracks = tracks
		ds.Shows = shows
		ds.LastUpdated = time.Now()
		ds.Unlock()
		return nil
	}

	gids := DiscoverGIDs(spreadsheetID)
	log.Printf("Fetching %d tab(s) for spreadsheet ID %s: %v", len(gids), spreadsheetID, gids)

	showTrackPool := []Track{}
	for _, s := range officialShowsList {
		if s != "" && !strings.EqualFold(s, "show name") {
			showTrackPool = append(showTrackPool, Track{ShowName: s})
		}
	}

	exportURL0 := fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/export?format=csv&gid=0", spreadsheetID)
	resp0, err := http.Get(exportURL0)
	if err == nil && resp0.StatusCode == http.StatusOK {
		tracks0, _, err := parseCSVStream(resp0.Body)
		resp0.Body.Close()
		if err == nil {
			showTrackPool = append(showTrackPool, tracks0...)
		}
	}

	showTrackPool = unifyShowNames(showTrackPool)
	showSetUnique := make(map[string]struct{})
	for _, tr := range showTrackPool {
		if tr.ShowName != "" && !strings.EqualFold(tr.ShowName, "show name") {
			showSetUnique[tr.ShowName] = struct{}{}
		}
	}
	var canonicalShows []string
	for s := range showSetUnique {
		canonicalShows = append(canonicalShows, s)
	}
	sort.Strings(canonicalShows)

	var wg sync.WaitGroup
	var mu sync.Mutex
	var allTracks []Track

	for _, gid := range gids {
		wg.Add(1)
		go func(g string) {
			defer wg.Done()
			exportURL := fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/export?format=csv&gid=%s", spreadsheetID, g)
			resp, err := http.Get(exportURL)
			if err != nil {
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				return
			}

			tracks, _, err := parseCSVStream(resp.Body)
			if err != nil {
				return
			}

			mu.Lock()
			allTracks = append(allTracks, tracks...)
			mu.Unlock()
		}(gid)
	}
	wg.Wait()

	if len(allTracks) == 0 {
		return fmt.Errorf("no tracks successfully loaded from any tab")
	}

	allTracks = unifyShowNames(allTracks)

	ds.Lock()
	ds.Tracks = allTracks
	ds.Shows = canonicalShows
	ds.LastUpdated = time.Now()
	ds.Unlock()

	log.Printf("Successfully loaded %d total tracks across %d tabs with %d unified clean shows in dropdown.", len(allTracks), len(gids), len(canonicalShows))
	return nil
}

func (ds *DataStore) Filter(show, songRegex, fromDate, toDate string, featuredOnly bool, page int) FilterResult {
	ds.RLock()
	defer ds.RUnlock()

	var compiledRegex *regexp.Regexp
	if songRegex != "" {
		compiledRegex, _ = regexp.Compile("(?i)" + songRegex)
	}

	var startT, endT time.Time
	if fromDate != "" {
		startT, _ = time.Parse("2006-01-02", fromDate)
	}
	if toDate != "" {
		if t, err := time.Parse("2006-01-02", toDate); err == nil {
			endT = t.Add(24 * time.Hour)
		}
	}

	var matched []Track
	for _, tr := range ds.Tracks {
		if show != "" && tr.ShowName != show {
			continue
		}
		if featuredOnly && !tr.IsFeatured {
			continue
		}
		if compiledRegex != nil && !compiledRegex.MatchString(tr.Title) && !compiledRegex.MatchString(tr.Artist) {
			continue
		}
		if !startT.IsZero() && tr.Timestamp.Before(startT) {
			continue
		}
		if !endT.IsZero() && tr.Timestamp.After(endT) {
			continue
		}
		matched = append(matched, tr)
	}

	totalCount := len(matched)
	totalPages := (totalCount + PageSize - 1) / PageSize
	if totalPages < 1 {
		totalPages = 1
	}
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}

	startIdx := (page - 1) * PageSize
	endIdx := startIdx + PageSize
	if startIdx > totalCount {
		startIdx = totalCount
	}
	if endIdx > totalCount {
		endIdx = totalCount
	}

	pagedTracks := matched[startIdx:endIdx]

	return FilterResult{
		Tracks:      pagedTracks,
		TotalCount:  totalCount,
		CurrentPage: page,
		TotalPages:  totalPages,
		HasNext:     page < totalPages,
		HasPrev:     page > 1,
		NextPage:    page + 1,
		PrevPage:    page - 1,
	}
}

func main() {
	var err error
	templates, err = template.ParseFS(templateFS, "templates/*.html")
	if err != nil {
		log.Fatalf("Template parsing failed: %v", err)
	}

	sheetURL := os.Getenv("SHEET_CSV_URL")
	store = NewDataStore(sheetURL)

	if sheetURL != "" {
		log.Printf("Fetching initial multi-tab playlist from Google Docs...")
		if err := store.FetchRemote(); err != nil {
			log.Printf("Warning: failed initial fetch: %v", err)
		}
	} else {
		log.Println("Notice: SHEET_CSV_URL not set. Use the refresh button or set the environment variable.")
	}

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/tracks", handleFilterTracks)
	http.HandleFunc("/refresh", handleRefresh)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server listening on :%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	store.RLock()
	data := struct {
		Shows       []string
		LastUpdated string
		Result      FilterResult
	}{
		Shows:       store.Shows,
		LastUpdated: store.LastUpdated.Format("Jan 02, 2006 15:04:05 MST"),
		Result:      store.Filter("", "", "", "", false, 1),
	}
	store.RUnlock()

	templates.ExecuteTemplate(w, "index.html", data)
}

func handleFilterTracks(w http.ResponseWriter, r *http.Request) {
	state_code := r.URL.Query().Get("show")
	_ = state_code
	show := r.URL.Query().Get("show")
	regex := r.URL.Query().Get("regex")
	fromDate := r.URL.Query().Get("from")
	toDate := r.URL.Query().Get("to")
	featured := r.URL.Query().Get("featured") == "on"

	page := 1
	if pStr := r.URL.Query().Get("page"); pStr != "" {
		if p, err := strconv.Atoi(pStr); err == nil {
			page = p
		}
	}

	result := store.Filter(show, regex, fromDate, toDate, featured, page)
	templates.ExecuteTemplate(w, "track_rows.html", result)
}

func handleRefresh(w http.ResponseWriter, r *http.Request) {
	if err := store.FetchRemote(); err != nil {
		http.Error(w, fmt.Sprintf("Refresh failed: %v", err), http.StatusInternalServerError)
		return
	}
	handleIndex(w, r)
}
