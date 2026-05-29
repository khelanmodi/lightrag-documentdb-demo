import { useCallback, useEffect, useRef, useState } from 'react';

const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

async function* sseStream(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const dataLines = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      const dataStr = dataLines.join('\n');
      let data = dataStr;
      try { data = JSON.parse(dataStr); } catch { /* keep as string */ }
      yield { event, data };
    }
  }
}

const EMPTY_NAIVE = { answer: '', sources: [], loading: false, elapsed: 0, final: null, phase: null };
const EMPTY_LR = { answer: '', nodes: [], edges: [], loading: false, elapsed: 0, final: null, phase: null };

// Union two arrays of {id, ...} by id, preserving first-seen ordering.
function unionById(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const list of [a, b]) {
    for (const item of list) {
      const k = item?.id ?? item?.source + '→' + item?.target;
      if (k == null || seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

export const ALL_MODES = ['naive', 'local', 'hybrid'];

export function useQuery() {
  const [naive,  setNaive]  = useState(EMPTY_NAIVE);
  const [local,  setLocal]  = useState(EMPTY_LR);
  const [hybrid, setHybrid] = useState(EMPTY_LR);
  const [error, setError] = useState(null);
  const [hasRun, setHasRun] = useState(false);

  const naiveRef  = useRef({ start: 0, phases: [] });
  const localRef  = useRef({ start: 0, phases: [] });
  const hybridRef = useRef({ start: 0, phases: [] });
  const tickRef = useRef(null);

  useEffect(() => () => clearInterval(tickRef.current), []);

  const stopTickerIfDone = () => {
    if (!naiveRef.current.start && !localRef.current.start && !hybridRef.current.start) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const run = useCallback(async (query, selectedModes = ALL_MODES) => {
    setError(null);
    setHasRun(true);
    const wanted = new Set(selectedModes && selectedModes.length ? selectedModes : ALL_MODES);

    if (wanted.has('naive'))  setNaive({  ...EMPTY_NAIVE, loading: true });
    if (wanted.has('local'))  setLocal({  ...EMPTY_LR,    loading: true });
    if (wanted.has('hybrid')) setHybrid({ ...EMPTY_LR,    loading: true });

    const t0 = performance.now();
    naiveRef.current  = { start: wanted.has('naive')  ? t0 : 0, phases: [] };
    localRef.current  = { start: wanted.has('local')  ? t0 : 0, phases: [] };
    hybridRef.current = { start: wanted.has('hybrid') ? t0 : 0, phases: [] };

    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const now = performance.now();
      const pickPhase = (dt, phases) => {
        let current = null;
        for (const p of phases) {
          if (dt >= p.at_ms) current = p.label;
          else break;
        }
        return current;
      };
      if (naiveRef.current.start) {
        const dt = now - naiveRef.current.start;
        setNaive((p) => ({
          ...p,
          elapsed: dt,
          phase: p.answer || p.sources?.length ? null : pickPhase(dt, naiveRef.current.phases),
        }));
      }
      if (localRef.current.start) {
        const dt = now - localRef.current.start;
        setLocal((p) => ({
          ...p,
          elapsed: dt,
          phase: p.answer ? null : pickPhase(dt, localRef.current.phases),
        }));
      }
      if (hybridRef.current.start) {
        const dt = now - hybridRef.current.start;
        setHybrid((p) => ({
          ...p,
          elapsed: dt,
          phase: p.answer ? null : pickPhase(dt, hybridRef.current.phases),
        }));
      }
    }, 50);

    const runStream = ({ label, path, body, ref, setter, handlers = {} }) => async () => {
      try {
        let answer = '';
        for await (const { event, data } of sseStream(path, body)) {
          if (event === 'phases') {
            ref.current.phases = Array.isArray(data) ? data : [];
          } else if (event === 'token') {
            if (!answer) setter((p) => ({ ...p, phase: null }));
            answer += typeof data === 'string' ? data : '';
            setter((p) => ({ ...p, answer }));
          } else if (event === 'error') {
            setError((prev) => prev || `${label}: ${data}`);
          } else if (event === 'done') {
            break;
          } else if (handlers[event]) {
            handlers[event](data, setter);
          }
        }
      } catch (e) {
        setError((prev) => prev || `${label}: ${e}`);
      } finally {
        const dt = performance.now() - ref.current.start;
        setter((p) => ({ ...p, elapsed: dt, final: dt, phase: null, loading: false }));
        ref.current.start = 0;
        stopTickerIfDone();
      }
    };

    const onSources   = (data, set) => set((p) => ({ ...p, sources: data || [] }));
    const onHighlight = (data, set) => set((p) => ({
      ...p,
      nodes: data?.nodes || [],
      edges: data?.edges || [],
    }));

    const tasks = [];
    if (wanted.has('naive'))  tasks.push(runStream({
      label: 'naive',
      path: '/query/naive/stream',
      body: { query },
      ref: naiveRef, setter: setNaive,
      handlers: { sources: onSources },
    })());
    if (wanted.has('local'))  tasks.push(runStream({
      label: 'lightrag-local',
      path: '/query/lightrag/stream',
      body: { query, mode: 'local' },
      ref: localRef, setter: setLocal,
      handlers: { highlight: onHighlight },
    })());
    if (wanted.has('hybrid')) tasks.push(runStream({
      label: 'lightrag-hybrid',
      path: '/query/lightrag/stream',
      body: { query, mode: 'hybrid' },
      ref: hybridRef, setter: setHybrid,
      handlers: { highlight: onHighlight },
    })());
    // Fire-and-forget; per-mode state drives the UI.
    void Promise.all(tasks);
  }, []);

  const loading = naive.loading || local.loading || hybrid.loading;

  const result = hasRun
    ? {
        naive_answer: naive.answer,
        naive_sources: naive.sources,
        lightrag_local_answer: local.answer,
        lightrag_local_nodes: local.nodes,
        lightrag_local_edges: local.edges,
        lightrag_hybrid_answer: hybrid.answer,
        lightrag_hybrid_nodes: hybrid.nodes,
        lightrag_hybrid_edges: hybrid.edges,
        // Union for the graph panel: any entity either LightRAG pass touched.
        graph_nodes: unionById(local.nodes, hybrid.nodes),
        graph_edges: unionById(local.edges, hybrid.edges),
        // Legacy aliases for older consumers.
        vector_answer: naive.answer,
        vector_sources: naive.sources,
        lightrag_answer: local.answer,
      }
    : null;

  return {
    loading,
    naiveLoading: naive.loading,
    localLoading: local.loading,
    hybridLoading: hybrid.loading,
    // Legacy loading aliases.
    vectorLoading: naive.loading,
    lightragLoading: local.loading || hybrid.loading,
    result,
    error,
    run,
    timings: {
      naiveElapsed:  naive.elapsed,  naiveFinal:  naive.final,
      localElapsed:  local.elapsed,  localFinal:  local.final,
      hybridElapsed: hybrid.elapsed, hybridFinal: hybrid.final,
      // Legacy aliases.
      vectorElapsed:   naive.elapsed, vectorFinal:   naive.final,
      lightragElapsed: local.elapsed, lightragFinal: local.final,
    },
    phases: { naive: naive.phase, local: local.phase, hybrid: hybrid.phase },
    // Legacy.
    lightragPhase: local.phase,
  };
}

export async function fetchGraph() {
  const res = await fetch(`${BASE}/graph`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function ingestDocument(text, source = 'user-upload') {
  const res = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
