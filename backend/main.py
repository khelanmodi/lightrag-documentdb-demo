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
    """Run each preset once so LightRAG's LLM cache is hot for visitors."""
    for q in PRESET_QUERIES:
        try:
            await asyncio.gather(vector_answer(q), lightrag_query(q))
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


app = FastAPI(title="LightRAG vs Vector Search Demo", lifespan=lifespan)

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


@app.post("/query/vector")
async def query_vector(req: QueryReq):
    if not req.query.strip():
        raise HTTPException(400, "query is required")
    try:
        answer, sources = await vector_answer(req.query)
    except Exception as e:
        return {"vector_answer": f"Vector pipeline error: {e}", "vector_sources": []}
    return {"vector_answer": answer, "vector_sources": sources}


def _sse(event_type: str, data) -> bytes:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


@app.post("/query/vector/stream")
async def query_vector_stream(req: QueryReq):
    """Server-sent events: emits 'sources' once, 'token' per delta, then 'done'."""
    if not req.query.strip():
        raise HTTPException(400, "query is required")

    async def gen():
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
        answer = await lightrag_query(req.query)
    except Exception as e:
        answer = f"LightRAG pipeline error: {e}"
    highlight = highlight_for_answer(answer)
    return {
        "lightrag_answer": answer,
        "graph_nodes": highlight["nodes"],
        "graph_edges": highlight["edges"],
    }


@app.post("/query/lightrag/stream")
async def query_lightrag_stream(req: QueryReq):
    """SSE: emits 'token' per chunk, then 'highlight' + 'done' once complete."""
    if not req.query.strip():
        raise HTTPException(400, "query is required")

    async def gen():
        full_answer_parts: list[str] = []
        try:
            async for chunk in lightrag_query_stream(req.query):
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
    """Combined endpoint kept for backward compatibility; runs both in parallel."""
    if not req.query.strip():
        raise HTTPException(400, "query is required")

    async def _vec():
        try:
            return await vector_answer(req.query)
        except Exception as e:
            return (f"Vector pipeline error: {e}", [])

    async def _lr():
        try:
            return await lightrag_query(req.query)
        except Exception as e:
            return f"LightRAG pipeline error: {e}"

    (vec_ans, vec_sources), lr_ans = await asyncio.gather(_vec(), _lr())
    highlight = highlight_for_answer(lr_ans)
    return {
        "vector_answer": vec_ans,
        "lightrag_answer": lr_ans,
        "vector_sources": vec_sources,
        "graph_nodes": highlight["nodes"],
        "graph_edges": highlight["edges"],
    }


@app.get("/graph")
async def graph():
    return fetch_full_graph()


@app.get("/health")
async def health():
    return {"ok": True}
