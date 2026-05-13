"""LightRAG initialization with DocumentDB-backed Mongo storages."""
from __future__ import annotations

import os
from functools import lru_cache

from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc

from config import (
    DB_NAME,
    DOCUMENTDB_URI,
    EMBED_DIM,
    EMBED_MODEL,
    LIGHTRAG_WORKING_DIR,
    LLM_MODEL,
    OPENAI_API_KEY,
    _clean_uri,
)


async def llm_model_func(prompt, system_prompt=None, history_messages=None, **kwargs):
    history_messages = history_messages or []
    return await openai_complete_if_cache(
        LLM_MODEL,
        prompt,
        system_prompt=system_prompt,
        history_messages=history_messages,
        api_key=OPENAI_API_KEY,
        **kwargs,
    )


async def embedding_func(texts: list[str]):
    return await openai_embed(
        texts,
        model=EMBED_MODEL,
        api_key=OPENAI_API_KEY,
    )


_rag: LightRAG | None = None


async def get_rag() -> LightRAG:
    global _rag
    if _rag is not None:
        return _rag

    os.makedirs(LIGHTRAG_WORKING_DIR, exist_ok=True)

    # Wire LightRAG's Mongo storages to our DocumentDB cluster.
    os.environ["MONGO_URI"] = _clean_uri(DOCUMENTDB_URI)
    os.environ["MONGO_DATABASE"] = DB_NAME
    os.environ["MONGO_KV_COLLECTION"] = "lightrag_kv"
    os.environ["MONGO_DOC_STATUS_COLLECTION"] = "lightrag_doc_status"
    os.environ["MONGO_GRAPH_COLLECTION"] = "lightrag_graph"

    rag = LightRAG(
        working_dir=LIGHTRAG_WORKING_DIR,
        llm_model_func=llm_model_func,
        embedding_func=EmbeddingFunc(
            embedding_dim=EMBED_DIM,
            max_token_size=8192,
            func=embedding_func,
        ),
        kv_storage="MongoKVStorage",
        graph_storage="MongoGraphStorage",
        doc_status_storage="MongoDocStatusStorage",
        # Atlas-only operators in MongoVectorDBStorage; use Nano (local) instead.
        vector_storage="NanoVectorDBStorage",
    )

    # LightRAG >= 1.1 requires explicit init for some storages
    if hasattr(rag, "initialize_storages"):
        await rag.initialize_storages()
    if hasattr(rag, "ainitialize"):
        await rag.ainitialize()

    _rag = rag
    return rag


def _fast_param(stream: bool = False) -> QueryParam:
    """Tuned QueryParam for the demo: smaller retrieval = fewer DocumentDB
    roundtrips = faster context-building. Mode `local` does single-path
    (entity-based) traversal — for an 8-doc corpus hybrid mode is overkill
    and roughly doubles the network calls without changing the answer."""
    return QueryParam(
        mode="local",
        top_k=10,
        chunk_top_k=5,
        max_entity_tokens=2000,
        max_relation_tokens=2000,
        max_total_tokens=6000,
        stream=stream,
    )


async def lightrag_insert(text: str) -> None:
    rag = await get_rag()
    await rag.ainsert(text)


async def lightrag_query(query: str) -> str:
    rag = await get_rag()
    result = await rag.aquery(query, param=_fast_param(stream=False))
    return result if isinstance(result, str) else str(result)


async def lightrag_query_stream(query: str):
    """Async generator yielding answer chunks as they're produced by LightRAG."""
    rag = await get_rag()
    result = await rag.aquery(query, param=_fast_param(stream=True))
    if isinstance(result, str):
        # Cached / non-streaming result — emit as a single chunk
        yield result
        return
    async for chunk in result:
        if chunk:
            yield chunk
