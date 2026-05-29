"""FastAPI app exposing /ingest, /query, /graph endpoints."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import LIGHTRAG_DOC_STATUS, VECTOR_COLLECTION, get_db
from graph import fetch_full_graph, highlight_for_answer
from rag import lightrag_insert, lightrag_query, lightrag_query_stream
from seed import seed_if_empty
from vector import ensure_vector_index, insert_document, vector_answer, vector_answer_stream

PRESET_QUERIES = [
    "Why did Acme Corp churn?",
    "Which of Sarah Chen's discount approvals are renewal risks?",
    "What was the root cause of Acme's support escalations?",
]


async def _prewarm_presets() -> None:
    """Run each preset once per retrieval mode so LightRAG's LLM cache is hot."""
    for q in PRESET_QUERIES:
        try:
            await asyncio.gather(
                vector_answer(q),
                lightrag_query(q, mode="local"),
                lightrag_query(q, mode="hybrid"),
            )
            print(f"[prewarm] cached: {q}")
        except Exception as e:
            print(f"[prewarm] {q!r} failed (continuing): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_vector_index()
    try:
        await seed_if_empty()
    except Exception as e:
        print(f"[startup] seed error (continuing): {e}")
    # Fire pre-warm in background so the app accepts traffic immediately.
    asyncio.create_task(_prewarm_presets())
    yield


app = FastAPI(title="DocumentDB: three retrieval strategies", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class IngestReq(BaseModel):
    text: str
    source: str = "user-upload"


class QueryReq(BaseModel):
    query: str
    # LightRAG retrieval mode for /query/lightrag* endpoints.
    # Accepted: "local" | "hybrid" | "global" | "mix" | "naive".
    # Ignored by the naive-RAG (DocumentDB-only) endpoints.
    mode: str = "local"


@app.post("/ingest")
async def ingest(req: IngestReq):
    if not req.text.strip():
        raise HTTPException(400, "text is required")

    async def _vector():
        return await insert_document(req.text, req.source)

    async def _lightrag():
        await lightrag_insert(req.text)

    doc_id, _ = await asyncio.gather(_vector(), _lightrag())
    return {"doc_id": doc_id, "status": "complete"}


@app.get("/ingest/status")
async def ingest_status():
    db = get_db()
    vec_count = db[VECTOR_COLLECTION].count_documents({})
    status_counts: dict[str, int] = {}
    if LIGHTRAG_DOC_STATUS in db.list_collection_names():
        for doc in db[LIGHTRAG_DOC_STATUS].find({}, {"status": 1}):
            s = doc.get("status", "unknown")
            status_counts[s] = status_counts.get(s, 0) + 1
    return {"vector_docs": vec_count, "lightrag_doc_status": status_counts}


@app.post("/query/naive")
@app.post("/query/vector")  # back-compat alias
async def query_naive(req: QueryReq):
    if not req.query.strip():
        raise HTTPException(400, "query is required")
    try:
        answer, sources = await vector_answer(req.query)
    except Exception as e:
        return {"naive_answer": f"Naive RAG pipeline error: {e}", "naive_sources": [],
                "vector_answer": f"Naive RAG pipeline error: {e}", "vector_sources": []}
    # New canonical fields + legacy `vector_*` fields for any older client.
    return {
        "naive_answer": answer,
        "naive_sources": sources,
        "vector_answer": answer,
        "vector_sources": sources,
    }


def _sse(event_type: str, data) -> bytes:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


@app.post("/query/naive/stream")
@app.post("/query/vector/stream")  # back-compat alias
async def query_naive_stream(req: QueryReq):
    """SSE: emits 'phases' immediately, 'sources' once, 'token' per delta, then 'done'.

    The leading 'phases' frame is a sentinel that flushes response bytes the
    moment headers land — without it Safari's fetch() rejects with
    `TypeError: Load failed` during the embed+cosine search dead-air.
    """
    if not req.query.strip():
        raise HTTPException(400, "query is required")

    async def gen():
        # Emit a sentinel frame immediately so the browser sees response bytes
        # the moment headers land. Without this, Safari's fetch() can reject
        # with `TypeError: Load failed` during the ~300ms-2s embed+cosine
        # search dead-air before the first `sources` event.
        yield _sse("phases", [
            {"at_ms": 0,    "label": "Embedding query…"},
            {"at_ms": 600,  "label": "Running cosine search on DocumentDB…"},
            {"at_ms": 1500, "label": "Stuffing top chunks into the prompt…"},
            {"at_ms": 2500, "label": "Generating answer…"},
        ])
        try:
            async for kind, payload in vector_answer_stream(req.query):
                yield _sse(kind, payload)
        except Exception as e:
            yield _sse("error", str(e))
        yield _sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.post("/query/lightrag")
async def query_lightrag(req: QueryReq):
    if not req.query.strip():
        raise HTTPException(400, "query is required")
    try:
        answer = await lightrag_query(req.query, mode=req.mode)
    except Exception as e:
        answer = f"LightRAG pipeline error: {e}"
    highlight = highlight_for_answer(answer)
    return {
        "lightrag_answer": answer,
        "mode": req.mode,
        "graph_nodes": highlight["nodes"],
        "graph_edges": highlight["edges"],
    }


@app.post("/query/lightrag/stream")
async def query_lightrag_stream(req: QueryReq):
    """SSE: emits 'phases' once, 'token' per chunk, 'highlight' + 'done' at end."""
    if not req.query.strip():
        raise HTTPException(400, "query is required")

    is_hybrid = req.mode in ("hybrid", "mix")

    async def gen():
        # Tell the UI what phases LightRAG goes through. Times are approximate;
        # the UI cycles through them until the first real token arrives.
        if is_hybrid:
            yield _sse("phases", [
                {"at_ms": 0,    "label": "Extracting query keywords…"},
                {"at_ms": 800,  "label": "Local pass: searching entity vectors…"},
                {"at_ms": 2000, "label": "Global pass: searching relationship vectors…"},
                {"at_ms": 3500, "label": "Merging multi-hop graph context…"},
                {"at_ms": 5000, "label": "Generating answer…"},
            ])
        else:
            yield _sse("phases", [
                {"at_ms": 0,    "label": "Extracting query keywords…"},
                {"at_ms": 800,  "label": "Searching entity vectors in DocumentDB…"},
                {"at_ms": 1800, "label": "Fetching 1-hop graph neighbors…"},
                {"at_ms": 3000, "label": "Assembling synthesis context…"},
                {"at_ms": 4500, "label": "Generating answer…"},
            ])

        full_answer_parts: list[str] = []
        try:
            async for chunk in lightrag_query_stream(req.query, mode=req.mode):
                full_answer_parts.append(chunk)
                yield _sse("token", chunk)
        except Exception as e:
            err = f"LightRAG pipeline error: {e}"
            full_answer_parts.append(err)
            yield _sse("error", err)

        full_answer = "".join(full_answer_parts)
        highlight = highlight_for_answer(full_answer)
        yield _sse("highlight", highlight)
        yield _sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.post("/query")
async def query(req: QueryReq):
    """Combined endpoint: runs naive RAG + LightRAG-local + LightRAG-hybrid in parallel."""
    if not req.query.strip():
        raise HTTPException(400, "query is required")

    async def _naive():
        try:
            return await vector_answer(req.query)
        except Exception as e:
            return (f"Naive RAG pipeline error: {e}", [])

    async def _lr_local():
        try:
            return await lightrag_query(req.query, mode="local")
        except Exception as e:
            return f"LightRAG-local pipeline error: {e}"

    async def _lr_hybrid():
        try:
            return await lightrag_query(req.query, mode="hybrid")
        except Exception as e:
            return f"LightRAG-hybrid pipeline error: {e}"

    (naive_ans, naive_sources), lr_local_ans, lr_hybrid_ans = await asyncio.gather(
        _naive(), _lr_local(), _lr_hybrid()
    )
    # Graph highlight covers entities mentioned by either LightRAG mode.
    highlight = highlight_for_answer("\n\n".join([lr_local_ans, lr_hybrid_ans]))
    return {
        "naive_answer": naive_ans,
        "naive_sources": naive_sources,
        "lightrag_local_answer": lr_local_ans,
        "lightrag_hybrid_answer": lr_hybrid_ans,
        # Legacy fields for older clients.
        "vector_answer": naive_ans,
        "vector_sources": naive_sources,
        "lightrag_answer": lr_local_ans,
        "graph_nodes": highlight["nodes"],
        "graph_edges": highlight["edges"],
    }


@app.get("/graph")
async def graph():
    return fetch_full_graph()


@app.get("/health")
async def health():
    return {"ok": True}
