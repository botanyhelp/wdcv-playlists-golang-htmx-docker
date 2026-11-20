import React from 'react';
import { Radio, Code2, Cloud, Sparkles, Database } from 'lucide-react';

interface HeaderProps {
  activeTab: 'explorer' | 'code' | 'deploy' | 'ai';
  setActiveTab: (tab: 'explorer' | 'code' | 'deploy' | 'ai') => void;
  trackCount: number;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, trackCount }) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-600 rounded-xl shadow-inner text-white flex items-center justify-center">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">Radio Playlist Explorer</h1>
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-mono border border-blue-500/35">
                Go + htmx + Cloud Run
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Zero-dependency Go backend with Google Docs CSV sync & instant regex filtering
            </p>
          </div>
        </div>

        <nav className="flex items-center bg-slate-800/80 p-1.5 rounded-xl border border-slate-700/60 overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('explorer')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'explorer'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Live Explorer ({trackCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'code'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Go Backend & HTMX Code</span>
          </button>

          <button
            onClick={() => setActiveTab('deploy')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'deploy'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Cloud className="w-4 h-4" />
            <span>GCP Cloud Run Deploy</span>
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'ai'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Gemini AI Assistant</span>
          </button>
        </nav>
      </div>
    </header>
  );
};
