import { useCallback, useState } from 'react';

const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

export function useQuery() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, result, error, run };
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
