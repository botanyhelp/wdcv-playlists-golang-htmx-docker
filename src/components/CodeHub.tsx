import React, { useState } from 'react';
import { GO_CODE_FILES } from '../data/goCodeFiles';
import { Copy, Check, FileCode, Server, Terminal, ShieldCheck } from 'lucide-react';

export const CodeHub: React.FC = () => {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const currentFile = GO_CODE_FILES[selectedFileIndex];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Overview Card */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-6 shadow-md border border-slate-700/80 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-bold">100% Go Standard Library + htmx Architecture</h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
          Designed with zero third-party Go packages (except standard library <code className="bg-slate-800 text-blue-300 px-1 py-0.5 rounded font-mono">net/http</code>, <code className="bg-slate-800 text-blue-300 px-1 py-0.5 rounded font-mono">encoding/csv</code>, <code className="bg-slate-800 text-blue-300 px-1 py-0.5 rounded font-mono">regexp</code>, and <code className="bg-slate-800 text-blue-300 px-1 py-0.5 rounded font-mono">embed</code>). The entire application embeds templates directly into a single statically-compiled binary that runs seamlessly inside a lightweight Alpine Docker container on GCP Cloud Run.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
            <Server className="w-5 h-5 text-blue-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Thread-Safe RAM Store</div>
              <div className="text-[11px] text-slate-400">RWMutex protected in-memory index</div>
            </div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
            <Terminal className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Instant HTMX Swaps</div>
              <div className="text-[11px] text-slate-400">&lt;tbody&gt; partial updates</div>
            </div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
            <FileCode className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Single Container</div>
              <div className="text-[11px] text-slate-400">Alpine Linux + ca-certificates</div>
            </div>
          </div>
        </div>
      </div>

      {/* Code Viewer */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        {/* File tabs */}
        <div className="bg-slate-50 border-b border-slate-200 px-4 pt-3 flex items-center gap-2 overflow-x-auto">
          {GO_CODE_FILES.map((file, idx) => (
            <button
              key={file.filename}
              onClick={() => setSelectedFileIndex(idx)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-xs font-medium border-t border-x transition-all ${
                selectedFileIndex === idx
                  ? 'bg-white text-blue-600 border-slate-200 shadow-xs font-semibold'
                  : 'bg-slate-100/60 text-slate-600 border-transparent hover:bg-slate-100'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{file.filename}</span>
            </button>
          ))}
        </div>

        {/* File meta & copy button */}
        <div className="bg-slate-900 text-slate-200 px-6 py-3 flex justify-between items-center border-b border-slate-800">
          <div>
            <div className="text-xs font-mono font-semibold text-blue-400">{currentFile.path}</div>
            <div className="text-[11px] text-slate-400">{currentFile.description}</div>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>
        </div>

        {/* Code Content */}
        <div className="bg-slate-950 p-6 overflow-x-auto max-h-[600px] font-mono text-xs text-slate-300 leading-relaxed">
          <pre className="font-mono">{currentFile.content}</pre>
        </div>
      </div>
    </div>
  );
};
