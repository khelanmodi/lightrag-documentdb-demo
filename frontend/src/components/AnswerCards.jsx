import { useState } from 'react';
import { colorForType } from './colors.js';

function fmt(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function TimePill({ ms, loading, color }) {
  if (ms == null && !loading) return null;
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-mono tabular-nums"
      style={{
        background: color + '22',
        color,
        border: `1px solid ${color}55`,
        minWidth: '60px',
        textAlign: 'center',
        display: 'inline-block',
      }}
      title={loading ? 'elapsed (still running)' : 'pipeline duration'}
    >
      {loading && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 animate-pulse" style={{ background: color, verticalAlign: 'middle' }} />}
      {fmt(ms)}
    </span>
  );
}

function Card({ title, badge, badgeColor, loading, timeMs, timeLoading, phase, children }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col min-h-[280px]">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <div className="flex items-center gap-1.5">
          <TimePill ms={timeMs} loading={timeLoading} color={badgeColor} />
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: badgeColor + '33', color: badgeColor, border: `1px solid ${badgeColor}66` }}
          >
            {badge}
          </span>
        </div>
      </div>
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
          <div className="animate-pulse">{phase || 'Thinking…'}</div>
          {phase && (
            <div className="text-[10px] text-slate-600 font-mono">working against DocumentDB graph</div>
          )}
        </div>
      ) : children}
    </div>
  );
}

export default function AnswerCards({ result, vectorLoading, lightragLoading, timings, lightragPhase }) {
  const [openSources, setOpenSources] = useState(false);

  const vec = result?.vector_answer;
  const lr = result?.lightrag_answer;
  const sources = result?.vector_sources || [];
  const nodes = result?.graph_nodes || [];
  const edges = result?.graph_edges || [];

  const vTime = vectorLoading ? timings?.vectorElapsed : (timings?.vectorFinal ?? null);
  const lTime = lightragLoading ? timings?.lightragElapsed : (timings?.lightragFinal ?? null);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card
          title="Vector Search"
          badge="Standard RAG · top-k similarity"
          badgeColor="#60a5fa"
          loading={vectorLoading && !vec}
          timeMs={vTime}
          timeLoading={vectorLoading}
        >
          {vec ? (
            <>
              <div className="text-sm text-slate-200 whitespace-pre-wrap flex-1">{vec}</div>
              {sources.length > 0 && (
                <div className="mt-3 border-t border-slate-800 pt-2">
                  <button
                    className="text-xs text-slate-400 hover:text-slate-200"
                    onClick={() => setOpenSources((o) => !o)}
                  >
                    {openSources ? '▾' : '▸'} {sources.length} retrieved source{sources.length === 1 ? '' : 's'}
                  </button>
                  {openSources && (
                    <ul className="mt-2 space-y-2">
                      {sources.map((s, i) => (
                        <li key={i} className="text-[11px] bg-slate-950 border border-slate-800 rounded p-2">
                          <div className="text-slate-400 mb-1">
                            #{i + 1} · score {s.score?.toFixed(3)} · {s.source}
                          </div>
                          <div className="text-slate-300">{s.text}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-500 text-sm">Ask a question to compare answers.</div>
          )}
        </Card>

        <Card
          title="LightRAG"
          badge="Graph-augmented retrieval"
          badgeColor="#34d399"
          loading={lightragLoading && !lr}
          timeMs={lTime}
          timeLoading={lightragLoading}
          phase={lightragPhase}
        >
          {lr ? (
            <>
              <div className="text-sm text-slate-200 whitespace-pre-wrap flex-1">{lr}</div>
              {nodes.length > 0 && (
                <div className="mt-3 border-t border-slate-800 pt-2">
                  <div className="text-xs text-slate-400 mb-1.5">Entities traversed:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {nodes.slice(0, 30).map((n) => (
                      <span
                        key={n.id}
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{
                          background: colorForType(n.type) + '22',
                          color: colorForType(n.type),
                          border: `1px solid ${colorForType(n.type)}55`,
                        }}
                        title={n.description || n.type}
                      >
                        {n.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-500 text-sm">Ask a question to compare answers.</div>
          )}
        </Card>
      </div>

      {result && !vectorLoading && !lightragLoading && (
        <div className="text-center text-xs text-slate-400 px-3 py-2 bg-slate-900/60 border border-slate-800 rounded">
          Vector search retrieved <span className="text-blue-300 font-semibold">{sources.length}</span> chunks.
          {' '}LightRAG traversed{' '}
          <span className="text-emerald-300 font-semibold">{nodes.length}</span> entities across{' '}
          <span className="text-emerald-300 font-semibold">{edges.length}</span> relationship hops.
        </div>
      )}
    </div>
  );
}
