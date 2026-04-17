"""
Crypto Analyst Knowledge Graph Prototype
=========================================
Ingests markdown content from crypto analysts, extracts entities/relationships,
embeds chunks into ChromaDB, and provides semantic query interface.

Usage:
    from kg import CryptoKG
    kg = CryptoKG()
    kg.build_index()  # Run once to build
    results = kg.query("What does thiccyth0t think about Uniswap?")
"""

import os
import re
import json
import hashlib
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field, asdict

import yaml
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer


# ─── Configuration ───────────────────────────────────────────────────────────

DATA_DIR = Path.home() / "Projects" / "crypto-analysts"
PERSIST_DIR = Path(__file__).parent / "chroma_db"

# Crypto-specific entity patterns
CRYPTO_TOKEN_PATTERN = re.compile(
    r'\b(BTC|ETH|SOL|AVAX|MATIC|ARB|OP|UNI|AAVE|MKR|CRV|CVX|LDO|RPL|'
    r'SNX|COMP|YFI|SUSHI|1INCH|DYDX|GMX|PENDLE|BLUR|JTO|PYTH|JUP|'
    r'WIF|BONK|PEPE|DOGE|SHIB|FLOKI|TIA|SEI|SUI|APTOS|MOVE|DOT|ADA|'
    r'XRP|LINK|ATOM|NEAR|FTM|ALGO|ICP|FIL|RNDR|AR|STX|ORDI|SATS|'
    r'Bitcoin|Ethereum|Solana|Avalanche|Polygon|Arbitrum|Optimism|'
    r'Uniswap|Aave|MakerDAO|Curve|Convex|Lido|Rocket Pool|dYdX|GMX|'
    r'Binance|Coinbase|Kraken|OKX|Bybit|Bitfinex|Circle|Tether|USDC|USDT|DAI|FRAX)\b',
    re.IGNORECASE
)

PROTOCOL_PATTERN = re.compile(
    r'\b(Uniswap|Aave|Compound|MakerDAO|Curve|Convex|Lido|Rocket Pool|'
    r'EigenLayer|Celestia|Monad|Berachain|Ethena|Pendle|GMX|dYdX|'
    r'Blur|OpenSea|Hyperliquid|Jupiter|Raydium|Orca|Marinade|'
    r'Jito|Pyth|Switchboard|Chainlink|The Graph|Arweave|Filecoin|'
    r'Starknet|zkSync|Scroll|Base|Mantle|Linea|Polygon zkEVM|'
    r'Lightning Network|Stacks|Ordinals|Runes|BRC-20)\b',
    re.IGNORECASE
)

CONCEPT_PATTERN = re.compile(
    r'\b(DeFi|NFT|DAO|DEX|AMM|TVL|yield farming|liquidity mining|'
    r'impermanent loss|MEV|slippage|liquidation|staking|restaking|'
    r'layer 2|L2|rollup|ZK-rollup|optimistic rollup|bridging|'
    r'tokenomics|governance|airdrop|point[s]? system|'
    r'order book|limit order|market order|funding rate|basis trade|'
    r'basis point|alpha|beta|Sharpe ratio|drawdown|volatility|'
    r'market making|arbitrage|momentum|mean reversion|regression|'
    r'monte carlo|black swan|tail risk|reflexivity|narrative trading|'
    r'attention economy|meta|cycle|supercycle|halving|'
    r'risk management|position sizing|portfolio construction|'
    r'expected value|EV|game theory|mechanism design)\b',
    re.IGNORECASE
)

FRAMEWORK_PATTERN = re.compile(
    r'\b(first principles?|second.?order|opportunity cost|supply.?demand|'
    r'network effect|metcalfe.?s? law|reflexivity|monte carlo|'
    r'expected value|cost.?benefit|risk.?reward|valuation model|'
    r'DCF|discounted cash flow|stock.?to.?flow|S2F|'
    r'power law|log.?normal|regression analysis)\b',
    re.IGNORECASE
)


# ─── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class Entity:
    name: str
    type: str  # token, protocol, concept, framework, person, company
    mentions: int = 0

@dataclass
class Relationship:
    source: str
    target: str
    type: str  # mentions, analyzes, compares, predicts, contradicts, derives_from
    context: str = ""

@dataclass
class ChunkMetadata:
    analyst: str
    source: str
    date: str
    url: str
    title: str
    doc_type: str
    entities: list = field(default_factory=list)
    relationships: list = field(default_factory=list)
    chunk_index: int = 0
    file_path: str = ""


# ─── Document Parser ────────────────────────────────────────────────────────

def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from markdown content."""
    if not content.startswith("---"):
        return {}, content
    
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    
    try:
        meta = yaml.safe_load(parts[1])
        body = parts[2].strip()
        return meta or {}, body
    except yaml.YAMLError:
        return {}, content


def semantic_chunk(text: str, max_tokens: int = 512, overlap: int = 64) -> list[str]:
    """
    Split text into chunks by semantic boundaries (headers, paragraphs).
    Falls back to token-based splitting for very long paragraphs.
    """
    # Split by markdown headers first
    sections = re.split(r'\n(?=#{1,3}\s)', text)
    
    chunks = []
    for section in sections:
        # Split by paragraphs
        paragraphs = section.split('\n\n')
        current_chunk = []
        current_len = 0
        
        for para in paragraphs:
            para_len = len(para.split())
            
            if current_len + para_len > max_tokens and current_chunk:
                chunk_text = '\n\n'.join(current_chunk)
                if chunk_text.strip():
                    chunks.append(chunk_text.strip())
                # Keep overlap: last paragraph for context continuity
                current_chunk = [para] if para_len < max_tokens // 2 else []
                current_len = para_len
            else:
                current_chunk.append(para)
                current_len += para_len
        
        if current_chunk:
            chunk_text = '\n\n'.join(current_chunk)
            if chunk_text.strip():
                chunks.append(chunk_text.strip())
    
    # Final fallback: if chunks are still too big, split by approximate token count
    final_chunks = []
    for chunk in chunks:
        words = chunk.split()
        if len(words) > max_tokens * 1.5:
            for i in range(0, len(words), max_tokens - overlap):
                sub = ' '.join(words[i:i + max_tokens])
                if sub.strip():
                    final_chunks.append(sub.strip())
        else:
            if chunk.strip():
                final_chunks.append(chunk.strip())
    
    return final_chunks if final_chunks else [text.strip()]


# ─── Entity Extraction ──────────────────────────────────────────────────────

def extract_entities(text: str) -> list[dict]:
    """Extract crypto-specific entities from text."""
    entities = []
    seen = set()
    
    for match in CRYPTO_TOKEN_PATTERN.finditer(text):
        name = match.group(0).upper()
        if name not in seen:
            # Normalize common names
            name_map = {
                'BITCOIN': 'BTC', 'ETHEREUM': 'ETH', 'SOLANA': 'SOL',
                'AVALANCHE': 'AVAX', 'POLYGON': 'MATIC', 'ARBITRUM': 'ARB',
                'OPTIMISM': 'OP',
            }
            normalized = name_map.get(name, name)
            if normalized not in seen:
                entities.append({"name": normalized, "type": "token"})
                seen.add(normalized)
    
    for match in PROTOCOL_PATTERN.finditer(text):
        name = match.group(0)
        key = name.lower()
        if key not in seen:
            entities.append({"name": name, "type": "protocol"})
            seen.add(key)
    
    for match in CONCEPT_PATTERN.finditer(text):
        name = match.group(0)
        key = name.lower()
        if key not in seen:
            entities.append({"name": name, "type": "concept"})
            seen.add(key)
    
    for match in FRAMEWORK_PATTERN.finditer(text):
        name = match.group(0)
        key = name.lower()
        if key not in seen:
            entities.append({"name": name, "type": "framework"})
            seen.add(key)
    
    return entities


def extract_relationships(text: str, entities: list[dict]) -> list[dict]:
    """Extract relationships between entities based on co-occurrence and signal words."""
    relationships = []
    entity_names = [e["name"].lower() for e in entities]
    
    # Signal words for relationship types
    compare_signals = re.compile(r'\b(compar|versus|vs\.?|similar|different|unlike|like|contrast)\b', re.I)
    predict_signals = re.compile(r'\b(predict|forecast|expect|will|going to|likely|probably|target|price target)\b', re.I)
    analyze_signals = re.compile(r'\b(analy[sz]|framework|model|valuation|fundamental|metric|indicator)\b', re.I)
    derives_signals = re.compile(r'\b(deriv|because|therefore|thus|hence|implies?|suggests?|leads? to)\b', re.I)
    
    # Find entity pairs in same paragraph and classify relationship
    paragraphs = text.split('\n\n')
    for para in paragraphs:
        para_lower = para.lower()
        entities_in_para = [e for e in entities if e["name"].lower() in para_lower]
        
        if len(entities_in_para) < 2:
            continue
        
        rel_type = "mentions"
        if compare_signals.search(para):
            rel_type = "compares"
        elif predict_signals.search(para):
            rel_type = "predicts"
        elif analyze_signals.search(para):
            rel_type = "analyzes"
        elif derives_signals.search(para):
            rel_type = "derives_from"
        
        # Create relationships for entity pairs
        for i, e1 in enumerate(entities_in_para):
            for e2 in entities_in_para[i+1:]:
                relationships.append({
                    "source": e1["name"],
                    "target": e2["name"],
                    "type": rel_type,
                    "context": para[:200]
                })
    
    return relationships


def extract_analytical_patterns(text: str) -> list[str]:
    """Extract the analyst's reasoning patterns and frameworks."""
    patterns = []
    text_lower = text.lower()
    
    pattern_signals = {
        "quantitative_analysis": r'\b(data|statistic|regression|correlation|metric|KPI|ratio|percent)\b',
        "narrative_analysis": r'\b(story|narrative|theme|meta|cycle|sentiment|vibes?)\b',
        "fundamental_analysis": r'\b(fundamental|valuation|cash flow|revenue|earnings|P/E|DCF)\b',
        "technical_analysis": r'\b(chart|pattern|support|resistance|moving average|RSI|MACD|fibonacci)\b',
        "game_theory": r'\b(incentive|mechanism|game theory|Nash|equilibri|payoff|strategy)\b',
        "first_principles": r'\b(first principle|from scratch|building block|deconstruct)\b',
        "comparative": r'\b(compare|versus|vs|relative to|benchmark|contrast)\b',
        "risk_focused": r'\b(risk|downside|drawdown|loss|protect|hedge|insurance)\b',
        "macro_perspective": r'\b(macro|global|macroeconomic|Fed|interest rate|inflation|DXY)\b',
        "micro_structure": r'\b(order flow|market micro|liquidity|spread|depth|book)\b',
    }
    
    for pattern_name, regex in pattern_signals.items():
        if re.search(regex, text, re.IGNORECASE):
            matches = len(re.findall(regex, text, re.IGNORECASE))
            if matches >= 2:
                patterns.append(pattern_name)
    
    return patterns


# ─── Main KG Class ──────────────────────────────────────────────────────────

class CryptoKG:
    """Knowledge Graph for crypto analyst content with vector search."""
    
    def __init__(self, persist_dir: Path = PERSIST_DIR):
        self.persist_dir = persist_dir
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize embedding model
        print("Loading embedding model...")
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        
        # Initialize ChromaDB
        self.client = chromadb.PersistentClient(
            path=str(self.persist_dir),
            settings=Settings(anonymized_telemetry=False)
        )
        
        # Collections
        self.chunks_col = self.client.get_or_create_collection(
            name="chunks",
            metadata={"hnsw:space": "cosine"}
        )
        self.entities_col = self.client.get_or_create_collection(
            name="entities",
            metadata={"hnsw:space": "cosine"}
        )
        
        print(f"KG initialized. DB at: {self.persist_dir}")
    
    def _doc_id(self, analyst: str, file_path: str, chunk_idx: int) -> str:
        """Generate deterministic document ID."""
        key = f"{analyst}:{file_path}:{chunk_idx}"
        return hashlib.md5(key.encode()).hexdigest()[:16]
    
    def _load_documents(self, analyst: str) -> list[dict]:
        """Load all markdown files for an analyst."""
        content_dir = DATA_DIR / analyst / "content"
        if not content_dir.exists():
            print(f"Warning: {content_dir} not found")
            return []
        
        docs = []
        for file_path in sorted(content_dir.glob("*.md")):
            try:
                content = file_path.read_text(encoding='utf-8')
                meta, body = parse_frontmatter(content)
                
                if not body.strip():
                    continue
                
                docs.append({
                    "file_path": str(file_path),
                    "analyst": analyst,
                    "meta": meta,
                    "body": body,
                })
            except Exception as e:
                print(f"  Error reading {file_path}: {e}")
        
        return docs
    
    def build_index(self, analysts: list[str] = None):
        """Build the full index for specified analysts."""
        if analysts is None:
            analysts = ["thiccyth0t", "TopherGMI"]
        
        total_chunks = 0
        
        for analyst in analysts:
            print(f"\n{'='*60}")
            print(f"Processing: {analyst}")
            print(f"{'='*60}")
            
            docs = self._load_documents(anyst := analyst)
            print(f"  Found {len(docs)} documents")
            
            batch_ids = []
            batch_embeddings = []
            batch_documents = []
            batch_metadatas = []
            
            entity_batch_ids = []
            entity_batch_embeddings = []
            entity_batch_documents = []
            entity_batch_metadatas = []
            
            all_entities = {}  # Track unique entities
            
            for doc in docs:
                meta = doc["meta"]
                body = doc["body"]
                file_path = doc["file_path"]
                
                # Semantic chunking
                chunks = semantic_chunk(body)
                
                for idx, chunk in enumerate(chunks):
                    chunk_id = self._doc_id(analyst, file_path, idx)
                    
                    # Extract entities and relationships
                    entities = extract_entities(chunk)
                    relationships = extract_relationships(chunk, entities)
                    patterns = extract_analytical_patterns(chunk)
                    
                    # Track unique entities
                    for e in entities:
                        ekey = f"{e['name']}:{e['type']}"
                        if ekey not in all_entities:
                            all_entities[ekey] = {"name": e["name"], "type": e["type"], "count": 0}
                        all_entities[ekey]["count"] += 1
                    
                    # Build metadata (ChromaDB needs JSON-serializable values)
                    chunk_meta = {
                        "analyst": analyst,
                        "source": meta.get("source", ""),
                        "date": str(meta.get("date", "")),
                        "url": meta.get("url", ""),
                        "title": meta.get("title", ""),
                        "doc_type": meta.get("type", ""),
                        "entities": json.dumps([e["name"] for e in entities]),
                        "relationships": json.dumps(relationships[:5]),  # Limit for size
                        "patterns": json.dumps(patterns),
                        "chunk_index": idx,
                        "file_path": file_path,
                    }
                    
                    batch_ids.append(chunk_id)
                    batch_documents.append(chunk)
                    batch_metadatas.append(chunk_meta)
                    
                    # Generate embedding
                    embedding = self.model.encode(chunk).tolist()
                    batch_embeddings.append(embedding)
                    
                    total_chunks += 1
                
                # Add in batches to avoid memory issues
                if len(batch_ids) >= 100:
                    self._add_batch(
                        self.chunks_col,
                        batch_ids, batch_embeddings, batch_documents, batch_metadatas
                    )
                    batch_ids, batch_embeddings, batch_documents, batch_metadatas = [], [], [], []
            
            # Add remaining chunks
            if batch_ids:
                self._add_batch(
                    self.chunks_col,
                    batch_ids, batch_embeddings, batch_documents, batch_metadatas
                )
            
            # Index unique entities
            print(f"  Indexing {len(all_entities)} unique entities...")
            for ekey, edata in all_entities.items():
                eid = hashlib.md5(f"{analyst}:{ekey}".encode()).hexdigest()[:16]
                edesc = f"{edata['name']} ({edata['type']}) - mentioned {edata['count']} times by {analyst}"
                eemb = self.model.encode(edesc).tolist()
                
                entity_batch_ids.append(eid)
                entity_batch_documents.append(edesc)
                entity_batch_embeddings.append(eemb)
                entity_batch_metadatas.append({
                    "analyst": analyst,
                    "entity_name": edata["name"],
                    "entity_type": edata["type"],
                    "mention_count": edata["count"],
                })
            
            if entity_batch_ids:
                self._add_batch(
                    self.entities_col,
                    entity_batch_ids, entity_batch_embeddings, entity_batch_documents, entity_batch_metadatas
                )
            
            print(f"  Done with {analyst}")
        
        print(f"\n✅ Index built: {total_chunks} chunks indexed")
        print(f"   Chunks collection: {self.chunks_col.count()} items")
        print(f"   Entities collection: {self.entities_col.count()} items")
    
    def _add_batch(self, col, ids, embeddings, documents, metadatas):
        """Add a batch to a ChromaDB collection."""
        col.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
    
    def query(
        self,
        question: str,
        analyst: Optional[str] = None,
        n_results: int = 5,
        include_entities: bool = True,
    ) -> dict:
        """
        Query the knowledge graph.
        
        Returns:
            {
                "chunks": [{"text": ..., "metadata": ..., "distance": ...}, ...],
                "entities": [{"name": ..., "type": ..., "analyst": ...}, ...],
                "relationships": [{"source": ..., "target": ..., "type": ...}, ...],
                "analytical_patterns": [...],
            }
        """
        query_embedding = self.model.encode(question).tolist()
        
        # Build filter
        where_filter = {}
        if analyst:
            where_filter = {"analyst": analyst}
        
        # Search chunks
        chunk_results = self.chunks_col.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where_filter if where_filter else None,
        )
        
        # Process results
        chunks = []
        all_relationships = []
        all_patterns = set()
        all_entities = set()
        
        if chunk_results["documents"] and chunk_results["documents"][0]:
            for i, doc in enumerate(chunk_results["documents"][0]):
                meta = chunk_results["metadatas"][0][i]
                dist = chunk_results["distances"][0][i] if chunk_results.get("distances") else None
                
                # Parse embedded JSON fields
                entities = json.loads(meta.get("entities", "[]"))
                relationships = json.loads(meta.get("relationships", "[]"))
                patterns = json.loads(meta.get("patterns", "[]"))
                
                all_entities.update(entities)
                all_relationships.extend(relationships)
                all_patterns.update(patterns)
                
                chunks.append({
                    "text": doc,
                    "metadata": {
                        "analyst": meta.get("analyst"),
                        "title": meta.get("title"),
                        "date": meta.get("date"),
                        "url": meta.get("url"),
                        "source": meta.get("source"),
                    },
                    "distance": dist,
                    "entities": entities,
                })
        
        # Search entities separately
        entity_results = []
        if include_entities:
            ent_res = self.entities_col.query(
                query_embeddings=[query_embedding],
                n_results=10,
                where=where_filter if where_filter else None,
            )
            if ent_res["documents"] and ent_res["documents"][0]:
                for i, doc in enumerate(ent_res["documents"][0]):
                    meta = ent_res["metadatas"][0][i]
                    entity_results.append({
                        "name": meta.get("entity_name"),
                        "type": meta.get("entity_type"),
                        "analyst": meta.get("analyst"),
                        "mention_count": meta.get("mention_count"),
                    })
        
        return {
            "chunks": chunks,
            "entities": entity_results,
            "relationships": all_relationships[:10],  # Top 10
            "analytical_patterns": list(all_patterns),
        }
    
    def get_entity_graph(self, entity_name: str, analyst: Optional[str] = None) -> dict:
        """Get all relationships for a specific entity."""
        # Search for chunks mentioning this entity
        emb = self.model.encode(entity_name).tolist()
        
        where_filter = {}
        if analyst:
            where_filter = {"analyst": analyst}
        
        results = self.chunks_col.query(
            query_embeddings=[emb],
            n_results=20,
            where=where_filter if where_filter else None,
        )
        
        related_entities = set()
        relationships = []
        relevant_chunks = []
        
        if results["documents"] and results["documents"][0]:
            for i, doc in enumerate(results["documents"][0]):
                meta = results["metadatas"][0][i]
                entities = json.loads(meta.get("entities", "[]"))
                rels = json.loads(meta.get("relationships", "[]"))
                
                # Check if this chunk mentions our target entity
                entity_lower = entity_name.lower()
                entities_lower = [e.lower() for e in entities]
                
                if entity_lower in entities_lower or any(entity_lower in e for e in entities_lower):
                    related_entities.update(entities)
                    relationships.extend(rels)
                    relevant_chunks.append({
                        "text": doc[:300],
                        "title": meta.get("title"),
                        "date": meta.get("date"),
                    })
        
        return {
            "entity": entity_name,
            "related_entities": list(related_entities),
            "relationships": relationships[:15],
            "relevant_chunks": relevant_chunks[:5],
        }
    
    def stats(self) -> dict:
        """Get statistics about the knowledge graph."""
        return {
            "chunks": self.chunks_col.count(),
            "entities": self.entities_col.count(),
            "persist_dir": str(self.persist_dir),
        }


# ─── Convenience Functions ──────────────────────────────────────────────────

def format_results(results: dict, max_text_len: int = 500) -> str:
    """Format query results for display."""
    lines = []
    
    lines.append("=" * 70)
    lines.append("QUERY RESULTS")
    lines.append("=" * 70)
    
    if results["chunks"]:
        lines.append(f"\n📄 RELEVANT CONTENT ({len(results['chunks'])} matches):\n")
        for i, chunk in enumerate(results["chunks"], 1):
            meta = chunk["metadata"]
            lines.append(f"  [{i}] {meta['title']} ({meta['date']})")
            lines.append(f"      Analyst: {meta['analyst']} | Source: {meta['source']}")
            if chunk.get("distance") is not None:
                lines.append(f"      Similarity: {1 - chunk['distance']:.3f}")
            
            text = chunk["text"][:max_text_len]
            if len(chunk["text"]) > max_text_len:
                text += "..."
            # Indent text
            for line in text.split("\n"):
                lines.append(f"        {line}")
            lines.append("")
    
    if results["entities"]:
        lines.append(f"\n🏷️  RELATED ENTITIES ({len(results['entities'])}):\n")
        for ent in results["entities"]:
            lines.append(f"  • {ent['name']} ({ent['type']}) — {ent['mention_count']} mentions by {ent['analyst']}")
        lines.append("")
    
    if results["relationships"]:
        lines.append(f"\n🔗 RELATIONSHIPS:\n")
        for rel in results["relationships"][:10]:
            lines.append(f"  {rel['source']} --[{rel['type']}]--> {rel['target']}")
        lines.append("")
    
    if results["analytical_patterns"]:
        lines.append(f"\n🧠 ANALYTICAL PATTERNS: {', '.join(results['analytical_patterns'])}\n")
    
    return "\n".join(lines)
