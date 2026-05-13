"""Pre-load the fictional B2B SaaS dataset on first startup."""
from __future__ import annotations

import asyncio

from config import LIGHTRAG_DOC_STATUS, VECTOR_COLLECTION, get_db
from rag import lightrag_insert
from vector import ensure_vector_index, insert_document

SEED_DOCS = [
    ("acme-q3-deal", "Acme Corp signed a $240k deal in Q3 after a 6-month sales cycle. The deal included a 20% discount approved by the VP of Sales, Sarah Chen. The account was flagged as strategic."),
    ("acme-support-volume", "Acme Corp's support ticket volume increased 340% in the 90 days following onboarding. Tier-2 escalations were required for 4 of 11 tickets. The primary issues were related to the data import module."),
    ("import-module-bug", "The data import module had a known bug introduced in release v2.3.1 that caused timeout errors for files above 500MB. A patch was shipped in v2.3.4."),
    ("acme-usage-drop", "Acme Corp's product usage dropped from the 72nd percentile to the 31st percentile between months 3 and 5. Feature adoption for the analytics dashboard was particularly low."),
    ("acme-churn", "Acme Corp did not renew at the end of Q1. The renewal was lost to a competitor. The AE noted that the customer cited 'poor initial experience' and 'unresolved technical issues' as reasons."),
    ("acme-at-risk", "The customer success team flagged Acme Corp as at-risk in month 4 based on the NPS score of 22 and declining logins. No intervention was executed due to CSM capacity constraints."),
    ("sarah-other-discounts", "Sarah Chen approved two other discounts above 15% in Q3: Bravo Inc (18%) and Delta LLC (22%). Both accounts are currently in their renewal quarter."),
    ("bravo-delta-health", "Bravo Inc has submitted 2 support tickets in 6 months. Product usage is at the 88th percentile. Delta LLC has submitted 9 tickets and usage is at the 44th percentile."),
]


async def seed_if_empty() -> None:
    db = get_db()
    ensure_vector_index()

    vec_count = db[VECTOR_COLLECTION].count_documents({})
    needs_vector = vec_count == 0

    # LightRAG ingestion is idempotent by content hash; only seed if doc_status is empty
    needs_lightrag = (
        LIGHTRAG_DOC_STATUS not in db.list_collection_names()
        or db[LIGHTRAG_DOC_STATUS].count_documents({}) == 0
    )

    if not needs_vector and not needs_lightrag:
        print("[seed] dataset already present; skipping")
        return

    print(f"[seed] needs_vector={needs_vector} needs_lightrag={needs_lightrag}")

    for source, text in SEED_DOCS:
        if needs_vector:
            try:
                await insert_document(text, source)
                print(f"[seed] vector inserted: {source}")
            except Exception as e:
                print(f"[seed] vector insert FAILED for {source}: {e}")

    if needs_lightrag:
        # Ingest sequentially to keep entity extraction stable
        for source, text in SEED_DOCS:
            try:
                await lightrag_insert(text)
                print(f"[seed] lightrag inserted: {source}")
            except Exception as e:
                print(f"[seed] lightrag insert FAILED for {source}: {e}")

    print("[seed] done")


if __name__ == "__main__":
    asyncio.run(seed_if_empty())
