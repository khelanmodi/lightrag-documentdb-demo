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

export function useQuery() {
  const [vectorLoading, setVectorLoading] = useState(false);
  const [lightragLoading, setLightragLoading] = useState(false);
  const [vector, setVector] = useState(null);
  const [lightrag, setLightrag] = useState(null);
  const [error, setError] = useState(null);

  const [vectorElapsed, setVectorElapsed] = useState(0);
  const [lightragElapsed, setLightragElapsed] = useState(0);
  const [vectorFinal, setVectorFinal] = useState(null);
  const [lightragFinal, setLightragFinal] = useState(null);
  const [lightragPhase, setLightragPhase] = useState(null);

  const vectorStartRef = useRef(0);
  const lightragStartRef = useRef(0);
  const tickRef = useRef(null);
  const phasesRef = useRef([]);

  useEffect(() => () => clearInterval(tickRef.current), []);

  const run = useCallback(async (query) => {
    setError(null);
    setVector({ vector_answer: '', vector_sources: [] });
    setLightrag({ lightrag_answer: '', graph_nodes: [], graph_edges: [] });
    setVectorFinal(null);
    setLightragFinal(null);
    setVectorElapsed(0);
    setLightragElapsed(0);
    setLightragPhase(null);
    phasesRef.current = [];
    setVectorLoading(true);
    setLightragLoading(true);

    const t0 = performance.now();
    vectorStartRef.current = t0;
    lightragStartRef.current = t0;

    clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const now = performance.now();
      if (vectorStartRef.current) setVectorElapsed(now - vectorStartRef.current);
      if (lightragStartRef.current) {
        const dt = now - lightragStartRef.current;
        setLightragElapsed(dt);
        // Pick the latest phase whose at_ms has passed.
        const phases = phasesRef.current;
        if (phases.length) {
          let current = null;
          for (const p of phases) {
            if (dt >= p.at_ms) current = p.label;
            else break;
          }
          setLightragPhase(current);
        }
      }
    }, 50);

    const stopTickerIfDone = () => {
      if (!vectorStartRef.current && !lightragStartRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };

    const runVector = async () => {
      try {
        let answer = '';
        for await (const { event, data } of sseStream('/query/vector/stream', { query })) {
          if (event === 'sources') {
            setVector((prev) => ({ ...(prev || {}), vector_sources: data || [] }));
          } else if (event === 'token') {
            answer += typeof data === 'string' ? data : '';
            setVector((prev) => ({ ...(prev || {}), vector_answer: answer }));
          } else if (event === 'error') {
            setError((prev) => prev || `vector: ${data}`);
          } else if (event === 'done') {
            break;
          }
        }
      } catch (e) {
        setError((prev) => prev || `vector: ${e}`);
      } finally {
        const dt = performance.now() - vectorStartRef.current;
        setVectorElapsed(dt);
        setVectorFinal(dt);
        vectorStartRef.current = 0;
        setVectorLoading(false);
        stopTickerIfDone();
      }
    };

    const runLightrag = async () => {
      try {
        let answer = '';
        for await (const { event, data } of sseStream('/query/lightrag/stream', { query })) {
          if (event === 'phases') {
            phasesRef.current = Array.isArray(data) ? data : [];
          } else if (event === 'token') {
            // First real token: clear the phase narration.
            if (!answer) setLightragPhase(null);
            answer += typeof data === 'string' ? data : '';
            setLightrag((prev) => ({ ...(prev || {}), lightrag_answer: answer }));
          } else if (event === 'highlight') {
            setLightrag((prev) => ({
              ...(prev || {}),
              graph_nodes: data?.nodes || [],
              graph_edges: data?.edges || [],
            }));
          } else if (event === 'error') {
            setError((prev) => prev || `lightrag: ${data}`);
          } else if (event === 'done') {
            break;
          }
        }
      } catch (e) {
        setError((prev) => prev || `lightrag: ${e}`);
      } finally {
        const dt = performance.now() - lightragStartRef.current;
        setLightragElapsed(dt);
        setLightragFinal(dt);
        setLightragPhase(null);
        lightragStartRef.current = 0;
        setLightragLoading(false);
        stopTickerIfDone();
      }
    };

    runVector();
    runLightrag();
  }, []);

  const result =
    vector || lightrag
      ? {
          vector_answer: vector?.vector_answer,
          vector_sources: vector?.vector_sources || [],
          lightrag_answer: lightrag?.lightrag_answer,
          graph_nodes: lightrag?.graph_nodes || [],
          graph_edges: lightrag?.graph_edges || [],
        }
      : null;

  return {
    loading: vectorLoading || lightragLoading,
    vectorLoading,
    lightragLoading,
    result,
    error,
    run,
    timings: { vectorElapsed, lightragElapsed, vectorFinal, lightragFinal },
    lightragPhase,
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
