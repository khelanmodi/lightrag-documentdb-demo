# LightRAG vs Vector Search — Azure DocumentDB Demo

Side-by-side comparison of two RAG pipelines over the **same data** in a single Azure DocumentDB cluster:

| Pipeline | Storage | Retrieval |
|----------|---------|-----------|
| **Vector Search** | `vector_docs` collection + DocumentDB native vector index | Top-k cosine similarity |
| **LightRAG** | `lightrag_kv`, `lightrag_graph`, `lightrag_doc_status` (Mongo storages) | Graph-augmented hybrid (local + global) |

Same question → two answers rendered side-by-side, with a live D3 knowledge graph that lights up the entities LightRAG traversed.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  React + D3 + Tailwind  (Vite, :5173)                         │
│  • GraphPanel (force-directed, highlights query entities)     │
│  • QueryBar   (presets + free-form)                           │
│  • AnswerCards (Vector | LightRAG)                            │
└──────────────────────────────┬─────────────────────────────────┘
                               │  /query  /graph  /ingest
┌──────────────────────────────▼─────────────────────────────────┐
│  FastAPI  (uvicorn, :8000)                                    │
│  ├─ vector.py   pymongo + DocumentDB $search (cosmosSearch)   │
│  ├─ rag.py      LightRAG → MongoKV/Graph/DocStatus storages   │
│  ├─ graph.py    Reads lightrag_graph collection               │
│  └─ seed.py     Pre-loads 8-doc B2B SaaS fixture              │
└──────────────────────────────┬─────────────────────────────────┘
                               │  mongodb+srv://...cosmos.azure.com
┌──────────────────────────────▼─────────────────────────────────┐
│  Azure DocumentDB cluster                                      │
│  Collections: vector_docs (vector index)                       │
│               lightrag_kv, lightrag_graph, lightrag_doc_status │
└────────────────────────────────────────────────────────────────┘
```

---

## Quick start

### 1. Configure
`backend/.env` is preconfigured for the Azure DocumentDB cluster. Add your `OPENAI_API_KEY`:

```dotenv
OPENAI_API_KEY=sk-...
DOCUMENTDB_URI=mongodb+srv://USER:PASSWORD@YOUR-CLUSTER.global.mongocluster.cosmos.azure.com/?tls=true&retrywrites=false&maxIdleTimeMS=120000
DB_NAME=lightrag_demo
LLM_MODEL=gpt-4o-mini
EMBED_MODEL=text-embedding-3-small
```

### 2. Docker (easiest)
```bash
docker compose up --build
```
- Frontend: http://localhost:5173
- Backend:  http://localhost:8000/health

### 3. Local dev
```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

On first boot, the backend:
1. Creates a DocumentDB vector index on `vector_docs.embedding` (cosine, 1536d, HNSW).
2. Embeds + inserts the 8 seed documents.
3. Runs LightRAG entity extraction — this takes ~1–2 minutes the first time. Watch the logs.

---

## Demo queries (where the two pipelines diverge)

| Question | Vector returns | LightRAG returns |
|----------|----------------|------------------|
| *Why did Acme Corp churn?* | The renewal-loss doc | The full chain: discount → v2.3.1 bug → support spike → usage drop → NPS flag → no CSM intervention → churn |
| *Which of Sarah Chen's discount approvals are renewal risks?* | The discount doc | Sarah → Bravo (healthy) + Delta (unhealthy: 9 tickets, 44th percentile) → risk verdict |
| *What was the root cause of Acme's support escalations?* | The support-volume doc | Onboarding window → data import module → v2.3.1 bug → v2.3.4 patch |

---

## API

- `POST /ingest` — `{text, source}` → embeds into `vector_docs` **and** feeds LightRAG in parallel.
- `GET  /ingest/status` — counts from `vector_docs` and `lightrag_doc_status`.
- `POST /query` — `{query}` → runs both pipelines concurrently, returns answers + highlighted graph slice.
- `GET  /graph` — full nodes/edges from `lightrag_graph` for the visualization.

---

## DocumentDB-specific notes

- **No Atlas operators.** This demo uses DocumentDB's native vector index (`createIndexes` with `vectorOptions: {type: "hnsw", similarity: "cosine", dimensions: 1536}`) and `$search` with `cosmosSearch`. Falls back gracefully if signatures differ across DocumentDB builds, and to in-process cosine as a last resort.
- **LightRAG's `MongoVectorDBStorage` is Atlas-only.** We use `NanoVectorDBStorage` for LightRAG's internal vector cache (lives in `lightrag_storage/`), while **graph, KV, and doc-status all live in DocumentDB**.
- **Connection URI** uses the managed Azure DocumentDB SRV endpoint — `replicaSet=rs0` (used only when hitting the local gateway directly) is stripped automatically by `config._clean_uri`.
- **LLM timeout** is set to 120s — LightRAG's hybrid mode can chain several LLM calls.

---

## Project structure

```
lightrag-documentdb-demo/
├── backend/
│   ├── main.py        # FastAPI app, lifespan-seeds on startup
│   ├── config.py      # env + Mongo client singleton
│   ├── vector.py      # DocumentDB vector index + $search pipeline
│   ├── rag.py         # LightRAG init w/ Mongo* storages
│   ├── graph.py       # Reads lightrag_graph for viz + answer highlight
│   ├── seed.py        # 8-doc B2B SaaS fixture
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── components/
│   │   │   ├── GraphPanel.jsx
│   │   │   ├── QueryBar.jsx
│   │   │   ├── AnswerCards.jsx
│   │   │   └── colors.js
│   │   └── hooks/useQuery.js
│   ├── package.json, vite.config.js, tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Hosted demo

This repo ships with two GitHub Actions workflows:

| Workflow | What it does | Trigger |
|----------|--------------|---------|
| `.github/workflows/deploy-backend.yml`  | Builds `backend/Dockerfile` → pushes to GHCR → deploys to Azure Container Apps via `infra/containerapp.bicep` | push to `main` touching `backend/` or `infra/` |
| `.github/workflows/deploy-frontend.yml` | Builds `frontend/` with `VITE_BACKEND_URL` baked in → publishes to **GitHub Pages** | push to `main` touching `frontend/` |

### One-time setup

1. **Create an Azure service principal** scoped to the subscription (or a resource group) and copy the JSON output:
   ```bash
   az ad sp create-for-rbac --name lightrag-demo-deploy \
     --role contributor \
     --scopes /subscriptions/<SUB_ID> \
     --sdk-auth
   ```

2. **Add repository secrets** (Settings → Secrets and variables → Actions → New repository secret):
   - `AZURE_CREDENTIALS` — the JSON from step 1
   - `OPENAI_API_KEY`   — your OpenAI key
   - `DOCUMENTDB_URI`   — full `mongodb+srv://...` connection string
   - `GHCR_PULL_PAT`    — *optional*, a PAT with `read:packages` so Container Apps can pull the private image. If left blank, make the GHCR image public after the first push.

3. **Run the backend workflow first** (push or *Run workflow* in the Actions tab). When it finishes, copy the `Backend deployed at:` URL from the summary.

4. **Add a repository variable** (same Settings page, *Variables* tab):
   - `BACKEND_URL` = `https://lightrag-demo-backend.<random>.<region>.azurecontainerapps.io`

5. **Enable Pages**: Settings → Pages → Build and deployment → Source = **GitHub Actions**.

6. **Run the frontend workflow** (push to `frontend/` or *Run workflow*). Once green, the demo is live at:
   ```
   https://<owner>.github.io/<repo>/
   ```

### Cost & safety notes

- The Container Apps min replica is `1` to avoid cold starts during demos. Set to `0` in `infra/containerapp.bicep` for zero-cost idle.
- Every visitor query burns OpenAI tokens against **your** key. Consider adding a rate limiter (`slowapi`) before going public.
- The `corsPolicy` on the Container App allows `*`. Tighten to `https://<owner>.github.io` once your Pages URL is known.

---

## Definition of done ✅

- [x] Pre-populated knowledge graph rendered on load
- [x] Preset queries + free-form input
- [x] Both pipelines run in parallel (`asyncio.gather`) with per-card loading
- [x] Graph entities matching the LightRAG answer highlight; others dim
- [x] Ingest a new doc from the UI → graph refreshes
- [x] Works against Azure DocumentDB managed cluster (SRV) and local DocumentDB (OSS)
