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

type Track struct {
	Timestamp  time.Time
	Artist     string
	Title      string
	ShowName   string
	IsFeatured bool
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

// DiscoverGIDs fetches the htmlview page of the Google Sheet and extracts all tab gids.
func DiscoverGIDs(spreadsheetID string) []string {
	htmlURL := fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/htmlview", spreadsheetID)
	resp, err := http.Get(htmlURL)
	if err != nil {
		return []string{"0"}
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return []string{"0"}
	}
	htmlStr := string(bodyBytes)

	// Find all gid=... occurrences
	re := regexp.MustCompile(`gid=([0-9]+)`)
	matches := re.FindAllStringSubmatch(htmlStr, -1)

	seen := make(map[string]bool)
	var gids []string
	seen["0"] = true
	gids = append(gids, "0")

	for _, m := range matches {
		if len(m) > 1 {
			gid := m[1]
			if !seen[gid] {
				seen[gid] = true
				gids = append(gids, gid)
			}
		}
	}

	return gids
}

// parseCSVStream parses CSV rows from a reader into Tracks and a set of Shows.
func parseCSVStream(r io.Reader) ([]Track, map[string]struct{}, error) {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1 // Allow variable columns if empty cells exist

	// Read header
	header, err := reader.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read header: %w", err)
	}

	// Default indices based on standard layout
	timeIdx := 0
	artistIdx := 1
	titleIdx := 2
	showIdx := 3
	featuredIdx := 4

	// Map headers case-insensitively to support sheets with extra columns (e.g. State, Location)
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

	// Supported date formats
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
			showSet[show] = struct{}{}
		}

		tracks = append(tracks, Track{
			Timestamp:  parsedTime,
			Artist:     artist,
			Title:      title,
			ShowName:   show,
			IsFeatured: featured,
		})
	}

	return tracks, showSet, nil
}

// LoadFromCSV reads CSV data and populates memory.
func (ds *DataStore) LoadFromCSV(r io.Reader) error {
	tracks, showSet, err := parseCSVStream(r)
	if err != nil {
		return err
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

// FetchRemote automatically discovers all tabs (gids) in a Google Sheet and fetches them concurrently.
func (ds *DataStore) FetchRemote() error {
	if ds.SourceURL == "" {
		return fmt.Errorf("no SourceURL configured")
	}

	spreadsheetID := ExtractSpreadsheetID(ds.SourceURL)
	if spreadsheetID == "" {
		// Fallback for direct non-Google-Sheet URLs
		resp, err := http.Get(ds.SourceURL)
		if err != nil {
			return fmt.Errorf("HTTP get failed: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
		}
		return ds.LoadFromCSV(resp.Body)
	}

	gids := DiscoverGIDs(spreadsheetID)
	log.Printf("Discovered %d tab(s) for spreadsheet ID %s: %v", len(gids), spreadsheetID, gids)

	var wg sync.WaitGroup
	var mu sync.Mutex
	var allTracks []Track
	showSet := make(map[string]struct{})

	for _, gid := range gids {
		wg.Add(1)
		go func(g string) {
			defer wg.Done()
			exportURL := fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/export?format=csv&gid=%s", spreadsheetID, g)
			resp, err := http.Get(exportURL)
			if err != nil {
				log.Printf("Failed to fetch gid %s: %v", g, err)
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				log.Printf("Non-200 status for gid %s: %d", g, resp.StatusCode)
				return
			}

			tracks, shows, err := parseCSVStream(resp.Body)
			if err != nil {
				log.Printf("Failed to parse CSV for gid %s: %v", g, err)
				return
			}

			mu.Lock()
			allTracks = append(allTracks, tracks...)
			for s := range shows {
				showSet[s] = struct{}{}
			}
			mu.Unlock()
		}(gid)
	}
	wg.Wait()

	if len(allTracks) == 0 {
		return fmt.Errorf("no tracks successfully loaded from any tab")
	}

	var shows []string
	for s := range showSet {
		shows = append(shows, s)
	}
	sort.Strings(shows)

	ds.Lock()
	ds.Tracks = allTracks
	ds.Shows = shows
	ds.LastUpdated = time.Now()
	ds.Unlock()

	log.Printf("Successfully loaded %d total tracks across %d tabs and %d shows.", len(allTracks), len(gids), len(shows))
	return nil
}

func (ds *DataStore) Filter(show, songRegex, fromDate, toDate string, featuredOnly bool) []Track {
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

	var results []Track
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
		results = append(results, tr)
	}

	return results
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
		Tracks      []Track
		LastUpdated string
	}{
		Shows:       store.Shows,
		Tracks:      store.Tracks,
		LastUpdated: store.LastUpdated.Format("Jan 02, 2006 15:04:05 MST"),
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

	filtered := store.Filter(show, regex, fromDate, toDate, featured)
	templates.ExecuteTemplate(w, "track_rows.html", filtered)
}

func handleRefresh(w http.ResponseWriter, r *http.Request) {
	if err := store.FetchRemote(); err != nil {
		http.Error(w, fmt.Sprintf("Refresh failed: %v", err), http.StatusInternalServerError)
		return
	}
	handleIndex(w, r)
}
