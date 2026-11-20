import React, { useState } from 'react';
import { Header } from './components/Header';
import { PlaylistExplorer } from './components/PlaylistExplorer';
import { CodeHub } from './components/CodeHub';
import { CloudRunGuide } from './components/CloudRunGuide';
import { AiAssistant } from './components/AiAssistant';
import { INITIAL_TRACKS } from './data/sampleTracks';
import { Track } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'explorer' | 'code' | 'deploy' | 'ai'>('explorer');
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);

  const handleAddTrack = (newTrack: Track) => {
    setTracks([newTrack, ...tracks]);
  };

  const handleRefreshCSV = (_url: string) => {
    // Simulate loading/refreshing or reloading sample data + new tracks
    // In a real app this fetches from the CSV URL
  };

  return (
    <div className="min-h-screen bg-slate-900/5 text-slate-900 font-sans antialiased flex flex-col">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} trackCount={tracks.length} />

      <main className="flex-1 pb-12">
        {activeTab === 'explorer' && (
          <PlaylistExplorer tracks={tracks} onAddTrack={handleAddTrack} onRefreshCSV={handleRefreshCSV} />
        )}
        {activeTab === 'code' && <CodeHub />}
        {activeTab === 'deploy' && <CloudRunGuide />}
        {activeTab === 'ai' && <AiAssistant tracks={tracks} />}
      </main>
    </div>
  );
}
