import React, { useState } from 'react';
import { Track } from '../types';
import { GoogleGenAI } from '@google/genai';
import { Sparkles, Send, Bot, User, Loader2, Code, Lightbulb } from 'lucide-react';

interface AiAssistantProps {
  tracks: Track[];
}

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

export const AiAssistant: React.FC<AiAssistantProps> = ({ tracks }) => {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'ai',
      text: 'Hello! I am your Gemini AI assistant for the Radio Playlist Explorer. Ask me to generate regular expressions for artist search, analyze heavy rotation trends, or suggest playlist filtering queries!',
    },
  ]);
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    const userMsg = prompt.trim();
    setPrompt('');
    setMessages((prev) => [...prev, { sender: 'user', text: userMsg }]);
    setLoading(true);

    try {
      // Initialize Gemini AI client
      const ai = new GoogleGenAI();
      const model = 'gemini-2.5-flash';

      const playlistSummary = tracks
        .map((t) => `[${t.timestamp}] ${t.artist} - "${t.title}" (${t.showName})${t.isFeatured ? ' [Featured]' : ''}`)
        .join('\n');

      const systemInstruction = `You are an expert radio playlist analyst and Go regex assistant. You have access to the current radio tracks dataset:
${playlistSummary}

Help the user write regex queries for artist/song filtering, analyze listener trends, or answer questions about the playlist. Keep responses concise, helpful, and developer-friendly.`;

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemInstruction}\n\nUser request: ${userMsg}` }],
          },
        ],
      });

      const aiText = response.text || 'I analyzed your request, but could not generate a response at this moment.';
      setMessages((prev) => [...prev, { sender: 'ai', text: aiText }]);
    } catch (err: any) {
      console.error(err);
      // Fallback response if API key is not present or quota error
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: `Here is a simulated AI response based on your playlist dataset! For regex searches, you can use patterns like \`(?i)war|lcd\` to match multiple artists case-insensitively, or filter by show names. (Note: To enable live Gemini API calls, ensure your GEMINI_API_KEY is configured in AI Studio).`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const samplePrompts = [
    'Generate a regex query to find rock or electronic tracks',
    'Which artist appeared the most in heavy rotation?',
    'Summarize the musical vibe of Morning Becomes Eclectic',
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-amber-900/90 to-slate-900 text-white rounded-2xl p-6 shadow-md border border-amber-800/50 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold">Gemini AI Playlist Assistant</h2>
        </div>
        <p className="text-xs text-amber-100/80 leading-relaxed">
          Powered by Google GenAI SDK. Ask questions about your playlist data, request complex regular expressions, or get curation insights.
        </p>
      </div>

      {/* Chat Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[500px]">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex items-start gap-3 ${m.sender === 'user' ? 'flex-row-reverse' : ''}`}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  m.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white shadow-sm'
                }`}
              >
                {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-white text-slate-800 border border-slate-200 shadow-xs rounded-tl-none font-sans'
                }`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-500 flex items-center gap-2 shadow-xs">
                <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                <span>Gemini is thinking...</span>
              </div>
            </div>
          )}
        </div>

        {/* Quick Prompts */}
        <div className="bg-white border-t border-slate-100 px-6 py-2 flex items-center gap-2 overflow-x-auto">
          <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-[11px] font-semibold text-slate-500 shrink-0">Suggestions:</span>
          {samplePrompts.map((sp, idx) => (
            <button
              key={idx}
              onClick={() => setPrompt(sp)}
              className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full whitespace-nowrap transition"
            >
              {sp}
            </button>
          ))}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} className="bg-white border-t border-slate-200 p-4 flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask Gemini about your playlist or request a regex pattern..."
            className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-xl text-xs font-semibold shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
