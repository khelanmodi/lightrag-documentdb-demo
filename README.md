# Three Retrieval Strategies on Azure DocumentDB

Same store. Same data. Same LLM. **Three retrieval strategies rendered side-by-side**, so it's obvious which work the graph is actually doing.

| Strategy | Storage path | Retrieval |
|---|---|---|
| **Naive RAG** | `vector_docs` collection + DocumentDB native vector index | Top-k cosine over chunk embeddings |
| **LightRAG · Local** | `lightrag_kv` + `lightrag_graph` + `lightrag_doc_status` | Entity vectors → 1-hop graph → chunks |
| **LightRAG · Hybrid** | (same) | Local + global (relationship vectors → connected entities → chunks) |

> [!NOTE]
> This is **not** "DocumentDB vs LightRAG" — that'd be apples-to-oranges (DocumentDB is the substrate, LightRAG is a full graph-augmented retrieval system that uses it). The three panels above are three retrieval **strategies**, all running against the same Azure DocumentDB cluster, all answering the same question. Toggle them on/off in the UI to isolate any one.

A live D3 knowledge graph highlights the entities either LightRAG mode traversed.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  React + D3 + Tailwind  (Vite, :5173)                                 │
│  • GraphPanel  (force-directed; highlights LightRAG-traversed entities)│
│  • QueryBar    (3 strategy toggles + presets + free-form)              │
│  • AnswerCards (Naive RAG · LightRAG-Local · LightRAG-Hybrid)          │
└──────────────────────────────┬─────────────────────────────────────────┘
              /query/naive/stream │ /query/lightrag/stream?mode={local|hybrid}
                                  │ /graph  /ingest
┌──────────────────────────────────▼─────────────────────────────────────┐
│  FastAPI  (uvicorn, :8000)                                            │
│  ├─ vector.py   pymongo + DocumentDB $search (cosmosSearch)           │
│  ├─ rag.py      LightRAG → MongoKV/Graph/DocStatus (+Nano vectors)    │
│  ├─ graph.py    Reads lightrag_graph collection                       │
│  └─ seed.py     Pre-loads 8-doc B2B SaaS fixture                      │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │  mongodb+srv://...cosmos.azure.com
┌──────────────────────────────────▼─────────────────────────────────────┐
│  Azure DocumentDB cluster   ← shared substrate for all three strategies│
│  Collections:                                                          │
│    vector_docs                  (Naive RAG)                            │
│    lightrag_kv                  (LightRAG: KV)                         │
│    lightrag_graph               (LightRAG: graph nodes + edges)        │
│    lightrag_doc_status          (LightRAG: ingest state)               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Quick start

### 1. Configure
Copy the sample env files and fill in your secrets:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env   # optional — only needed for non-default backend URL
```

At minimum, set the LLM provider and `DOCUMENTDB_URI` in `backend/.env`.

**Provider — pick one** (Azure wins if both are set):

```dotenv
# (A) Azure OpenAI — preferred for Microsoft data (MSProtect-sanctioned)
AZURE_OPENAI_ENDPOINT=https://your-aoai.openai.azure.com/
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_API_VERSION=2024-08-01-preview

# (B) OpenAI.com — fine for external/demo data only
OPENAI_API_KEY=sk-...
```

Then everything else:

```dotenv
DOCUMENTDB_URI=mongodb://USER:PASSWORD@YOUR-CLUSTER.global.mongocluster.cosmos.azure.com:10260/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000
DB_NAME=lightrag_demo
LLM_MODEL=gpt-4o-mini              # Azure: deployment name
EMBED_MODEL=text-embedding-3-small # Azure: deployment name
```

When `AZURE_OPENAI_ENDPOINT` is set, `LLM_MODEL` / `EMBED_MODEL` are
interpreted as Azure **deployment names** (easiest: name each deployment
after the underlying model id so the same template works for both
providers).

<details>
<summary>One-shot Azure OpenAI provisioning</summary>

```bash
RG="german-$(date +%Y%m%d)-rg"
AOAI="german-lightrag-$(date +%Y%m%d)"
LOC=eastus2

az group create -n "$RG" -l "$LOC" -o none
az cognitiveservices account create \
  -n "$AOAI" -g "$RG" -l "$LOC" \
  --kind OpenAI --sku S0 --yes --custom-domain "$AOAI" -o none

az cognitiveservices account deployment create -g "$RG" -n "$AOAI" \
  --deployment-name gpt-4o-mini --model-name gpt-4o-mini --model-version 2024-07-18 \
  --model-format OpenAI --sku-capacity 50 --sku-name GlobalStandard
az cognitiveservices account deployment create -g "$RG" -n "$AOAI" \
  --deployment-name text-embedding-3-small --model-name text-embedding-3-small --model-version 1 \
  --model-format OpenAI --sku-capacity 50 --sku-name Standard

az cognitiveservices account show -g "$RG" -n "$AOAI" --query properties.endpoint -o tsv
az cognitiveservices account keys list -g "$RG" -n "$AOAI" --query key1 -o tsv
```

</details>

See `backend/.env.example` for the full list with inline comments.

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
4. Pre-warms the LLM cache for the preset queries across **all three strategies** so the first visitor sees fast responses.

---

## Demo queries (where the three strategies diverge)

| Question | Naive RAG | LightRAG · Local | LightRAG · Hybrid |
|---|---|---|---|
| *Why did Acme Corp churn?* | The single renewal-loss doc | Direct chain via the **Acme** entity → support volume → churn outcome | Full multi-hop: discount → v2.3.1 bug → support spike → usage drop → NPS flag → no CSM → churn |
| *Which of Sarah Chen's discount approvals are renewal risks?* | The discount doc | **Sarah** → Bravo (healthy) + Delta (unhealthy) verdict | + relationship-level context on **why** Delta is high-risk (ties Delta back into the bug + onboarding chain) |
| *What was the root cause of Acme's support escalations?* | The support-volume doc | Onboarding → data-import module → v2.3.1 bug → v2.3.4 patch | + cross-entity verification: same chain plus the QA gap and customer-success policy that let it ship |

The pattern: **Naive** retrieves one chunk and stops; **Local** walks one hop from a hit entity; **Hybrid** runs both local + global passes and merges, surfacing chains a single-entity hit would miss.

---

## API

- `POST /ingest` — `{text, source}` → embeds into `vector_docs` **and** feeds LightRAG in parallel.
- `GET  /ingest/status` — counts from `vector_docs` and `lightrag_doc_status`.
- `POST /query/naive` (alias: `/query/vector`) — naive RAG only.
- `POST /query/naive/stream` — same, SSE.
- `POST /query/lightrag` — `{query, mode}` where `mode ∈ {local, hybrid, global, mix}`. Defaults to `local`.
- `POST /query/lightrag/stream` — same, SSE (emits per-mode `phases`, then `token` chunks, then `highlight`).
- `POST /query` — runs **all three** strategies concurrently; returns `naive_answer`, `lightrag_local_answer`, `lightrag_hybrid_answer` + sources + graph highlight (union of entities both LightRAG modes touched).
- `GET  /graph` — full nodes/edges from `lightrag_graph` for the visualization.

---

## Run this on Kubernetes

Looking to deploy LightRAG against an **operator-provisioned** DocumentDB instance instead of a managed cluster? See the sibling playground at:

```
documentdb-kubernetes-operator/documentdb-playground/lightrag/
```

It ships:

- A Helm chart for `lightrag-server` (upstream `ghcr.io/hkuds/lightrag` image).
- **In-cluster Ollama** (`qwen2.5:3b` + `nomic-embed-text`) — no OpenAI key required.
- Automatic DocumentDB connection-string wiring from the CRD's `status.connectionString`.
- The same `MongoKVStorage` + `MongoGraphStorage` + `MongoDocStatusStorage` layout this repo uses.

The k8s playground does **not** include this demo's three-panel comparison UI — it exposes LightRAG's built-in WebUI on port 9621. Use **this repo** for the side-by-side teaching story; use the **k8s playground** for the operator integration story.

---

## DocumentDB-specific notes

- **DocumentDB version.** OSS DocumentDB images require `0.110.0+` to be fully compatible with LightRAG's Mongo storages (PR #459 fixed the `_id` lookup path LightRAG depends on). Managed Azure DocumentDB has this fix in place already.
- **No Atlas operators.** This demo uses DocumentDB's native vector index (`createIndexes` with `vectorOptions: {type: "hnsw", similarity: "cosine", dimensions: 1536}`) and `$search` with `cosmosSearch`. Falls back gracefully if signatures differ across DocumentDB builds, and to in-process cosine as a last resort.
- **LightRAG's `MongoVectorDBStorage` is Atlas-only.** We use `NanoVectorDBStorage` for LightRAG's internal vector cache (lives in `lightrag_storage/`), while **graph, KV, and doc-status all live in DocumentDB**.
- **Connection URI** uses the managed Azure DocumentDB SRV endpoint — `replicaSet=rs0` (used only when hitting the local gateway directly) is stripped automatically by `config._clean_uri`. The k8s playground does the same strip in its `scripts/deploy.sh`.
- **LLM timeout** is set to 120s — LightRAG's hybrid mode can chain several LLM calls.

---

## Project structure

```
lightrag-documentdb-demo/
├── backend/
│   ├── main.py        # FastAPI app, lifespan-seeds on startup
│   ├── config.py      # env + Mongo client singleton
│   ├── vector.py      # DocumentDB vector index + $search pipeline (naive RAG path)
│   ├── rag.py         # LightRAG init w/ Mongo* storages, mode-parameterized query
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
│   │   │   ├── QueryBar.jsx        # three strategy toggles + presets
│   │   │   ├── AnswerCards.jsx     # three cards
│   │   │   └── colors.js
│   │   └── hooks/useQuery.js       # per-mode state, runs only selected modes
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
- Every visitor query burns OpenAI tokens against **your** key — and the combined `/query` endpoint now runs **three** retrieval paths per question. Consider adding a rate limiter (`slowapi`) before going public, or letting visitors deselect modes in the UI to cut spend.
- The `corsPolicy` on the Container App allows `*`. Tighten to `https://<owner>.github.io` once your Pages URL is known.

---

## Definition of done ✅

- [x] Pre-populated knowledge graph rendered on load
- [x] Preset queries + free-form input
- [x] Three retrieval strategies (Naive RAG / LightRAG-Local / LightRAG-Hybrid) run concurrently with per-card loading
- [x] Strategy toggles let the user collapse to one or two panels (≥1 required)
- [x] Per-mode phase narration ("Local pass…", "Global pass…", "Merging…") while LightRAG works
- [x] Graph entities matching either LightRAG answer highlight; others dim
- [x] Ingest a new doc from the UI → graph refreshes
- [x] Works against Azure DocumentDB managed cluster (SRV) and local DocumentDB OSS `0.110.0+`
- [x] Mirrors the storage layout of the [`documentdb-kubernetes-operator`](https://github.com/microsoft/documentdb-kubernetes-operator) LightRAG playground so the operator deployment path stays one config-swap away
