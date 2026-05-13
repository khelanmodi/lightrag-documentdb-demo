"""Shared configuration and singletons."""
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from openai import AsyncOpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DOCUMENTDB_URI = os.getenv("DOCUMENTDB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "lightrag_demo")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")
EMBED_DIM = int(os.getenv("EMBED_DIM", "1536"))
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "120"))
LIGHTRAG_WORKING_DIR = os.getenv("LIGHTRAG_WORKING_DIR", "./lightrag_storage")

VECTOR_COLLECTION = "vector_docs"
# LightRAG 1.4 uses these collection names regardless of MONGO_* env vars
LIGHTRAG_NODES = "chunk_entity_relation"
LIGHTRAG_EDGES = "chunk_entity_relation_edges"
LIGHTRAG_DOC_STATUS = "doc_status"
LIGHTRAG_KV = "text_chunks"


def _clean_uri(uri: str) -> str:
    # DocumentDB gateway: strip replicaSet=rs0 if present
    parts = uri.split("?", 1)
    if len(parts) == 1:
        return uri
    params = [p for p in parts[1].split("&") if not p.lower().startswith("replicaset=")]
    return parts[0] + ("?" + "&".join(params) if params else "")


_mongo_client: MongoClient | None = None


def get_mongo() -> MongoClient:
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(_clean_uri(DOCUMENTDB_URI))
    return _mongo_client


def get_db():
    return get_mongo()[DB_NAME]


openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=LLM_TIMEOUT)
