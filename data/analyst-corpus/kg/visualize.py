#!/usr/bin/env python3
"""Visualize the knowledge graph for a crypto analyst.

Renders entities + relationships from ChromaDB. Frameworks (entity_type=
"framework") are rendered as stars; framework edges (APPLIES_TO /
REFINED_FROM / SHIFTED_FROM / CONVERGES_WITH) come from the dedicated
`framework_edges` collection and are drawn with distinct styling:
  - APPLIES_TO        : solid orange
  - REFINED_FROM      : dashed yellow (self-loop, temporal)
  - SHIFTED_FROM      : dashed red   (self-loop, temporal)
  - CONVERGES_WITH    : dotted magenta (cross-analyst)
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pyvis.network import Network
import chromadb

DB_PATH = "chroma_db"
ANALYST = sys.argv[1] if len(sys.argv) > 1 else "thiccyth0t"
OUTPUT = f"{ANALYST}_knowledge_graph.html"

client = chromadb.PersistentClient(path=DB_PATH)
entities_col = client.get_collection("entities")

# ─── Load entities ────────────────────────────────────────────────────────────
results = entities_col.get(
    where={"analyst": ANALYST},
    include=["documents", "metadatas"],
)
print(f"Raw results: {len(results['ids'])} entities")

entity_map = {}       # lower-name -> {type, count, display, framework_id, status, ...}
framework_nodes = {}  # framework_id -> display name

for i, eid in enumerate(results["ids"]):
    meta = results["metadatas"][i] or {}
    doc = results["documents"][i] if results.get("documents") else ""
    name = meta.get("entity_name", meta.get("name", eid))
    etype = meta.get("entity_type", meta.get("type", "unknown"))
    count = meta.get("mention_count", 1)
    canonical = name.strip()
    if len(canonical) <= 4 and canonical.upper() == canonical:
        display = canonical.upper()
    else:
        display = canonical[:1].upper() + canonical[1:]

    entry = {
        "type": etype,
        "count": count,
        "doc": doc,
        "display": display,
        "meta": meta,
    }
    entity_map[display.lower()] = entry
    if etype == "framework" and meta.get("framework_id"):
        framework_nodes[meta["framework_id"]] = display

print(f"Entities parsed: {len(entity_map)} ({len(framework_nodes)} frameworks)")

# ─── Load relationships from chunks (existing mechanism) ─────────────────────
chunks_col = client.get_collection("chunks")
chunk_results = chunks_col.get(
    where={"analyst": ANALYST},
    include=["metadatas"],
    limit=5000,
)
relationships = {}
for meta in chunk_results["metadatas"]:
    rels_json = meta.get("relationships", "[]")
    try:
        rels = json.loads(rels_json)
        for r in rels:
            key = (r["source"], r["target"], r["type"])
            relationships[key] = relationships.get(key, 0) + 1
    except Exception:
        pass
print(f"Chunk relationships: {len(relationships)}")

# ─── Load framework edges (if collection exists) ─────────────────────────────
framework_edges = []
try:
    fwedges_col = client.get_collection("framework_edges")
    fe_res = fwedges_col.get(
        where={"analyst": ANALYST},
        include=["metadatas"],
    )
    framework_edges = fe_res.get("metadatas") or []
except Exception:
    pass
print(f"Framework edges: {len(framework_edges)}")


# ─── Styling ─────────────────────────────────────────────────────────────────
TYPE_COLORS = {
    "protocol": "#FF6B6B",
    "token": "#4ECDC4",
    "concept": "#45B7D1",
    "person": "#96CEB4",
    "company": "#FFEAA7",
    "metric": "#DDA0DD",
    "framework": "#FFA07A",
}
TYPE_SIZES = {
    "protocol": 25, "token": 20, "concept": 15,
    "person": 18,   "company": 18, "metric": 12, "framework": 28,
}
FW_STATUS_BORDER = {"active": "#FFD700", "dormant": "#888888"}


# ─── Build network ───────────────────────────────────────────────────────────
net = Network(
    height="900px",
    width="100%",
    bgcolor="#1a1a2e",
    font_color="white",
    directed=True,
    cdn_resources="remote",
)
net.barnes_hut(
    gravity=-8000,
    central_gravity=0.3,
    spring_length=150,
    spring_strength=0.01,
    damping=0.09,
)

MIN_MENTIONS = 2
added_nodes = set()

# Entities (non-framework)
for key, info in entity_map.items():
    if info["type"] == "framework":
        continue
    if info["count"] < MIN_MENTIONS:
        continue
    display = info["display"]
    if display.lower() in added_nodes:
        continue
    color = TYPE_COLORS.get(info["type"], "#999999")
    size = min(TYPE_SIZES.get(info["type"], 15) + info["count"] * 2, 50)
    title = f"{display}\nType: {info['type']}\nMentions: {info['count']}"
    net.add_node(
        display,
        label=display[:25],
        title=title,
        color=color,
        size=size,
        font={"size": max(10, min(14 + info["count"], 20)), "color": "white"},
    )
    added_nodes.add(display.lower())

# Frameworks — always included, styled as stars
for key, info in entity_map.items():
    if info["type"] != "framework":
        continue
    display = info["display"]
    if display.lower() in added_nodes:
        continue
    m = info["meta"]
    status = m.get("status", "active")
    border_color = FW_STATUS_BORDER.get(status, "#FFD700")
    size = min(TYPE_SIZES["framework"] + int(info["count"]) * 2, 55)
    title = (
        f"{display}  [FRAMEWORK]\n"
        f"Category: {m.get('category', '?')}\n"
        f"Status: {status}\n"
        f"Applications: {info['count']}\n"
        f"Versions: {m.get('version_count', 1)}\n"
        f"First seen: {m.get('first_seen', '?')}\n"
        f"Last seen: {m.get('last_seen', '?')}"
    )
    net.add_node(
        display,
        label=display[:30],
        title=title,
        color={
            "background": TYPE_COLORS["framework"],
            "border": border_color,
            "highlight": {"background": "#FFB88C", "border": "#FFFFFF"},
        },
        shape="star",
        borderWidth=3,
        size=size,
        font={"size": 16, "color": "#FFD700", "face": "monospace"},
    )
    added_nodes.add(display.lower())

print(f"Nodes added: {len(added_nodes)}")

# ─── Chunk-based edges ───────────────────────────────────────────────────────
edge_count = 0
edge_set = set()
EDGE_COLORS = {
    "mentions": "#666666",
    "analyzes": "#4ECDC4",
    "compares": "#FFA07A",
    "predicts": "#FF6B6B",
    "contradicts": "#FF0000",
    "derives_from": "#45B7D1",
}
for (source, target, rel_type), count in relationships.items():
    s_key = source.lower()
    t_key = target.lower()
    s_display = entity_map.get(s_key, {}).get("display", source)
    t_display = entity_map.get(t_key, {}).get("display", target)
    if s_key not in added_nodes or t_key not in added_nodes:
        continue
    if s_display == t_display:
        continue
    edge_key = (s_display, t_display, rel_type)
    if edge_key in edge_set:
        continue
    edge_set.add(edge_key)
    color = EDGE_COLORS.get(rel_type, "#444444")
    width = min(1 + count * 0.5, 5)
    net.add_edge(
        s_display, t_display,
        title=f"{s_display} --[{rel_type}]--> {t_display}\n(count: {count})",
        color=color, width=width, arrows="to",
    )
    edge_count += 1

# ─── Framework edges ─────────────────────────────────────────────────────────
fw_id_to_display = framework_nodes  # framework_id -> display name
FW_EDGE_STYLE = {
    "applies_to":     {"color": "#FFA07A", "dashes": False, "width": 2},
    "refined_from":   {"color": "#FFD700", "dashes": [8, 6], "width": 2.5},
    "shifted_from":   {"color": "#FF4500", "dashes": [8, 6], "width": 2.5},
    "converges_with": {"color": "#FF00FF", "dashes": [2, 6], "width": 2},
}
fw_edge_count = 0
for meta in framework_edges:
    etype = meta.get("edge_type", "")
    style = FW_EDGE_STYLE.get(etype)
    if not style:
        continue
    source = meta.get("source", "")
    target = meta.get("target", "")

    # Resolve framework node ids → display names
    if source.startswith("fw::"):
        parts = source.split("::")
        if len(parts) >= 3:
            source = fw_id_to_display.get(parts[2], source)
    if target.startswith("fw::"):
        parts = target.split("::")
        if len(parts) >= 3:
            target = fw_id_to_display.get(parts[2], target)

    # For self-loop version edges, skip (vis can't render self-loops well —
    # and the version info is already surfaced in the node tooltip).
    if etype in ("refined_from", "shifted_from") and source == target:
        continue

    # Cross-analyst convergence: the other side is a node we don't have.
    if etype == "converges_with":
        # Target might be a framework node in another analyst's graph.
        if target.startswith("fw::") or target.lower() not in added_nodes:
            continue

    # Standard resolution for APPLIES_TO targets (entity names)
    if source.lower() not in added_nodes:
        continue
    if target.lower() not in added_nodes:
        continue

    title_parts = [f"{source} --[{etype}]--> {target}"]
    if meta.get("similarity") is not None:
        title_parts.append(f"similarity: {meta['similarity']}")
    if meta.get("date_from") and meta.get("date_to"):
        title_parts.append(f"{meta['date_from']} → {meta['date_to']}")

    net.add_edge(
        source, target,
        title="\n".join(title_parts),
        color=style["color"],
        width=style["width"],
        dashes=style["dashes"],
        arrows="to",
    )
    fw_edge_count += 1

print(f"Edges added: {edge_count} (+ {fw_edge_count} framework edges)")

# ─── Legend ──────────────────────────────────────────────────────────────────
legend_html = f"""
<div style="position:fixed; top:10px; left:10px; background:rgba(0,0,0,0.85);
     padding:15px; border-radius:10px; font-family:monospace; z-index:1000;
     max-width:520px;">
  <h3 style="color:white; margin:0 0 10px 0;">{ANALYST} Knowledge Graph</h3>
  <div style="color:#aaa; font-size:12px; line-height:1.7;">
    <span style="color:#FF6B6B;">●</span> Protocol &nbsp;
    <span style="color:#4ECDC4;">●</span> Token &nbsp;
    <span style="color:#45B7D1;">●</span> Concept &nbsp;
    <span style="color:#96CEB4;">●</span> Person &nbsp;
    <span style="color:#FFEAA7;">●</span> Company &nbsp;
    <span style="color:#DDA0DD;">●</span> Metric
    <br>
    <span style="color:#FFA07A;">★</span> Framework (gold border = active, grey = dormant)
  </div>
  <div style="color:#888; font-size:11px; margin-top:8px; line-height:1.6;">
    <span style="color:#FFA07A;">━</span> applies_to &nbsp;
    <span style="color:#FFD700;">╌</span> refined_from &nbsp;
    <span style="color:#FF4500;">╌</span> shifted_from &nbsp;
    <span style="color:#FF00FF;">┈</span> converges_with
  </div>
  <div style="color:#888; font-size:11px; margin-top:8px;">
    {len(added_nodes)} nodes · {edge_count + fw_edge_count} edges · {len(framework_nodes)} frameworks · Drag to explore
  </div>
</div>
"""

net.save_graph(OUTPUT)
with open(OUTPUT, "r") as f:
    html = f.read()
html = html.replace("</body>", legend_html + "\n</body>")
with open(OUTPUT, "w") as f:
    f.write(html)

print(f"\n✅ Saved to {OUTPUT}")
