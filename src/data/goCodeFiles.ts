import { CodeFile } from '../types';

export const GO_CODE_FILES: CodeFile[] = [
  {
    filename: 'go.mod',
    path: 'go.mod',
    language: 'go',
    description: 'Go module definition (zero third-party dependencies required)',
    content: `module playlist-app

go 1.22
`,
  },
  {
    filename: 'main.go',
    path: 'main.go',
    language: 'go',
    description: 'Core Go server: HTTP server, embedded templates, CSV parser, and regex filter engine',
    content: `package main

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
	reader.FieldsPerRecord = -1

	// Read header
	_, err := reader.Read()
	if err != nil {
		return fmt.Errorf("failed to read header: %w", err)
	}

	var tracks []Track
	showSet := make(map[string]struct{})

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
		log.Printf("Fetching initial playlist from Google Docs...")
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
`,
  },
  {
    filename: 'templates/index.html',
    path: 'templates/index.html',
    language: 'html',
    description: 'Main layout with HTMX interactive form bindings and responsive table',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Radio Station Playlist Explorer</title>
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
    <style>
        :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; color: #222; }
        body { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
        header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #ddd; padding-bottom: 1rem; }
        .filter-card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.08); margin: 1.5rem 0; }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; align-items: end; }
        label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem; color: #555; }
        input, select { width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .checkbox-container { display: flex; align-items: center; gap: 0.5rem; margin-top: 1.5rem; }
        .checkbox-container input { width: auto; }
        button { cursor: pointer; padding: 0.5rem 1rem; border-radius: 4px; border: none; background: #0066cc; color: white; font-weight: 600; }
        button:hover { background: #0052a3; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
        th, td { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #eee; }
        th { background: #f9fafb; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; color: #666; }
        .badge { background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; }
        .spinner { display: none; }
        .htmx-request .spinner { display: inline; }
    </style>
</head>
<body>

<header>
    <div>
        <h1>Radio Playlist Explorer</h1>
        <small>Last synced: {{.LastUpdated}}</small>
    </div>
    <button hx-post="/refresh" hx-target="body" hx-indicator="#refresh-spinner">
        Sync Sheets <span id="refresh-spinner" class="spinner">⏳</span>
    </button>
</header>

<div class="filter-card">
    <form hx-get="/tracks" hx-target="#results-body" hx-trigger="input from:input delay:250ms, change from:select, change from:input[type='checkbox']">
        <div class="form-grid">
            <div>
                <label for="show">Show</label>
                <select name="show" id="show">
                    <option value="">-- All Shows --</option>
                    {{range .Shows}}
                    <option value="{{.}}">{{.}}</option>
                    {{end}}
                </select>
            </div>
            <div>
                <label for="regex">Title / Artist Regex</label>
                <input type="text" id="regex" name="regex" placeholder="e.g. (?i)springsteen|bowie">
            </div>
            <div>
                <label for="from">From Date</label>
                <input type="date" id="from" name="from">
            </div>
            <div>
                <label for="to">To Date</label>
                <input type="date" id="to" name="to">
            </div>
            <div class="checkbox-container">
                <input type="checkbox" id="featured" name="featured">
                <label for="featured" style="margin:0;">Heavy Rotation Only</label>
            </div>
        </div>
    </form>
</div>

<table>
    <thead>
        <tr>
            <th>Timestamp</th>
            <th>Artist</th>
            <th>Song Title</th>
            <th>Show</th>
            <th>Heavy Rotation</th>
        </tr>
    </thead>
    <tbody id="results-body">
        {{template "track_rows.html" .Tracks}}
    </tbody>
</table>

</body>
</html>
`,
  },
  {
    filename: 'templates/track_rows.html',
    path: 'templates/track_rows.html',
    language: 'html',
    description: 'HTMX partial template rendering dynamic table rows',
    content: `{{range .}}
<tr>
    <td>{{.Timestamp.Format "01/02/2006 15:04"}}</td>
    <td><strong>{{.Artist}}</strong></td>
    <td>{{.Title}}</td>
    <td>{{.ShowName}}</td>
    <td>
        {{if .IsFeatured}}
        <span class="badge">Featured</span>
        {{end}}
    </td>
</tr>
{{else}}
<tr>
    <td colspan="5" style="text-align:center; padding: 2rem; color: #888;">No tracks found matching your filter criteria.</td>
</tr>
{{end}}
`,
  },
  {
    filename: 'Dockerfile',
    path: 'Dockerfile',
    language: 'dockerfile',
    description: 'Multi-stage Alpine Dockerfile for GCP Cloud Run deployment',
    content: `# Build Stage
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server .

# Run Stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /root/
COPY --from=builder /app/server .

ENV PORT=8080
EXPOSE 8080

CMD ["./server"]
`,
  },
];
