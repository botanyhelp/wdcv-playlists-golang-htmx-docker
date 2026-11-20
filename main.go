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
	Timestamp   time.Time
	Artist      string
	Title       string
	ShowName    string
	IsFeatured  bool
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

// LoadFromCSV reads CSV data and populates memory.
func (ds *DataStore) LoadFromCSV(r io.Reader) error {
	reader := csv.NewReader(r)
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1 // Allow variable columns if empty cells exist

	// Read header
	_, err := reader.Read()
	if err != nil {
		return fmt.Errorf("failed to read header: %w", err)
	}

	var tracks []Track
	showSet := make(map[string]struct{})

	// Supported date formats
	timeFormats := []string{
		"1/2/2006 15:04:05",
		"01/02/2006 15:04:05",
		"1/2/2006 15:04",
		"2006-01-02 15:04:05",
	}

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil || len(row) < 4 {
			continue
		}

		rawTime := strings.TrimSpace(row[0])
		artist := strings.TrimSpace(row[1])
		title := strings.TrimSpace(row[2])
		show := strings.TrimSpace(row[3])
		featured := false
		if len(row) >= 5 && strings.EqualFold(strings.TrimSpace(row[4]), "yes") {
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

	// Extract unique shows sorted alphabetically
	shows := make([]string, 0, len(showSet))
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

func (ds *DataStore) FetchRemote() error {
	if ds.SourceURL == "" {
		return fmt.Errorf("no SourceURL configured")
	}

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

func (ds *DataStore) Filter(show, songRegex, fromDate, toDate string, featuredOnly bool) []Track {
	ds.RLock()
	defer ds.RUnlock()

	var compiledRegex *regexp.Regexp
	if songRegex != "" {
		// Case-insensitive regex
		compiledRegex, _ = regexp.Compile("(?i)" + songRegex)
	}

	var startT, endT time.Time
	if fromDate != "" {
		startT, _ = time.Parse("2006-01-02", fromDate)
	}
	if toDate != "" {
		if t, err := time.Parse("2006-01-02", toDate); err == nil {
			endT = t.Add(24 * time.Hour) // Include full end day
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
	// 1. Compile embedded templates
	var err error
	templates, err = template.ParseFS(templateFS, "templates/*.html")
	if err != nil {
		log.Fatalf("Template parsing failed: %v", err)
	}

	// 2. Setup Google Sheet CSV URL from Environment Variable
	sheetURL := os.Getenv("SHEET_CSV_URL")
	store = NewDataStore(sheetURL)

	if sheetURL != "" {
		log.Printf("Fetching initial playlist from Google Docs...")
		if err := store.FetchRemote(); err != nil {
			log.Printf("Warning: failed initial fetch: %v", err)
		}
	} else {
		log.Println("Notice: SHEET_CSV_URL not set. Use the refresh button or set the environment variable.")
	}

	// 3. Routing
	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/tracks", handleFilterTracks)
	http.HandleFunc("/refresh", handleRefresh)

	// 4. Start Server (respecting GCP Cloud Run $PORT)
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
