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

function Card({ title, subtitle, badge, badgeColor, loading, timeMs, timeLoading, phase, footnote, children }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col min-h-[280px]">
      <div className="flex items-start justify-between mb-1 gap-2">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <TimePill ms={timeMs} loading={timeLoading} color={badgeColor} />
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: badgeColor + '33', color: badgeColor, border: `1px solid ${badgeColor}66` }}
          >
            {badge}
          </span>
        </div>
      </div>
      {subtitle && <div className="text-[11px] text-slate-500 mb-3">{subtitle}</div>}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
          <div className="animate-pulse text-center px-2">{phase || 'Thinking…'}</div>
          {phase && (
            <div className="text-[10px] text-slate-600 font-mono">working against DocumentDB</div>
          )}
        </div>
      ) : children}
      {footnote && !loading && (
        <div className="mt-2 text-[10px] text-slate-500 italic">{footnote}</div>
      )}
    </div>
  );
}

function EntityChips({ nodes, color }) {
  if (!nodes?.length) return null;
  return (
    <div className="mt-3 border-t border-slate-800 pt-2">
      <div className="text-xs mb-1.5" style={{ color }}>
        Entities traversed ({nodes.length}):
      </div>
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
  );
}

const COLORS = {
  naive:  '#60a5fa', // sky-400
  local:  '#34d399', // emerald-400
  hybrid: '#a78bfa', // violet-400
};

export default function AnswerCards({
  result,
  selectedModes = ['naive', 'local', 'hybrid'],
  naiveLoading,
  localLoading,
  hybridLoading,
  timings,
  phases,
  // Legacy aliases.
  vectorLoading,
  lightragLoading,
  lightragPhase,
}) {
  const [openSources, setOpenSources] = useState(false);

  // Accept either new or legacy loading prop names.
  const nLoading = naiveLoading ?? vectorLoading;
  const lLoading = localLoading ?? lightragLoading;
  const hLoading = hybridLoading ?? false;

  const naive = result?.naive_answer ?? result?.vector_answer;
  const local = result?.lightrag_local_answer ?? result?.lightrag_answer;
  const hybrid = result?.lightrag_hybrid_answer;

  const naiveSources = result?.naive_sources ?? result?.vector_sources ?? [];
  const localNodes  = result?.lightrag_local_nodes  ?? result?.graph_nodes ?? [];
  const localEdges  = result?.lightrag_local_edges  ?? result?.graph_edges ?? [];
  const hybridNodes = result?.lightrag_hybrid_nodes ?? [];
  const hybridEdges = result?.lightrag_hybrid_edges ?? [];

  const nTime = nLoading ? timings?.naiveElapsed  : (timings?.naiveFinal  ?? timings?.vectorFinal ?? null);
  const lTime = lLoading ? timings?.localElapsed  : (timings?.localFinal  ?? timings?.lightragFinal ?? null);
  const hTime = hLoading ? timings?.hybridElapsed : (timings?.hybridFinal ?? null);

  const localPhase  = phases?.local  ?? lightragPhase;
  const hybridPhase = phases?.hybrid;
  const naivePhase  = phases?.naive;

  const show = (k) => selectedModes.includes(k);
  const shownCount = ['naive', 'local', 'hybrid'].filter(show).length;
  const colsCls = shownCount === 1 ? 'md:grid-cols-1' : shownCount === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3';

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid grid-cols-1 ${colsCls} gap-3`}>
        {show('naive') && (
          <Card
            title="Naive RAG"
            subtitle="Top-k cosine over chunk embeddings · no graph"
            badge="DocumentDB vector index"
            badgeColor={COLORS.naive}
            loading={nLoading && !naive}
            timeMs={nTime}
            timeLoading={nLoading}
            phase={naivePhase}
            footnote="Baseline: what you get from chunks + embeddings alone."
          >
            {naive ? (
              <>
                <div className="text-sm text-slate-200 whitespace-pre-wrap flex-1">{naive}</div>
                {naiveSources.length > 0 && (
                  <div className="mt-3 border-t border-slate-800 pt-2">
                    <button
                      className="text-xs text-slate-400 hover:text-slate-200"
                      onClick={() => setOpenSources((o) => !o)}
                    >
                      {openSources ? '▾' : '▸'} {naiveSources.length} retrieved chunk{naiveSources.length === 1 ? '' : 's'}
                    </button>
                    {openSources && (
                      <ul className="mt-2 space-y-2">
                        {naiveSources.map((s, i) => (
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
              <div className="text-slate-500 text-sm">Ask a question to compare strategies.</div>
            )}
          </Card>
        )}

        {show('local') && (
          <Card
            title="LightRAG · Local"
            subtitle="Entity vectors → 1-hop graph → chunks"
            badge="Single-pass traversal"
            badgeColor={COLORS.local}
            loading={lLoading && !local}
            timeMs={lTime}
            timeLoading={lLoading}
            phase={localPhase}
            footnote="Entity-centric: tight, focused chain of evidence."
          >
            {local ? (
              <>
                <div className="text-sm text-slate-200 whitespace-pre-wrap flex-1">{local}</div>
                <EntityChips nodes={localNodes} color={COLORS.local} />
              </>
            ) : (
              <div className="text-slate-500 text-sm">Ask a question to compare strategies.</div>
            )}
          </Card>
        )}

        {show('hybrid') && (
          <Card
            title="LightRAG · Hybrid"
            subtitle="Local + global (relationship vectors → connected entities)"
            badge="Multi-pass + multi-hop"
            badgeColor={COLORS.hybrid}
            loading={hLoading && !hybrid}
            timeMs={hTime}
            timeLoading={hLoading}
            phase={hybridPhase}
            footnote="Surfaces multi-hop chains a single-entity hit would miss."
          >
            {hybrid ? (
              <>
                <div className="text-sm text-slate-200 whitespace-pre-wrap flex-1">{hybrid}</div>
                <EntityChips nodes={hybridNodes} color={COLORS.hybrid} />
              </>
            ) : (
              <div className="text-slate-500 text-sm">Ask a question to compare strategies.</div>
            )}
          </Card>
        )}
      </div>

      {result && !nLoading && !lLoading && !hLoading && (
        <div className="text-center text-xs text-slate-400 px-3 py-2 bg-slate-900/60 border border-slate-800 rounded">
          {show('naive') && (
            <>
              <span className="text-sky-300 font-semibold">Naive RAG</span> retrieved{' '}
              <span className="text-sky-300 font-semibold">{naiveSources.length}</span> chunks.{' '}
            </>
          )}
          {show('local') && (
            <>
              <span className="text-emerald-300 font-semibold">LightRAG-Local</span> traversed{' '}
              <span className="text-emerald-300 font-semibold">{localNodes.length}</span> entities ·{' '}
              <span className="text-emerald-300 font-semibold">{localEdges.length}</span> hops.{' '}
            </>
          )}
          {show('hybrid') && (
            <>
              <span className="text-violet-300 font-semibold">LightRAG-Hybrid</span> traversed{' '}
              <span className="text-violet-300 font-semibold">{hybridNodes.length}</span> entities ·{' '}
              <span className="text-violet-300 font-semibold">{hybridEdges.length}</span> hops.
            </>
          )}
        </div>
      )}
    </div>
  );
}
