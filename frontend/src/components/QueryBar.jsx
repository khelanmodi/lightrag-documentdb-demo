import { useState } from 'react';

const PRESETS = [
  'Why did Acme Corp churn?',
  "Which of Sarah Chen's discount approvals are renewal risks?",
  "What was the root cause of Acme's support escalations?",
];

const MODES = [
  { key: 'naive',  label: 'Naive RAG',        accent: 'text-sky-300',     ring: 'peer-checked:ring-sky-500/60' },
  { key: 'local',  label: 'LightRAG · Local', accent: 'text-emerald-300', ring: 'peer-checked:ring-emerald-500/60' },
  { key: 'hybrid', label: 'LightRAG · Hybrid', accent: 'text-violet-300', ring: 'peer-checked:ring-violet-500/60' },
];

export default function QueryBar({ onSubmit, loading, selectedModes, onModesChange }) {
  const [text, setText] = useState('');

  const submit = (q) => {
    if (!q.trim() || loading) return;
    if (!selectedModes || selectedModes.length === 0) return;
    onSubmit(q.trim(), selectedModes);
  };

  const toggle = (key) => {
    if (!onModesChange) return;
    const set = new Set(selectedModes || []);
    if (set.has(key)) {
      if (set.size === 1) return; // require at least one
      set.delete(key);
    } else {
      set.add(key);
    }
    onModesChange(MODES.map((m) => m.key).filter((k) => set.has(k)));
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wide text-slate-400 mr-1">Strategies:</span>
        {MODES.map((m) => {
          const on = (selectedModes || []).includes(m.key);
          return (
            <label
              key={m.key}
              className="relative cursor-pointer select-none"
              title={loading ? 'Strategy selection is locked while a query is running' : ''}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={on}
                disabled={loading}
                onChange={() => toggle(m.key)}
              />
              <span
                className={[
                  'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition',
                  'border-slate-700 bg-slate-800/60',
                  'peer-checked:bg-slate-800 peer-checked:border-slate-500',
                  'peer-checked:ring-1', m.ring,
                  on ? m.accent : 'text-slate-400',
                  'peer-disabled:opacity-50',
                ].join(' ')}
              >
                <span
                  className={[
                    'inline-block h-2 w-2 rounded-full border',
                    on ? 'bg-current border-current' : 'border-slate-600',
                  ].join(' ')}
                />
                {m.label}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder="Ask a question about the dataset..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(text); }}
          disabled={loading}
        />
        <button
          onClick={() => submit(text)}
          disabled={loading || !text.trim() || !(selectedModes && selectedModes.length)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded text-sm font-medium"
        >
          {loading ? 'Running…' : 'Ask'}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="text-xs text-slate-400 self-center mr-1">Try:</span>
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => { setText(p); submit(p); }}
            disabled={loading}
            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
