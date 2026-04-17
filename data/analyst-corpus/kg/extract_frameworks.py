#!/usr/bin/env python3
"""
Framework Extraction Pipeline
==============================
Reads markdown content for each crypto analyst and uses Claude to extract
reusable analytical frameworks (mental models / reasoning patterns that
appear across multiple pieces — NOT one-off opinions).

Outputs: frameworks_raw/{analyst}_frameworks.json

Usage:
    python extract_frameworks.py                     # All analysts
    python extract_frameworks.py --analyst thiccyth0t
    python extract_frameworks.py --dry-run           # Skip saving
    python extract_frameworks.py --limit 20          # Process only N articles
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import anthropic
except ImportError:
    sys.stderr.write("anthropic SDK not installed. Run: pip install anthropic\n")
    sys.exit(1)


# ─── Config ──────────────────────────────────────────────────────────────────

DATA_DIR = Path.home() / "Projects" / "crypto-analysts"
OUT_DIR = Path(__file__).parent / "frameworks_raw"
ANALYSTS = ["thiccyth0t", "TopherGMI", "shaundadevens"]
MODEL = "claude-sonnet-4-20250514"

# Articles per LLM call. Sonnet has a large context but we want tight focus.
BATCH_SIZE = 6
# Per-article char cap so a massive post doesn't starve the batch.
MAX_CHARS_PER_ARTICLE = 16_000
# Delay between API calls to avoid rate limits.
API_DELAY_SEC = 1.0
# Max retries for transient API errors.
MAX_RETRIES = 4

DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
FILENAME_RE = re.compile(r"^([a-z0-9]+)_(\d{4}-\d{2}-\d{2})_(.+)\.md$", re.IGNORECASE)


# ─── Prompt ──────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert analyst of financial and crypto writing. \
Your job is to identify REUSABLE ANALYTICAL FRAMEWORKS used in the text.

A FRAMEWORK is a reusable mental model or reasoning pattern that could be \
applied to many different situations. Examples:
- "Power Law Distribution" (concentration analysis)
- "Token Unlock Supply Shock" (vesting-schedule price impact)
- "LP Toxicity Analysis" (AMM LP profitability vs. order flow toxicity)
- "Basis Trade" (spot-perp arbitrage)
- "Reflexivity Loop" (price → narrative → capital → price)
- "Narrative Trading" (attention/meta rather than fundamentals)
- "Fee Switch Analysis" (protocol revenue extraction potential)
- "Cycle Positioning" (macro cycle-based allocation)
- "Second-Order Effects" (deriving downstream consequences)
- "Game Theory of Airdrops" (incentive design analysis)
- "Metcalfe's Law" (network value ∝ n²)
- "DCF / Discounted Cash Flow" (present-value revenue discounting)
- "Risk-Reward Asymmetry" (convex payoffs)

NOT frameworks:
- One-off opinions ("ETH will hit 5k")
- Simple observations ("TVL is up")
- Specific entity mentions without a reusable pattern
- Pure news recounts

Rules:
1. Only extract frameworks actually USED in the text (author is applying the \
reasoning, not just name-dropping).
2. Name frameworks in Title Case. Prefer established names when applicable.
3. Each framework application should reference the specific article it came from.
4. Category must be one of: quantitative, qualitative, behavioral, structural, macro.
5. Be strict. Two or three strong frameworks per article is better than ten weak ones.
6. Return ONLY valid JSON matching the requested schema.
"""


EXTRACTION_INSTRUCTION = """Extract the analytical frameworks applied in the \
following articles. Return JSON with this exact schema:

{
  "frameworks": [
    {
      "name": "Title Case Name",
      "description": "1-2 sentence definition of the framework (not the application)",
      "category": "quantitative|qualitative|behavioral|structural|macro",
      "applications": [
        {
          "article_id": "<filename of the article>",
          "date": "YYYY-MM-DD",
          "context": "1-2 sentence description of how the framework is applied here",
          "entities_involved": ["Entity1", "Entity2"],
          "relationships": ["analyzes", "applies_to"],
          "scope": "narrow|broad",
          "confidence": 0.0-1.0
        }
      ]
    }
  ]
}

If two articles apply the SAME framework, list one framework with two \
applications. Output ONLY the JSON object, no prose."""


# ─── Data model ──────────────────────────────────────────────────────────────

@dataclass
class Article:
    """One markdown file = one article/thread/tweet."""
    path: Path
    analyst: str
    source: str          # substack | arca | blockworks | twitter | lesswrong
    date: str            # ISO YYYY-MM-DD, or "" if unparseable
    slug: str
    text: str

    @property
    def article_id(self) -> str:
        return self.path.name

    @property
    def sort_key(self) -> tuple:
        # Unparseable dates sink to the end but remain in stable order.
        return (self.date or "9999-99-99", self.path.name)


# ─── IO helpers ──────────────────────────────────────────────────────────────

def parse_filename(p: Path) -> tuple[str, str, str]:
    """Return (source, date, slug). Falls back gracefully."""
    m = FILENAME_RE.match(p.name)
    if m:
        return m.group(1).lower(), m.group(2), m.group(3)
    # Try to find any ISO date in the name
    dm = DATE_RE.search(p.name)
    date = dm.group(1) if dm else ""
    source = p.name.split("_", 1)[0].lower() if "_" in p.name else "unknown"
    slug = p.stem
    return source, date, slug


def load_articles(analyst: str) -> list[Article]:
    content_dir = DATA_DIR / analyst / "content"
    if not content_dir.exists():
        print(f"  ! no content dir for {analyst}: {content_dir}")
        return []
    articles: list[Article] = []
    for p in sorted(content_dir.glob("*.md")):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"  ! cannot read {p.name}: {e}")
            continue
        if not text.strip():
            continue
        source, date, slug = parse_filename(p)
        articles.append(Article(
            path=p, analyst=analyst, source=source,
            date=date, slug=slug, text=text,
        ))
    articles.sort(key=lambda a: a.sort_key)
    return articles


# ─── LLM call ────────────────────────────────────────────────────────────────

def build_user_message(batch: list[Article]) -> str:
    pieces = [EXTRACTION_INSTRUCTION, "", "=== ARTICLES ==="]
    for a in batch:
        body = a.text[:MAX_CHARS_PER_ARTICLE]
        truncated = " [TRUNCATED]" if len(a.text) > MAX_CHARS_PER_ARTICLE else ""
        pieces.append(
            f"\n--- ARTICLE ---\n"
            f"article_id: {a.article_id}\n"
            f"date: {a.date or 'unknown'}\n"
            f"source: {a.source}\n"
            f"analyst: {a.analyst}\n"
            f"---\n{body}{truncated}\n"
        )
    return "\n".join(pieces)


def _strip_codefence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        # drop first line (```json or ```) and trailing fence
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    return s.strip()


def _extract_json_object(s: str) -> str:
    """Pull the first balanced {...} from the response."""
    s = _strip_codefence(s)
    start = s.find("{")
    if start < 0:
        return s
    depth = 0
    in_str = False
    esc = False
    for i, ch in enumerate(s[start:], start=start):
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
    return s[start:]


def call_llm(client: anthropic.Anthropic, batch: list[Article]) -> dict[str, Any]:
    """Send a batch to Claude and return parsed JSON."""
    user_msg = build_user_message(batch)
    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            raw = "".join(
                block.text for block in resp.content
                if getattr(block, "type", None) == "text"
            )
            obj = json.loads(_extract_json_object(raw))
            if "frameworks" not in obj:
                obj = {"frameworks": []}
            return obj
        except json.JSONDecodeError as e:
            last_err = e
            print(f"    ! JSON parse error (attempt {attempt}): {e}")
        except anthropic.APIStatusError as e:
            last_err = e
            # Only retry on transient codes
            if e.status_code in (429, 500, 502, 503, 504):
                wait = 2 ** attempt
                print(f"    ! API {e.status_code}, sleeping {wait}s")
                time.sleep(wait)
                continue
            print(f"    ! API error {e.status_code}: {e}")
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"    ! unexpected error (attempt {attempt}): {e}")
            time.sleep(2 ** attempt)
    print(f"    ! giving up on batch after {MAX_RETRIES} attempts: {last_err}")
    return {"frameworks": []}


# ─── Merge helpers ───────────────────────────────────────────────────────────

def _normalize_name(name: str) -> str:
    # Collapse whitespace, strip, title-case words of length > 2 keeping acronyms.
    n = re.sub(r"\s+", " ", name).strip()
    parts = []
    for w in n.split(" "):
        if not w:
            continue
        if w.isupper() and len(w) <= 5:
            parts.append(w)
        else:
            parts.append(w[:1].upper() + w[1:].lower())
    return " ".join(parts)


def merge_frameworks(all_extractions: list[dict]) -> list[dict]:
    """Merge per-batch framework lists into a single de-duplicated list.

    Dedup is by normalized name. Applications accumulate. Description is taken
    from the first occurrence; others are stored under description_variants.
    """
    merged: dict[str, dict] = {}
    for batch in all_extractions:
        for fw in batch.get("frameworks", []) or []:
            name = _normalize_name(fw.get("name", "").strip())
            if not name:
                continue
            key = name.lower()
            entry = merged.get(key)
            if entry is None:
                entry = {
                    "name": name,
                    "description": fw.get("description", "").strip(),
                    "category": fw.get("category", "qualitative").strip().lower(),
                    "description_variants": [],
                    "applications": [],
                }
                merged[key] = entry
            else:
                desc = fw.get("description", "").strip()
                if desc and desc != entry["description"]:
                    entry["description_variants"].append(desc)
            for app in fw.get("applications", []) or []:
                entry["applications"].append({
                    "article_id": app.get("article_id", ""),
                    "date": app.get("date", ""),
                    "context": app.get("context", ""),
                    "entities_involved": app.get("entities_involved", []) or [],
                    "relationships": app.get("relationships", []) or [],
                    "scope": (app.get("scope") or "narrow").lower(),
                    "confidence": float(app.get("confidence", 0.7) or 0.7),
                })
    # Add summary fields.
    out: list[dict] = []
    for entry in merged.values():
        apps = sorted(entry["applications"], key=lambda a: a.get("date") or "")
        first = apps[0] if apps else {}
        last = apps[-1] if apps else {}
        avg_conf = (
            sum(a.get("confidence", 0.7) for a in apps) / len(apps)
            if apps else 0.0
        )
        out.append({
            "name": entry["name"],
            "description": entry["description"],
            "category": entry["category"],
            "description_variants": entry["description_variants"],
            "first_seen_date": first.get("date", ""),
            "first_seen_article": first.get("article_id", ""),
            "last_seen_date": last.get("date", ""),
            "last_seen_article": last.get("article_id", ""),
            "applications": apps,
            "total_applications": len(apps),
            "confidence": round(avg_conf, 3),
        })
    out.sort(key=lambda f: (-f["total_applications"], f["name"]))
    return out


# ─── Main ────────────────────────────────────────────────────────────────────

def extract_for_analyst(
    analyst: str,
    client: anthropic.Anthropic,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    print(f"\n=== {analyst} ===")
    articles = load_articles(analyst)
    if limit:
        articles = articles[:limit]
    print(f"  {len(articles)} articles loaded")
    if not articles:
        return {"analyst": analyst, "frameworks": []}

    batches: list[list[Article]] = [
        articles[i:i + BATCH_SIZE] for i in range(0, len(articles), BATCH_SIZE)
    ]
    print(f"  {len(batches)} batches of up to {BATCH_SIZE}")

    all_extractions: list[dict] = []
    for bi, batch in enumerate(batches, 1):
        names = ", ".join(a.article_id for a in batch)
        print(f"  [{bi}/{len(batches)}] {len(batch)} articles: {names[:80]}…")
        result = call_llm(client, batch)
        n_fw = len(result.get("frameworks", []) or [])
        print(f"      → {n_fw} frameworks")
        all_extractions.append(result)
        if bi < len(batches):
            time.sleep(API_DELAY_SEC)

    frameworks = merge_frameworks(all_extractions)
    print(f"  merged → {len(frameworks)} unique frameworks")

    payload = {
        "analyst": analyst,
        "model": MODEL,
        "extracted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "article_count": len(articles),
        "batch_count": len(batches),
        "frameworks": frameworks,
    }

    if dry_run:
        print("  (dry-run: not saving)")
    else:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = OUT_DIR / f"{analyst}_frameworks.json"
        out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        print(f"  saved → {out_path}")
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analyst", choices=ANALYSTS, help="Run a single analyst")
    ap.add_argument("--limit", type=int, help="Max articles per analyst")
    ap.add_argument("--dry-run", action="store_true", help="Do not save output")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.stderr.write(
            "error: ANTHROPIC_API_KEY not set in environment\n"
        )
        sys.exit(2)

    client = anthropic.Anthropic()
    targets = [args.analyst] if args.analyst else ANALYSTS
    for analyst in targets:
        extract_for_analyst(
            analyst, client,
            limit=args.limit,
            dry_run=args.dry_run,
        )


if __name__ == "__main__":
    main()
