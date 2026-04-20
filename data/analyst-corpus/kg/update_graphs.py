#!/usr/bin/env python3
"""
Update Knowledge Graphs with Framework Nodes + Temporal Edges
==============================================================
Loads evolved framework data and writes framework nodes + edges into ChromaDB
alongside the existing entities. Then regenerates the per-analyst HTML graphs.

Stores framework-specific edges in a dedicated collection (`framework_edges`)
to avoid polluting the existing `chunks` collection. Framework nodes are
added to the existing `entities` collection with entity_type="framework".

Usage:
    python update_graphs.py
    python update_graphs.py --analyst thiccyth0t
    python update_graphs.py --dry-run           # Don't write to ChromaDB
    python update_graphs.py --skip-viz          # Don't regenerate HTML
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import chromadb
except ImportError:
    sys.stderr.write("chromadb not installed\n")
    sys.exit(1)


HERE = Path(__file__).parent
EVOLVED_DIR = HERE / "frameworks_evolved"
DB_PATH = str(HERE / "chroma_db")
ANALYSTS = ["thiccyth0t", "TopherGMI", "shaundadevens"]

# Edge types we create
EDGE_APPLIES_TO = "applies_to"           # framework → entity
EDGE_REFINED_FROM = "refined_from"       # version v → version v-1
EDGE_SHIFTED_FROM = "shifted_from"       # version v → version v-1
EDGE_CONVERGES_WITH = "converges_with"   # framework_a → framework_b (cross-analyst)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _hash(*parts) -> str:
    return hashlib.sha1("||".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _framework_node_id(analyst: str, fw_id: str) -> str:
    return f"fw::{analyst}::{fw_id}"


def _load_evolved(analyst: str) -> dict | None:
    p = EVOLVED_DIR / f"{analyst}_frameworks_evolved.json"
    if not p.exists():
        print(f"  ! missing {p}")
        return None
    return json.loads(p.read_text())


# ─── ChromaDB writes ─────────────────────────────────────────────────────────

def _get_or_create(client, name: str):
    try:
        return client.get_collection(name)
    except Exception:
        return client.create_collection(name)


def _delete_existing_framework_data(client, analyst: str) -> None:
    """Remove framework nodes + edges for this analyst so re-runs are idempotent."""
    ents = _get_or_create(client, "entities")
    try:
        ents.delete(where={"$and": [
            {"analyst": {"$eq": analyst}},
            {"entity_type": {"$eq": "framework"}},
        ]})
    except Exception as e:
        print(f"    (entities prune skipped: {e})")
    edges = _get_or_create(client, "framework_edges")
    try:
        edges.delete(where={"analyst": {"$eq": analyst}})
    except Exception as e:
        print(f"    (edges prune skipped: {e})")


def write_frameworks(client, analyst: str, payload: dict) -> tuple[int, int]:
    """Write framework nodes + edges for one analyst. Returns (nodes, edges)."""
    ents = _get_or_create(client, "entities")
    edges = _get_or_create(client, "framework_edges")

    # ── Nodes: one per framework ─────────────────────────────────────────────
    node_ids: list[str] = []
    node_docs: list[str] = []
    node_metas: list[dict] = []
    for fw in payload["frameworks"]:
        node_id = _framework_node_id(analyst, fw["id"])
        doc = (
            f"{fw['name']}. {fw.get('description', '')} "
            f"Category: {fw.get('category', 'qualitative')}. "
            f"Applications: {fw.get('total_applications', 0)}. "
            f"Entities: {', '.join(fw.get('entities_connected', []))}"
        )
        node_ids.append(node_id)
        node_docs.append(doc)
        node_metas.append({
            "analyst": analyst,
            "entity_name": fw["name"],
            "entity_type": "framework",
            "framework_id": fw["id"],
            "category": fw.get("category", "qualitative"),
            "status": fw.get("status", "active"),
            "first_seen": fw.get("first_seen", ""),
            "last_seen": fw.get("last_seen", ""),
            "mention_count": fw.get("total_applications", 0),
            "version_count": len(fw.get("versions", [])),
        })

    if node_ids:
        ents.upsert(ids=node_ids, documents=node_docs, metadatas=node_metas)

    # ── Edges ────────────────────────────────────────────────────────────────
    edge_ids: list[str] = []
    edge_docs: list[str] = []
    edge_metas: list[dict] = []

    def add_edge(source: str, target: str, etype: str, **extra):
        eid = _hash(analyst, source, target, etype,
                    extra.get("version_from", ""), extra.get("version_to", ""))
        meta = {
            "analyst": analyst,
            "source": source,
            "target": target,
            "edge_type": etype,
        }
        meta.update({k: v for k, v in extra.items() if v is not None})
        edge_ids.append(eid)
        edge_docs.append(f"{source} --[{etype}]--> {target}")
        edge_metas.append(meta)

    for fw in payload["frameworks"]:
        fw_node = _framework_node_id(analyst, fw["id"])

        # APPLIES_TO: framework → each connected entity
        for entity_name in fw.get("entities_connected", []):
            if not entity_name:
                continue
            add_edge(
                source=fw_node,
                target=entity_name,
                etype=EDGE_APPLIES_TO,
                target_kind="entity",
                weight=fw.get("total_applications", 1),
            )

        # REFINED_FROM / SHIFTED_FROM: version-to-version temporal edges
        versions = fw.get("versions", [])
        for i, v in enumerate(versions):
            if i == 0:
                continue
            et = v.get("evolution_type", "")
            if et == "refinement":
                edge_type = EDGE_REFINED_FROM
            elif et == "shift":
                edge_type = EDGE_SHIFTED_FROM
            else:
                continue
            add_edge(
                source=fw_node,
                target=fw_node,  # self-loop on the framework node
                etype=edge_type,
                target_kind="framework_version",
                version_from=versions[i - 1].get("version"),
                version_to=v.get("version"),
                similarity=v.get("similarity_to_prev"),
                date_from=versions[i - 1].get("date", ""),
                date_to=v.get("date", ""),
            )

    # CONVERGES_WITH: cross-analyst overlaps
    for ov in payload.get("cross_analyst_overlaps", []):
        a = ov["framework_a"]
        b = ov["framework_b"]
        add_edge(
            source=_framework_node_id(a["analyst"], a["id"]),
            target=_framework_node_id(b["analyst"], b["id"]),
            etype=EDGE_CONVERGES_WITH,
            target_kind="framework",
            similarity=ov.get("similarity"),
            overlap_type=ov.get("overlap_type"),
            other_analyst=b["analyst"],
        )

    if edge_ids:
        # Dedup by id (upsert semantics)
        seen = {}
        for i, eid in enumerate(edge_ids):
            seen[eid] = i
        idxs = sorted(seen.values())
        edges.upsert(
            ids=[edge_ids[i] for i in idxs],
            documents=[edge_docs[i] for i in idxs],
            metadatas=[edge_metas[i] for i in idxs],
        )

    return len(node_ids), len(edge_ids)


# ─── Viz regeneration ────────────────────────────────────────────────────────

def regenerate_viz(analyst: str) -> bool:
    script = HERE / "visualize.py"
    python = HERE / "venv" / "bin" / "python"
    if not python.exists():
        python = Path(sys.executable)
    try:
        r = subprocess.run(
            [str(python), str(script), analyst],
            cwd=str(HERE),
            capture_output=True, text=True, timeout=180,
        )
        if r.returncode != 0:
            print(f"    ! viz failed: {r.stderr.strip()[:400]}")
            return False
        for line in r.stdout.splitlines()[-6:]:
            print(f"      {line}")
        return True
    except Exception as e:
        print(f"    ! viz exception: {e}")
        return False


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analyst", choices=ANALYSTS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-viz", action="store_true")
    args = ap.parse_args()

    targets = [args.analyst] if args.analyst else ANALYSTS

    client = None
    if not args.dry_run:
        client = chromadb.PersistentClient(path=DB_PATH)

    totals = {"nodes": 0, "edges": 0}
    for analyst in targets:
        print(f"\n=== {analyst} ===")
        payload = _load_evolved(analyst)
        if payload is None:
            continue
        print(
            f"  {len(payload['frameworks'])} frameworks, "
            f"{len(payload.get('cross_analyst_overlaps', []))} cross-analyst overlaps"
        )
        if args.dry_run:
            print("  (dry-run: skipping ChromaDB writes)")
        else:
            _delete_existing_framework_data(client, analyst)
            n_nodes, n_edges = write_frameworks(client, analyst, payload)
            totals["nodes"] += n_nodes
            totals["edges"] += n_edges
            print(f"  wrote {n_nodes} framework nodes, {n_edges} edges")

        if not args.skip_viz:
            print("  regenerating viz…")
            regenerate_viz(analyst)

    print(f"\nTotal: {totals['nodes']} nodes, {totals['edges']} edges written")


if __name__ == "__main__":
    main()
