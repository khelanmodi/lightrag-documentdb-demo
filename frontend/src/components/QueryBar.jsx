import { useState } from 'react';

const PRESETS = [
  'Why did Acme Corp churn?',
  "Which of Sarah Chen's discount approvals are renewal risks?",
  "What was the root cause of Acme's support escalations?",
];

export default function QueryBar({ onSubmit, loading }) {
  const [text, setText] = useState('');

  const submit = (q) => {
    if (!q.trim() || loading) return;
    onSubmit(q.trim());
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
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
          disabled={loading || !text.trim()}
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
