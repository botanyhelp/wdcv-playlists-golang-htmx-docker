import React, { useState } from 'react';
import { Cloud, Terminal, Copy, Check, ExternalLink, CheckCircle2 } from 'lucide-react';

export const CloudRunGuide: React.FC = () => {
  const [projectId, setProjectId] = useState('my-radio-project-123');
  const [sheetId, setSheetId] = useState('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  const [serviceName, setServiceName] = useState('playlist-app');
  const [region, setRegion] = useState('us-central1');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  const deployCommand = `gcloud config set project ${projectId}

gcloud run deploy ${serviceName} \\
  --source . \\
  --region ${region} \\
  --allow-unauthenticated \\
  --set-env-vars SHEET_CSV_URL="${csvUrl}"`;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white rounded-2xl p-6 shadow-md border border-blue-800 space-y-3">
        <div className="flex items-center gap-2">
          <Cloud className="w-6 h-6 text-blue-400" />
          <h2 className="text-lg font-bold">Deploying to GCP Cloud Run</h2>
        </div>
        <p className="text-xs text-blue-100 leading-relaxed max-w-3xl">
          Cloud Run automatically builds your Go Docker container from source using Cloud Build and provisions a scalable, serverless container endpoint with HTTPS automatically configured.
        </p>
      </div>

      {/* Configuration Builder */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-blue-600" />
          <span>Interactive Cloud Run Deployment Command Generator</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">GCP Project ID</label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Cloud Run Service Name</label>
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">GCP Region</label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="us-central1">us-central1 (Iowa)</option>
              <option value="us-east1">us-east1 (South Carolina)</option>
              <option value="europe-west1">europe-west1 (Belgium)</option>
              <option value="asia-east1">asia-east1 (Taiwan)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Google Sheet ID</label>
            <input
              type="text"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Generated Command box */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-700">Generated Deployment Command:</span>
            <button
              onClick={() => handleCopy(deployCommand, 'deploy')}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
            >
              {copiedCmd === 'deploy' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCmd === 'deploy' ? 'Copied!' : 'Copy Command'}</span>
            </button>
          </div>
          <div className="bg-slate-950 text-emerald-400 font-mono p-4 rounded-xl text-xs overflow-x-auto leading-relaxed">
            <pre>{deployCommand}</pre>
          </div>
        </div>
      </div>

      {/* Step by Step Guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
            1
          </div>
          <h4 className="text-sm font-semibold text-slate-900">Share Google Sheet</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            Ensure your Google Sheet is shared as <em>"Anyone with the link can view"</em>. Copy the spreadsheet ID from your browser URL.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
            2
          </div>
          <h4 className="text-sm font-semibold text-slate-900">Initialize Project</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            Create your local directory, place <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">main.go</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">go.mod</code>, <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">Dockerfile</code>, and the <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">templates/</code> folder.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
            3
          </div>
          <h4 className="text-sm font-semibold text-slate-900">Deploy & Enjoy</h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            Run the <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">gcloud run deploy</code> command above. Cloud Run provides an instant HTTPS URL with zero cold-start bloat!
          </p>
        </div>
      </div>
    </div>
  );
};
