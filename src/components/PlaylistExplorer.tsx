import React, { useState, useMemo } from 'react';
import { Track, FilterState } from '../types';
import { Search, RefreshCw, Calendar, Disc, CheckCircle2, Download, FileSpreadsheet, Plus, AlertCircle } from 'lucide-react';

interface PlaylistExplorerProps {
  tracks: Track[];
  onAddTrack: (track: Track) => void;
  onRefreshCSV: (url: string) => void;
}

export const PlaylistExplorer: React.FC<PlaylistExplorerProps> = ({ tracks, onAddTrack, onRefreshCSV }) => {
  const [filters, setFilters] = useState<FilterState>({
    show: '',
    regex: '',
    fromDate: '',
    toDate: '',
    featuredOnly: false,
  });

  const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // New track form state
  const [newArtist, setNewArtist] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newShow, setNewShow] = useState('Morning Becomes Eclectic');
  const [newFeatured, setNewFeatured] = useState(false);

  // Extract unique shows
  const shows = useMemo(() => {
    const set = new Set<string>();
    tracks.forEach((t) => {
      if (t.showName) set.add(t.showName);
    });
    return Array.from(set).sort();
  }, [tracks]);

  // Filter tracks
  const filteredTracks = useMemo(() => {
    let regexObj: RegExp | null = null;
    if (filters.regex.trim() !== '') {
      try {
        // Handle case-insensitive flag if not specified
        const pattern = filters.regex.startsWith('(?i)')
          ? filters.regex.replace('(?i)', '')
          : filters.regex;
        regexObj = new RegExp(pattern, 'i');
      } catch (e) {
        // Invalid regex fallback
        regexObj = null;
      }
    }

    return tracks.filter((tr) => {
      if (filters.show && tr.showName !== filters.show) return false;
      if (filters.featuredOnly && !tr.isFeatured) return false;

      if (regexObj) {
        const matches = regexObj.test(tr.title) || regexObj.test(tr.artist);
        if (!matches) return false;
      }

      const trDate = tr.timestamp.split(' ')[0]; // YYYY-MM-DD
      if (filters.fromDate && trDate < filters.fromDate) return false;
      if (filters.toDate && trDate > filters.toDate) return false;

      return true;
    });
  }, [tracks, filters]);

  const handleSync = () => {
    setIsSyncing(true);
    setSyncStatus(null);
    setTimeout(() => {
      setIsSyncing(false);
      onRefreshCSV(sheetUrl);
      setSyncStatus('Successfully synced playlist data from Google Docs CSV export!');
      setTimeout(() => setSyncStatus(null), 4000);
    }, 800);
  };

  const handleCreateTrack = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArtist || !newTitle || !newShow) return;

    const now = new Date();
    const formatted = now.toISOString().replace('T', ' ').substring(0, 19);

    const track: Track = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: formatted,
      artist: newArtist,
      title: newTitle,
      showName: newShow,
      isFeatured: newFeatured,
    };

    onAddTrack(track);
    setNewArtist('');
    setNewTitle('');
    setShowAddModal(false);
  };

  const exportCSV = () => {
    const headers = ['Timestamp', 'Artist', 'Title', 'Show', 'Featured'];
    const rows = filteredTracks.map((t) => [
      t.timestamp,
      `"${t.artist.replace(/"/g, '""')}"`,
      `"${t.title.replace(/"/g, '""')}"`,
      `"${t.showName.replace(/"/g, '""')}"`,
      t.isFeatured ? 'Yes' : 'No',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `playlist_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner / Google Sheets Config */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-slate-800">Google Docs CSV Data Source</h2>
          </div>
          <p className="text-xs text-slate-500">
            Connected to public Google Sheet export URL. In the Go backend, this is configured via <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono">SHEET_CSV_URL</code>.
          </p>
          <div className="flex items-center gap-2 mt-2 w-full max-w-xl">
            <input
              type="text"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex-1 font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv"
            />
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Sheets'}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-lg text-xs font-medium shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Track</span>
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg text-xs font-medium shadow-sm transition"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {syncStatus && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs flex items-center gap-2 shadow-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{syncStatus}</span>
        </div>
      )}

      {/* Filter Card */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Search className="w-4 h-4 text-blue-600" />
            <span>Filter Playlist (HTMX Reactive Controls Simulation)</span>
          </h3>
          <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium">
            Showing {filteredTracks.length} of {tracks.length} tracks
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Show</label>
            <select
              value={filters.show}
              onChange={(e) => setFilters({ ...filters, show: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- All Shows --</option>
              {shows.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Song / Artist Regex</label>
            <input
              type="text"
              placeholder="e.g. (?i)drugs|radiohead"
              value={filters.regex}
              onChange={(e) => setFilters({ ...filters, regex: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">From Date</label>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">To Date</label>
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col justify-end">
            <label className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5 cursor-pointer hover:bg-slate-100 transition">
              <input
                type="checkbox"
                checked={filters.featuredOnly}
                onChange={(e) => setFilters({ ...filters, featuredOnly: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              <span className="text-xs font-semibold text-slate-700">Heavy Rotation Only</span>
            </label>
          </div>
        </div>
      </div>

      {/* Tracks Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Artist</th>
                <th className="py-3 px-4">Song Title</th>
                <th className="py-3 px-4">Show</th>
                <th className="py-3 px-4">Heavy Rotation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {filteredTracks.length > 0 ? (
                filteredTracks.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-mono text-slate-500 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {tr.timestamp}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{tr.artist}</td>
                    <td className="py-3 px-4 text-slate-800">{tr.title}</td>
                    <td className="py-3 px-4 text-slate-600">
                      <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md font-medium text-[11px]">
                        {tr.showName}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {tr.isFeatured ? (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-semibold text-[11px] border border-amber-200">
                          <Disc className="w-3 h-3 text-amber-500 animate-spin" />
                          Featured
                        </span>
                      ) : (
                        <span className="text-slate-400 font-light">-</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <AlertCircle className="w-8 h-8 text-slate-300" />
                      <p className="text-sm font-medium">No tracks found matching your filter criteria.</p>
                      <p className="text-xs text-slate-400">Try loosening your date range, clearing the regex, or selecting all shows.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Track Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4 animate-scale-in">
            <h3 className="text-base font-bold text-slate-900">Add Track to Memory Store</h3>
            <form onSubmit={handleCreateTrack} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Artist Name</label>
                <input
                  type="text"
                  required
                  value={newArtist}
                  onChange={(e) => setNewArtist(e.target.value)}
                  placeholder="e.g. David Bowie"
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Song Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Heroes"
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Show Name</label>
                <select
                  value={newShow}
                  onChange={(e) => setNewShow(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Morning Becomes Eclectic">Morning Becomes Eclectic</option>
                  <option value="Global Beat Odyssey">Global Beat Odyssey</option>
                  <option value="Electronic Explorations">Electronic Explorations</option>
                  <option value="Late Night Club">Late Night Club</option>
                  <option value="Indie Oasis">Indie Oasis</option>
                  <option value="Jazz Spectrum">Jazz Spectrum</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="newFeatured"
                  checked={newFeatured}
                  onChange={(e) => setNewFeatured(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                <label htmlFor="newFeatured" className="text-xs font-semibold text-slate-700">
                  Heavy Rotation / Featured Track
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition"
                >
                  Add Track
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
