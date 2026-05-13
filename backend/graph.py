"""Query graph nodes/edges from LightRAG's MongoGraphStorage collections.

LightRAG 1.4 schema in DocumentDB:
  - chunk_entity_relation:        node docs (_id=entity name, entity_type, description)
  - chunk_entity_relation_edges:  edge docs (source_node_id, target_node_id, description, keywords)
"""
from __future__ import annotations

import re
from typing import Any

from config import LIGHTRAG_EDGES, LIGHTRAG_NODES, get_db


def _clean(label: str) -> str:
    return str(label or "").strip().strip('"').strip("'")


def _node_doc_to_obj(doc: dict) -> dict[str, Any]:
    name = _clean(doc.get("entity_id") or doc.get("_id"))
    etype = doc.get("entity_type") or "concept"
    return {
        "id": name,
        "label": name,
        "type": _clean(etype).lower(),
        "description": doc.get("description", ""),
    }


def fetch_full_graph() -> dict[str, list[dict[str, Any]]]:
    db = get_db()
    cols = set(db.list_collection_names())
    if LIGHTRAG_NODES not in cols:
        return {"nodes": [], "edges": []}

    nodes: list[dict[str, Any]] = []
    node_ids: set[str] = set()
    for d in db[LIGHTRAG_NODES].find({}):
        n = _node_doc_to_obj(d)
        if n["id"] and n["id"] not in node_ids:
            node_ids.add(n["id"])
            nodes.append(n)

    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    if LIGHTRAG_EDGES in cols:
        for d in db[LIGHTRAG_EDGES].find({}):
            src = _clean(d.get("source_node_id"))
            tgt = _clean(d.get("target_node_id"))
            if not src or not tgt:
                continue
            key = tuple(sorted([src, tgt]))
            if key in seen:
                continue
            seen.add(key)
            edges.append({
                "source": src,
                "target": tgt,
                "relation": d.get("description") or d.get("keywords") or "",
            })

    # Backfill any edge endpoints missing from the node list
    for e in edges:
        for nid in (e["source"], e["target"]):
            if nid not in node_ids:
                node_ids.add(nid)
                nodes.append({"id": nid, "label": nid, "type": "concept", "description": ""})

    return {"nodes": nodes, "edges": edges}


def highlight_for_answer(answer: str) -> dict[str, list[dict[str, Any]]]:
    """Approximate: return nodes whose labels appear in answer text + 1-hop neighbors."""
    full = fetch_full_graph()
    text = (answer or "").lower()
    if not text:
        return {"nodes": [], "edges": []}

    matched: set[str] = set()
    for n in full["nodes"]:
        label = n["label"].lower()
        if not label or len(label) < 2:
            continue
        # word-boundary match for multi-char labels; substring for short ones
        pattern = r"\b" + re.escape(label) + r"\b"
        if re.search(pattern, text):
            matched.add(n["id"])

    if not matched:
        return {"nodes": [], "edges": []}

    relevant_edges = [
        e for e in full["edges"]
        if e["source"] in matched or e["target"] in matched
    ]
    expanded = set(matched)
    for e in relevant_edges:
        expanded.add(e["source"])
        expanded.add(e["target"])

    nodes_out = [n for n in full["nodes"] if n["id"] in expanded]
    edges_out = [e for e in full["edges"] if e["source"] in expanded and e["target"] in expanded]
    return {"nodes": nodes_out, "edges": edges_out}
