import { useEffect, useState } from 'react';
import GraphPanel from './components/GraphPanel.jsx';
import QueryBar from './components/QueryBar.jsx';
import AnswerCards from './components/AnswerCards.jsx';
import { useQuery, fetchGraph, ingestDocument } from './hooks/useQuery.js';

export default function App() {
  const { loading, vectorLoading, lightragLoading, result, error, run, timings, lightragPhase } = useQuery();
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [graphLoading, setGraphLoading] = useState(true);
  const [ingestText, setIngestText] = useState('');
  const [ingesting, setIngesting] = useState(false);

  const refreshGraph = async () => {
    setGraphLoading(true);
    try { setGraph(await fetchGraph()); }
    catch (e) { console.error('graph fetch failed', e); }
    finally { setGraphLoading(false); }
  };

  useEffect(() => { refreshGraph(); }, []);

  const handleIngest = async () => {
    if (!ingestText.trim() || ingesting) return;
    setIngesting(true);
    try {
      await ingestDocument(ingestText.trim(), 'user-upload');
      setIngestText('');
      await refreshGraph();
    } catch (e) {
      alert('Ingest failed: ' + e);
    } finally {
      setIngesting(false);
    }
  };

  const highlight = result
    ? { nodes: result.graph_nodes || [], edges: result.graph_edges || [] }
    : null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">LightRAG vs Vector Search</h1>
          <p className="text-xs text-slate-400">Same data. Same question. Two retrieval strategies. — Azure DocumentDB</p>
        </div>
        <div className="text-xs text-slate-400 text-right">
          <div>{graphLoading ? 'Loading graph…' : `${graph.nodes.length} entities · ${graph.edges.length} relationships`}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">LightRAG first run ~10–20s · repeats are cached</div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-3 p-3">
        <section className="lg:col-span-2 h-[calc(100vh-72px)]">
          <GraphPanel graph={graph} highlight={highlight} />
        </section>

        <section className="lg:col-span-3 flex flex-col gap-3 overflow-y-auto">
          <QueryBar onSubmit={run} loading={loading} />
          {error && (
            <div className="text-sm text-red-300 bg-red-900/30 border border-red-800 rounded p-2">{error}</div>
          )}
          <AnswerCards
            result={result}
            vectorLoading={vectorLoading}
            lightragLoading={lightragLoading}
            timings={timings}
            lightragPhase={lightragPhase}
          />

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="text-sm font-semibold text-slate-200 mb-2">Ingest a new document</div>
            <textarea
              className="w-full h-20 bg-slate-950 border border-slate-700 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Paste text to add to both pipelines…"
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              disabled={ingesting}
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={handleIngest}
                disabled={ingesting || !ingestText.trim()}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded text-sm font-medium"
              >
                {ingesting ? 'Processing…' : 'Ingest & rebuild graph'}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
