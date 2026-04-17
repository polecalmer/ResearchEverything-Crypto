#!/usr/bin/env python3
"""
Temporal Tracking + Embedding Similarity
=========================================
Loads raw framework extractions, computes embedding similarity to detect
refinements / shifts / new frameworks / cross-analyst convergence / dormancy,
and writes a versioned, consolidated file per analyst.

Inputs:  frameworks_raw/{analyst}_frameworks.json
Outputs: frameworks_evolved/{analyst}_frameworks_evolved.json

Usage:
    python temporal_tracker.py
    python temporal_tracker.py --analyst thiccyth0t
    python temporal_tracker.py --refinement-threshold 0.85 --shift-threshold 0.6
    python temporal_tracker.py --dormancy-days 180
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
except ImportError as e:
    sys.stderr.write(f"missing dep: {e}. pip install sentence-transformers numpy\n")
    sys.exit(1)


RAW_DIR = Path(__file__).parent / "frameworks_raw"
OUT_DIR = Path(__file__).parent / "frameworks_evolved"
ANALYSTS = ["thiccyth0t", "TopherGMI", "shaundadevens"]

EMBED_MODEL = "all-MiniLM-L6-v2"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "framework"


def _parse_date(s: str) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _cosine_matrix(vecs: np.ndarray) -> np.ndarray:
    """Cosine similarity matrix of L2-normalized vectors (rows)."""
    if vecs.size == 0:
        return np.zeros((0, 0))
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    v = vecs / norms
    return v @ v.T


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ─── Core logic ──────────────────────────────────────────────────────────────

def _embed_text_for_framework(fw: dict) -> str:
    """Text we embed for each framework (name + description + top contexts)."""
    ctxs = []
    for app in (fw.get("applications") or [])[:5]:
        c = (app.get("context") or "").strip()
        if c:
            ctxs.append(c)
    return " | ".join(
        [fw.get("name", ""), fw.get("description", "")] + ctxs
    )[:2000]


def _version_text(app: dict, fw_name: str, fw_desc: str) -> str:
    return " | ".join([
        fw_name,
        fw_desc,
        app.get("context") or "",
        " ".join(app.get("entities_involved") or []),
    ])[:1200]


def build_versions(
    fw: dict,
    model: SentenceTransformer,
    refinement_threshold: float,
    shift_threshold: float,
) -> list[dict]:
    """One version per application, ordered by date; classify each transition."""
    apps = sorted(
        fw.get("applications") or [],
        key=lambda a: a.get("date") or "9999-99-99",
    )
    if not apps:
        return []
    texts = [_version_text(a, fw["name"], fw.get("description", "")) for a in apps]
    embeds = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    versions: list[dict] = []
    prev_emb: np.ndarray | None = None
    for i, app in enumerate(apps):
        emb = embeds[i]
        ver: dict[str, Any] = {
            "version": i + 1,
            "date": app.get("date", ""),
            "description": app.get("context", ""),
            "scope": app.get("scope", "narrow"),
            "source_article": app.get("article_id", ""),
            "entities_involved": app.get("entities_involved", []),
            "confidence": app.get("confidence", 0.7),
            "embedding": [round(float(x), 5) for x in emb.tolist()],
        }
        if prev_emb is not None:
            sim = _cosine(prev_emb, emb)
            ver["similarity_to_prev"] = round(sim, 4)
            prev_scope = versions[-1]["scope"]
            cur_scope = ver["scope"]
            if sim >= refinement_threshold:
                if prev_scope != cur_scope:
                    ver["evolution_type"] = "refinement"
                else:
                    ver["evolution_type"] = "reiteration"
            elif sim >= shift_threshold:
                ver["evolution_type"] = "shift"
            else:
                ver["evolution_type"] = "divergence"
        else:
            ver["evolution_type"] = "initial"
        versions.append(ver)
        prev_emb = emb
    return versions


def process_analyst(
    analyst: str,
    model: SentenceTransformer,
    refinement_threshold: float,
    shift_threshold: float,
    dormancy_days: int,
    reference_date: date | None = None,
) -> dict[str, Any]:
    print(f"\n=== {analyst} ===")
    raw_path = RAW_DIR / f"{analyst}_frameworks.json"
    if not raw_path.exists():
        print(f"  ! no raw file: {raw_path}")
        return {"analyst": analyst, "frameworks": []}
    raw = json.loads(raw_path.read_text())
    fws_in = raw.get("frameworks") or []
    print(f"  {len(fws_in)} input frameworks")

    ref_date = reference_date or date.today()

    evolved: list[dict] = []
    refinement_count = 0
    shift_count = 0

    for fw in fws_in:
        versions = build_versions(fw, model, refinement_threshold, shift_threshold)
        if not versions:
            continue
        # Aggregate stats
        for v in versions:
            if v.get("evolution_type") == "refinement":
                refinement_count += 1
            elif v.get("evolution_type") == "shift":
                shift_count += 1

        entities_connected = sorted({
            e for app in fw.get("applications", [])
            for e in (app.get("entities_involved") or [])
            if e
        })
        last_seen = fw.get("last_seen_date") or (
            versions[-1]["date"] if versions else ""
        )
        last_dt = _parse_date(last_seen)
        is_dormant = bool(
            last_dt and (ref_date - last_dt).days > dormancy_days
        )

        evolved.append({
            "id": _slug(fw["name"]),
            "name": fw["name"],
            "description": fw.get("description", ""),
            "category": fw.get("category", "qualitative"),
            "versions": versions,
            "total_applications": fw.get("total_applications", len(versions)),
            "entities_connected": entities_connected,
            "status": "dormant" if is_dormant else "active",
            "first_seen": fw.get("first_seen_date", ""),
            "last_seen": last_seen,
            "confidence": fw.get("confidence", 0.7),
        })

    active = sum(1 for f in evolved if f["status"] == "active")
    dormant = sum(1 for f in evolved if f["status"] == "dormant")

    payload = {
        "analyst": analyst,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "embed_model": EMBED_MODEL,
        "thresholds": {
            "refinement": refinement_threshold,
            "shift": shift_threshold,
            "dormancy_days": dormancy_days,
        },
        "frameworks": evolved,
        "cross_analyst_overlaps": [],  # filled in a second pass
        "stats": {
            "total_frameworks": len(evolved),
            "active": active,
            "dormant": dormant,
            "refinements_detected": refinement_count,
            "shifts_detected": shift_count,
            "cross_analyst_matches": 0,
        },
    }
    print(f"  → {len(evolved)} frameworks "
          f"({active} active, {dormant} dormant, "
          f"{refinement_count} refinements, {shift_count} shifts)")
    return payload


def _framework_embedding(fw: dict) -> np.ndarray:
    """Average of version embeddings (already normalized)."""
    vecs = [np.array(v["embedding"], dtype=np.float32) for v in fw.get("versions", []) if v.get("embedding")]
    if not vecs:
        return np.zeros(384, dtype=np.float32)
    m = np.mean(np.stack(vecs), axis=0)
    n = float(np.linalg.norm(m))
    return m / n if n > 0 else m


def compute_cross_analyst(
    payloads: dict[str, dict],
    convergence_threshold: float = 0.70,
) -> None:
    """Mutates payloads in place to fill cross_analyst_overlaps."""
    analysts = list(payloads.keys())
    if len(analysts) < 2:
        return

    # Precompute one embedding per framework.
    index: dict[str, list[tuple[str, np.ndarray]]] = {}
    for a in analysts:
        items = []
        for fw in payloads[a]["frameworks"]:
            items.append((fw["id"], _framework_embedding(fw)))
        index[a] = items

    # For each pair of analysts, find matches above threshold.
    for i in range(len(analysts)):
        for j in range(i + 1, len(analysts)):
            a, b = analysts[i], analysts[j]
            a_items, b_items = index[a], index[b]
            if not a_items or not b_items:
                continue
            A = np.stack([v for _, v in a_items])
            B = np.stack([v for _, v in b_items])
            sims = A @ B.T  # both normalized
            for ai, (a_id, _) in enumerate(a_items):
                for bi, (b_id, _) in enumerate(b_items):
                    s = float(sims[ai, bi])
                    if s >= convergence_threshold:
                        overlap = {
                            "framework_a": {"analyst": a, "id": a_id},
                            "framework_b": {"analyst": b, "id": b_id},
                            "similarity": round(s, 4),
                            "overlap_type": "convergent" if s >= 0.9 else "related",
                        }
                        payloads[a]["cross_analyst_overlaps"].append(overlap)
                        payloads[b]["cross_analyst_overlaps"].append({
                            "framework_a": {"analyst": b, "id": b_id},
                            "framework_b": {"analyst": a, "id": a_id},
                            "similarity": round(s, 4),
                            "overlap_type": overlap["overlap_type"],
                        })
    for a in analysts:
        payloads[a]["stats"]["cross_analyst_matches"] = len(
            payloads[a]["cross_analyst_overlaps"]
        )


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analyst", choices=ANALYSTS)
    ap.add_argument("--refinement-threshold", type=float, default=0.85)
    ap.add_argument("--shift-threshold", type=float, default=0.60)
    ap.add_argument("--convergence-threshold", type=float, default=0.70)
    ap.add_argument("--dormancy-days", type=int, default=183)
    ap.add_argument(
        "--reference-date",
        help="Override 'today' (YYYY-MM-DD). Useful since content may be "
             "historical.",
    )
    args = ap.parse_args()

    targets = [args.analyst] if args.analyst else ANALYSTS
    ref_date = _parse_date(args.reference_date) if args.reference_date else None

    print(f"Loading embedding model: {EMBED_MODEL}")
    model = SentenceTransformer(EMBED_MODEL)

    payloads: dict[str, dict] = {}
    for analyst in targets:
        payloads[analyst] = process_analyst(
            analyst, model,
            refinement_threshold=args.refinement_threshold,
            shift_threshold=args.shift_threshold,
            dormancy_days=args.dormancy_days,
            reference_date=ref_date,
        )

    # If running for multiple analysts in one pass, fill cross-analyst.
    if len(payloads) > 1:
        print("\nComputing cross-analyst convergence…")
        compute_cross_analyst(payloads, args.convergence_threshold)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for analyst, payload in payloads.items():
        out_path = OUT_DIR / f"{analyst}_frameworks_evolved.json"
        out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        print(f"  saved → {out_path}")


if __name__ == "__main__":
    main()
