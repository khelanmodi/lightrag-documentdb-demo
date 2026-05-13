"""FastAPI app exposing /ingest, /query, /graph endpoints."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import LIGHTRAG_DOC_STATUS, VECTOR_COLLECTION, get_db
from graph import fetch_full_graph, highlight_for_answer
from rag import lightrag_insert, lightrag_query
from seed import seed_if_empty
from vector import ensure_vector_index, insert_document, vector_answer


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_vector_index()
    try:
        await seed_if_empty()
    except Exception as e:
        print(f"[startup] seed error (continuing): {e}")
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


@app.post("/query")
async def query(req: QueryReq):
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
