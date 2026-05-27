"""Shared configuration and singletons.

Two LLM/embedding providers are supported transparently:

  * **Azure OpenAI** (preferred for Microsoft data): set
    ``AZURE_OPENAI_ENDPOINT`` + ``AZURE_OPENAI_API_KEY``. ``LLM_MODEL`` and
    ``EMBED_MODEL`` are then interpreted as Azure **deployment names**.
  * **OpenAI.com**: set ``OPENAI_API_KEY``. ``LLM_MODEL`` / ``EMBED_MODEL``
    are model ids (e.g. ``gpt-4o-mini``).

Selection is automatic: if ``AZURE_OPENAI_ENDPOINT`` is non-empty, the Azure
path is used.
"""
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from openai import AsyncAzureOpenAI, AsyncOpenAI

load_dotenv()

# --- OpenAI / Azure OpenAI --------------------------------------------------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview")
USE_AZURE_OPENAI = bool(AZURE_OPENAI_ENDPOINT)

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


if USE_AZURE_OPENAI:
    openai_client = AsyncAzureOpenAI(
        api_key=AZURE_OPENAI_API_KEY,
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_version=AZURE_OPENAI_API_VERSION,
        timeout=LLM_TIMEOUT,
    )
else:
    openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY, timeout=LLM_TIMEOUT)
