"""Standard vector-search RAG pipeline backed by DocumentDB's native vector index."""
from __future__ import annotations

import uuid
from typing import Any

from pymongo.errors import OperationFailure

from config import (
    EMBED_DIM,
    EMBED_MODEL,
    LLM_MODEL,
    VECTOR_COLLECTION,
    get_db,
    openai_client,
)


async def embed_text(text: str) -> list[float]:
    resp = await openai_client.embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding


def ensure_vector_index() -> None:
    """Create DocumentDB native vector index (cosine, 1536d) if not present.

    Azure DocumentDB (Cosmos DB for MongoDB vCore) uses the `cosmosSearch` index plugin.
    """
    db = get_db()
    if VECTOR_COLLECTION not in db.list_collection_names():
        db.create_collection(VECTOR_COLLECTION)
    existing = {idx.get("name") for idx in db[VECTOR_COLLECTION].list_indexes()}
    if "vector_index" in existing:
        return

    attempts = [
        # Azure DocumentDB (Cosmos for Mongo vCore) — HNSW
        {
            "name": "vector_index",
            "key": {"embedding": "cosmosSearch"},
            "cosmosSearchOptions": {
                "kind": "vector-hnsw",
                "m": 16,
                "efConstruction": 64,
                "similarity": "COS",
                "dimensions": EMBED_DIM,
            },
        },
        # IVF fallback (always available even without HNSW)
        {
            "name": "vector_index",
            "key": {"embedding": "cosmosSearch"},
            "cosmosSearchOptions": {
                "kind": "vector-ivf",
                "numLists": 1,
                "similarity": "COS",
                "dimensions": EMBED_DIM,
            },
        },
        # DocumentDB OSS native vector index
        {
            "name": "vector_index",
            "key": {"embedding": "vector"},
            "vectorOptions": {
                "type": "hnsw",
                "similarity": "cosine",
                "dimensions": EMBED_DIM,
                "m": 16,
                "efConstruction": 64,
            },
        },
    ]

    for spec in attempts:
        try:
            db.command({"createIndexes": VECTOR_COLLECTION, "indexes": [spec]})
            print(f"[vector] created vector index using {spec.get('cosmosSearchOptions') or spec.get('vectorOptions')}")
            return
        except OperationFailure as e:
            print(f"[vector] index attempt failed: {e}")
    print("[vector] WARN: could not create any vector index — will fall back to in-process cosine")


async def insert_document(text: str, source: str) -> str:
    """Embed and store a document in vector_docs."""
    db = get_db()
    embedding = await embed_text(text)
    doc_id = str(uuid.uuid4())
    db[VECTOR_COLLECTION].insert_one({
        "_id": doc_id,
        "text": text,
        "source": source,
        "embedding": embedding,
    })
    return doc_id


async def vector_search(query: str, k: int = 5) -> list[dict[str, Any]]:
    db = get_db()
    qvec = await embed_text(query)

    # Azure DocumentDB (vCore) $search.cosmosSearch — does NOT support {$meta: "searchScore"} projection
    pipeline = [
        {"$search": {
            "cosmosSearch": {
                "vector": qvec,
                "path": "embedding",
                "k": k,
            },
            "returnStoredSource": True,
        }},
        {"$project": {
            "text": 1,
            "source": 1,
            "score": {"$meta": "searchScore"},
        }},
    ]

    try:
        results = list(db[VECTOR_COLLECTION].aggregate(pipeline))
    except OperationFailure:
        # Retry without score projection (older vCore builds)
        try:
            results = list(db[VECTOR_COLLECTION].aggregate([
                {"$search": {"cosmosSearch": {"vector": qvec, "path": "embedding", "k": k}}},
                {"$project": {"text": 1, "source": 1}},
            ]))
        except OperationFailure as e:
            print(f"[vector] $search failed, falling back to cosine in Python: {e}")
            results = _fallback_cosine(db, qvec, k)

    return [{"text": r.get("text", ""), "source": r.get("source", ""), "score": float(r.get("score", 0.0))} for r in results]


def _fallback_cosine(db, qvec, k):
    import math
    docs = list(db[VECTOR_COLLECTION].find({}, {"text": 1, "source": 1, "embedding": 1}))
    def cos(a, b):
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(y * y for y in b))
        return dot / (na * nb + 1e-9)
    scored = [{"text": d["text"], "source": d.get("source", ""), "score": cos(qvec, d["embedding"])} for d in docs]
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:k]


async def vector_answer(query: str) -> tuple[str, list[dict[str, Any]]]:
    sources = await vector_search(query, k=5)
    context = "\n\n".join(f"[Source {i+1}] {s['text']}" for i, s in enumerate(sources))
    prompt = (
        "Answer the question using ONLY the sources below. Be concise.\n\n"
        f"Sources:\n{context}\n\nQuestion: {query}\n\nAnswer:"
    )
    resp = await openai_client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    return resp.choices[0].message.content.strip(), sources


async def vector_answer_stream(query: str):
    """Async generator yielding ('sources', list) once, then ('token', str) repeatedly."""
    sources = await vector_search(query, k=5)
    yield ("sources", sources)

    context = "\n\n".join(f"[Source {i+1}] {s['text']}" for i, s in enumerate(sources))
    prompt = (
        "Answer the question using ONLY the sources below. Be concise.\n\n"
        f"Sources:\n{context}\n\nQuestion: {query}\n\nAnswer:"
    )
    stream = await openai_client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield ("token", delta)
