#!/usr/bin/env python3
"""
Framework Pipeline Runner
==========================
One-shot entry point: extract → temporally-track → update KG → report.

Stages:
  1. extract_frameworks.py      — LLM framework extraction per analyst
  2. temporal_tracker.py        — embedding similarity / evolution / overlap
  3. update_graphs.py           — write to ChromaDB and regenerate HTML

Usage:
    python run_pipeline.py
    python run_pipeline.py --analyst thiccyth0t
    python run_pipeline.py --skip-extract       # Reuse existing raw JSON
    python run_pipeline.py --dry-run            # No DB writes
    python run_pipeline.py --limit 20           # For fast end-to-end test
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
PY = HERE / "venv" / "bin" / "python"
if not PY.exists():
    PY = Path(sys.executable)

RAW_DIR = HERE / "frameworks_raw"
EVOLVED_DIR = HERE / "frameworks_evolved"
ANALYSTS = ["thiccyth0t", "TopherGMI", "shaundadevens"]


def _run(cmd: list[str], label: str) -> bool:
    print(f"\n▶ {label}")
    print(f"  $ {' '.join(cmd)}")
    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(HERE))
    dur = time.time() - t0
    ok = r.returncode == 0
    print(f"  {'✅' if ok else '❌'} {label} ({dur:.1f}s, rc={r.returncode})")
    return ok


def _summarize(analysts: list[str]) -> None:
    print("\n" + "=" * 60)
    print("PIPELINE SUMMARY")
    print("=" * 60)
    for a in analysts:
        raw_p = RAW_DIR / f"{a}_frameworks.json"
        ev_p = EVOLVED_DIR / f"{a}_frameworks_evolved.json"
        print(f"\n{a}:")
        if raw_p.exists():
            raw = json.loads(raw_p.read_text())
            print(f"  raw:     {len(raw.get('frameworks', []))} frameworks "
                  f"from {raw.get('article_count', '?')} articles")
        else:
            print("  raw:     (missing)")
        if ev_p.exists():
            ev = json.loads(ev_p.read_text())
            s = ev.get("stats", {})
            print(
                f"  evolved: {s.get('total_frameworks', 0)} total, "
                f"{s.get('active', 0)} active, "
                f"{s.get('dormant', 0)} dormant, "
                f"{s.get('refinements_detected', 0)} refinements, "
                f"{s.get('shifts_detected', 0)} shifts, "
                f"{s.get('cross_analyst_matches', 0)} cross-matches"
            )
            # Top 5 frameworks by applications
            fws = sorted(
                ev.get("frameworks", []),
                key=lambda f: -f.get("total_applications", 0),
            )[:5]
            for f in fws:
                print(
                    f"    • {f['name']} ({f.get('category', '?')}) — "
                    f"{f.get('total_applications', 0)} apps, "
                    f"{len(f.get('versions', []))} versions, "
                    f"status={f.get('status', '?')}"
                )
        else:
            print("  evolved: (missing)")
    print("\n" + "=" * 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analyst", choices=ANALYSTS)
    ap.add_argument("--skip-extract", action="store_true",
                    help="Reuse existing frameworks_raw JSON")
    ap.add_argument("--skip-evolve", action="store_true",
                    help="Reuse existing frameworks_evolved JSON")
    ap.add_argument("--skip-update", action="store_true",
                    help="Don't write to ChromaDB / regenerate HTML")
    ap.add_argument("--skip-viz", action="store_true",
                    help="Write to ChromaDB but don't regenerate HTML")
    ap.add_argument("--dry-run", action="store_true",
                    help="Do not persist anywhere")
    ap.add_argument("--limit", type=int,
                    help="Max articles per analyst (extract stage)")
    args = ap.parse_args()

    targets = [args.analyst] if args.analyst else ANALYSTS

    # Stage 1: extract
    if not args.skip_extract:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("✖ ANTHROPIC_API_KEY not set — export it or use --skip-extract")
            sys.exit(2)
        for a in targets:
            cmd = [str(PY), str(HERE / "extract_frameworks.py"), "--analyst", a]
            if args.limit:
                cmd += ["--limit", str(args.limit)]
            if args.dry_run:
                cmd.append("--dry-run")
            if not _run(cmd, f"extract: {a}"):
                print(f"  continuing despite failure on {a}")
    else:
        print("⏭  skipping extract stage")

    # Stage 2: temporal tracking (always run on all targets together so that
    # cross-analyst convergence can be computed).
    if not args.skip_evolve:
        cmd = [str(PY), str(HERE / "temporal_tracker.py")]
        if args.analyst:
            cmd += ["--analyst", args.analyst]
        if not _run(cmd, "temporal tracking"):
            print("  temporal tracking failed — aborting update stage")
            args.skip_update = True
    else:
        print("⏭  skipping evolve stage")

    # Stage 3: update KG + regenerate viz
    if not args.skip_update:
        for a in targets:
            cmd = [str(PY), str(HERE / "update_graphs.py"), "--analyst", a]
            if args.dry_run:
                cmd.append("--dry-run")
            if args.skip_viz:
                cmd.append("--skip-viz")
            _run(cmd, f"update graph: {a}")
    else:
        print("⏭  skipping update stage")

    _summarize(targets)


if __name__ == "__main__":
    main()
