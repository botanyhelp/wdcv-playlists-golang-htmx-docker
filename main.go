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

// parseCSVStream parses CSV rows from a reader into Tracks and a set of Shows.
func parseCSVStream(r io.Reader) ([]Track, map[string]struct{}, error) {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1 // Allow variable columns if empty cells exist

	header, err := reader.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read header: %w", err)
	}

	timeIdx := 0
	artistIdx := 1
	titleIdx := 2
	showIdx := 3
	featuredIdx := 4

	for i, h := range header {
		cleanH := strings.ToLower(strings.TrimSpace(h))
		if strings.Contains(cleanH, "time") || strings.Contains(cleanH, "date") {
			timeIdx = i
		} else if strings.Contains(cleanH, "artist") {
			artistIdx = i
		} else if strings.Contains(cleanH, "title") || strings.Contains(cleanH, "song") {
			titleIdx = i
		} else if strings.Contains(cleanH, "show") || strings.Contains(cleanH, "program") {
			showIdx = i
		} else if strings.Contains(cleanH, "feature") || strings.Contains(cleanH, "rotation") || strings.Contains(cleanH, "heavy") {
			featuredIdx = i
		}
	}

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

		if show != "" {
			showSet[strings.TrimSpace(show)] = struct{}{}
		}

		tracks = append(tracks, Track{
			Timestamp:  parsedTime,
			Artist:     artist,
			Title:      title,
			ShowName:   strings.TrimSpace(show),
			IsFeatured: featured,
		})
	}

	return tracks, showSet, nil
}

// FetchRemote loads show names strictly from the first tab (gid=0) and all tracks across all tabs.
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
		tracks, showSet, err := parseCSVStream(resp.Body)
		if err != nil {
			return err
		}
		var shows []string
		for s := range showSet {
			if s != "" {
				shows = append(shows, s)
			}
		}
		sort.Strings(shows)

		ds.Lock()
		ds.Tracks = tracks
		ds.Shows = shows
		ds.LastUpdated = time.Now()
		ds.Unlock()
		return nil
	}

	// 1. Fetch gid=0 specifically for clean, recent show dropdown
	exportURL0 := fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/export?format=csv&gid=0", spreadsheetID)
	resp0, err := http.Get(exportURL0)
	var recentShows []string
	if err == nil && resp0.StatusCode == http.StatusOK {
		_, showSet0, err := parseCSVStream(resp0.Body)
		resp0.Body.Close()
		if err == nil {
			for s := range showSet0 {
				if s != "" {
					recentShows = append(recentShows, s)
				}
			}
			sort.Strings(recentShows)
		}
	}

	// 2. Fetch all tabs for full historical tracks
	gids := DiscoverGIDs(spreadsheetID)
	log.Printf("Fetching %d tab(s) for spreadsheet ID %s: %v", len(gids), spreadsheetID, gids)

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

	// If recentShows is empty, fallback to shows from all tracks
	if len(recentShows) == 0 {
		showSetAll := make(map[string]struct{})
		for _, tr := range allTracks {
			if tr.ShowName != "" {
				showSetAll[tr.ShowName] = struct{}{}
			}
		}
		for s := range showSetAll {
			recentShows = append(recentShows, s)
		}
		sort.Strings(recentShows)
	}

	ds.Lock()
	ds.Tracks = allTracks
	ds.Shows = recentShows
	ds.LastUpdated = time.Now()
	ds.Unlock()

	log.Printf("Successfully loaded %d total tracks across %d tabs with %d clean shows from first tab.", len(allTracks), len(gids), len(recentShows))
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
