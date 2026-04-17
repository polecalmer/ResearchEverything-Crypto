#!/usr/bin/env python3
"""
Deduplicate entities in ChromaDB knowledge graphs.

Merges protocol/token pairs, case variants, and aliases into canonical names.
"""

import json
import hashlib
import chromadb
from chromadb.config import Settings
from pathlib import Path
from collections import defaultdict

PERSIST_DIR = Path(__file__).parent / "chroma_db"

# ─── Merge Mapping ───────────────────────────────────────────────────────────
# Maps lowercase variant → canonical name
# Protocol+Token pairs: protocol name is canonical, token ticker is merged in
# Case variants: title case or commonly known name is canonical
ENTITY_NORMALIZATION = {
    # ── Protocol + Token pairs ──
    # Uniswap / UNI / UNISWAP / uniswap
    "uni": "Uniswap",
    "uniswap": "Uniswap",
    # Aave / AAVE / aave
    "aave": "Aave",
    # Lido / LDO / LIDO / lido
    "ldo": "Lido",
    "lido": "Lido",
    # Curve / CRV / CURVE / curve
    "crv": "Curve",
    "curv": "Curve",
    "curve": "Curve",
    # MakerDAO / MKR / MAKERDAO / MakerDao
    "mkr": "MakerDAO",
    "makerdao": "MakerDAO",
    "makerdao": "MakerDAO",
    # dYdX / DYDX
    "dydx": "dYdX",
    # Blur / BLUR / blur
    "blur": "Blur",
    # Pendle / PENDLE / pendle
    "pendle": "Pendle",
    # Compound / COMP / compound
    "comp": "Compound",
    "compound": "Compound",
    # Celestia / TIA
    "tia": "Celestia",
    "celestia": "Celestia",
    # Jupiter / JUP / jupiter
    "jup": "Jupiter",
    "jupiter": "Jupiter",
    # Chainlink / LINK / chainlink
    "link": "Chainlink",
    "chainlink": "Chainlink",
    # Convex / CVX / CONVEX / convex
    "cvx": "Convex",
    "convex": "Convex",
    # Blur / BLUR (already handled above)
    # Sushi / SUSHI
    "sushi": "Sushi",
    # 1inch / 1INCH
    "1inch": "1inch",
    # YFI / yearn.finance
    "yfi": "Yearn",
    # SNX / Synthetix
    "snx": "Synthetix",
    # RPL / Rocket Pool
    "rpl": "Rocket Pool",
    
    # ── Layer 1 blockchains ──
    # Bitcoin / BTC / bitcoin
    "btc": "Bitcoin",
    "bitcoin": "Bitcoin",
    # Ethereum / ETH / ethereum
    "eth": "Ethereum",
    "ethereum": "Ethereum",
    # Solana / SOL / solana
    "sol": "Solana",
    "solana": "Solana",
    # Avalanche / AVAX / avalanche
    "avax": "Avalanche",
    "avalanche": "Avalanche",
    # Polygon / MATIC / polygon
    "matic": "Polygon",
    "polygon": "Polygon",
    # Arbitrum / ARB / arbitrum
    "arb": "Arbitrum",
    "arbitrum": "Arbitrum",
    # Optimism / OP / optimism
    "op": "Optimism",
    "optimism": "Optimism",
    # Near / NEAR / near
    "near": "NEAR",
    # Cardano / ADA
    "ada": "Cardano",
    # Polkadot / DOT
    "dot": "Polkadot",
    # Algorand / ALGO
    "algo": "Algorand",
    # Fantom / FTM
    "ftm": "Fantom",
    # Cosmos / ATOM
    "atom": "Cosmos",
    # Aptos / APTOS
    "aptos": "Aptos",
    # XRP / Ripple
    "xrp": "XRP",
    
    # ── Exchanges ──
    # Binance / BINANCE / BNB (BNB not seen but include)
    "binance": "Binance",
    "bnb": "Binance",
    # Coinbase / COINBASE
    "coinbase": "Coinbase",
    # Kraken / KRAKEN
    "kraken": "Kraken",
    # Bybit / BYBIT
    "bybit": "Bybit",
    # Bitfinex / BITFINEX
    "bitfinex": "Bitfinex",
    # OKX / okx
    "okx": "OKX",
    
    # ── Stablecoins ──
    # Circle / USDC
    "usdc": "Circle",
    "circle": "Circle",
    # Tether / USDT / TETHER
    "usdt": "Tether",
    "tether": "Tether",
    # DAI (standalone)
    "dai": "DAI",
    # FRAX
    "frax": "FRAX",
    
    # ── Hyperliquid / HYPE (not seen HYPE but include) ──
    "hyperliquid": "Hyperliquid",
    "hype": "Hyperliquid",
    
    # ── Other protocols ──
    "base": "Base",
    "monad": "Monad",
    "jito": "Jito",
    "raydium": "Raydium",
    "orca": "Orca",
    "openSea": "OpenSea",
    "opensea": "OpenSea",
    "starknet": "Starknet",
    "zksync": "zkSync",
    "zkSync": "zkSync",
    "scroll": "Scroll",
    "mantle": "Mantle",
    "linea": "Linea",
    "eigenlayer": "EigenLayer",
    "berachain": "Berachain",
    "ethena": "Ethena",
    "arweave": "Arweave",
    "filecoin": "Filecoin",
    "stacks": "Stacks",
    "ordinals": "Ordinals",
    "runes": "Runes",
    "lightning": "Lightning Network",
    "the graph": "The Graph",
    "pyth": "Pyth",
    "gm": "GMX",  # just in case
    "gmx": "GMX",
    "sei": "SEI",
    "sui": "SUI",
    "bonk": "BONK",
    "pepe": "PEPE",
    "doge": "DOGE",
    "shib": "SHIB",
    "wif": "WIF",
    "rndr": "RNDR",
    "icp": "ICP",
    "fil": "Filecoin",
    "stx": "Stacks",
    "sats": "SATS",
    "jto": "JTO",
    
    # ── Concepts (case-normalize) ──
    "defi": "DeFi",
    "dex": "DEX",
    "dao": "DAO",
    "nft": "NFT",
    "amm": "AMM",
    "tvl": "TVL",
    "l2": "L2",
    "layer 2": "L2",
    "layer  2": "L2",
    "mev": "MEV",
    "ev": "EV",
    "lido": "Lido",  # already above
    "staking": "Staking",
    "governance": "Governance",
    "volatility": "Volatility",
    "airdrop": "Airdrop",
    "bridging": "Bridging",
    "tokenomics": "Tokenomics",
    "cycle": "Cycle",
    "liquidation": "Liquidation",
    "slippage": "Slippage",
    "drawdown": "Drawdown",
    "momentum": "Momentum",
    "halving": "Halving",
    "alpha": "Alpha",
    "beta": "Beta",
    "meta": "Meta",
    "funding rate": "Funding Rate",
    "order book": "Order Book",
    "limit order": "Limit Order",
    "market order": "Market Order",
    "arbitrage": "Arbitrage",
    "restaking": "Restaking",
    "yield farming": "Yield Farming",
    "liquidity mining": "Liquidity Mining",
    "impermanent loss": "Impermanent Loss",
    "risk management": "Risk Management",
    "position sizing": "Position Sizing",
    "portfolio construction": "Portfolio Construction",
    "market making": "Market Making",
    "basis point": "Basis Point",
    "basis trade": "Basis Trade",
    "expected value": "Expected Value",
    "second-order": "Second-Order",
    "second order": "Second-Order",
    "reflexivity": "Reflexivity",
    "game theory": "Game Theory",
    "tail risk": "Tail Risk",
    "black swan": "Black Swan",
    "attention economy": "Attention Economy",
    "supercycle": "Supercycle",
    "monte carlo": "Monte Carlo",
    "power law": "Power Law",
    "opportunity cost": "Opportunity Cost",
    
    # ── Frameworks (case-normalize) ──
    "dcf": "DCF",
    "metcalfe's law": "Metcalfe's Law",
    "first principles": "First Principles",
    "supply/demand": "Supply/Demand",
    "risk-reward": "Risk-Reward",
    "risk/reward": "Risk-Reward",
}


def normalize_entity_name(name: str) -> str:
    """Normalize an entity name to its canonical form."""
    # Try exact match first
    key = name.strip()
    if key in ENTITY_NORMALIZATION:
        return ENTITY_NORMALIZATION[key]
    # Try lowercase
    key_lower = key.lower()
    if key_lower in ENTITY_NORMALIZATION:
        return ENTITY_NORMALIZATION[key_lower]
    # Return original if no mapping found
    return key


def dedup_entities():
    """Main deduplication logic."""
    print("Connecting to ChromaDB...")
    client = chromadb.PersistentClient(
        path=str(PERSIST_DIR),
        settings=Settings(anonymized_telemetry=False)
    )
    
    entities_col = client.get_collection("entities")
    chunks_col = client.get_collection("chunks")
    
    print(f"Entities collection: {entities_col.count()} items")
    print(f"Chunks collection: {chunks_col.count()} items")
    
    # ── Step 1: Analyze entity duplicates ──
    print("\n=== Step 1: Analyzing entity duplicates ===")
    all_entities = entities_col.get(include=["documents", "metadatas"])
    
    # Group by analyst
    entities_by_analyst = defaultdict(list)
    for i, eid in enumerate(all_entities["ids"]):
        meta = all_entities["metadatas"][i]
        analyst = meta.get("analyst", "unknown")
        entities_by_analyst[analyst].append({
            "id": eid,
            "name": meta.get("entity_name", ""),
            "type": meta.get("entity_type", ""),
            "count": meta.get("mention_count", 0),
            "metadata": meta,
            "document": all_entities["documents"][i],
        })
    
    for analyst, entities in entities_by_analyst.items():
        print(f"\n{analyst}: {len(entities)} entities")
        
        # Find what normalization would do
        changes = {}
        for e in entities:
            canonical = normalize_entity_name(e["name"])
            if canonical != e["name"]:
                if canonical not in changes:
                    changes[canonical] = []
                changes[canonical].append(e["name"])
        
        for canonical, variants in sorted(changes.items()):
            print(f"  {canonical} ← {variants}")
    
    # ── Step 2: Update entities collection ──
    print("\n=== Step 2: Updating entities collection ===")
    
    for analyst, entities in entities_by_analyst.items():
        # Group entities by canonical name
        canonical_groups = defaultdict(list)
        for e in entities:
            canonical = normalize_entity_name(e["name"])
            canonical_groups[canonical].append(e)
        
        entities_to_delete = []
        
        for canonical, group in canonical_groups.items():
            if len(group) == 1 and group[0]["name"] == canonical:
                # No change needed
                continue
            
            # Merge: pick the entity with the canonical name if it exists,
            # otherwise pick the one with highest mention count
            primary = None
            for e in group:
                if e["name"] == canonical:
                    primary = e
                    break
            if primary is None:
                primary = max(group, key=lambda x: x["count"])
            
            # Sum up mention counts
            total_count = sum(e["count"] for e in group)
            
            # Determine entity type - prefer 'protocol' over 'token' if merging
            types = set(e["type"] for e in group)
            if "protocol" in types:
                etype = "protocol"
            elif "token" in types:
                etype = "token"
            else:
                etype = primary["type"]
            
            # Update the primary entity
            new_desc = f"{canonical} ({etype}) - mentioned {total_count} times by {analyst}"
            new_meta = {
                "analyst": analyst,
                "entity_name": canonical,
                "entity_type": etype,
                "mention_count": total_count,
            }
            
            # Check if primary needs updating
            if primary["name"] != canonical or primary["count"] != total_count or primary["type"] != etype:
                # We need to update this entity
                # If primary already has canonical name, just update it
                if primary["name"] == canonical:
                    entities_col.update(
                        ids=[primary["id"]],
                        documents=[new_desc],
                        metadatas=[new_meta],
                    )
                    print(f"  [{analyst}] Updated {canonical}: count={total_count}, type={etype}")
                else:
                    # Primary doesn't have canonical name, need to create new and delete old
                    new_id = hashlib.md5(f"{analyst}:{canonical}:{etype}".encode()).hexdigest()[:16]
                    entities_col.add(
                        ids=[new_id],
                        documents=[new_desc],
                        metadatas=[new_meta],
                    )
                    entities_to_delete.append(primary["id"])
                    print(f"  [{analyst}] Created {canonical}: count={total_count}, type={etype}")
                
                # Mark all others for deletion
                for e in group:
                    if e["id"] != primary["id"]:
                        entities_to_delete.append(e["id"])
                        if e["name"] != canonical:
                            print(f"  [{analyst}] Deleting duplicate: {e['name']} (count={e['count']})")
        
        # Delete duplicates
        if entities_to_delete:
            print(f"  [{analyst}] Deleting {len(entities_to_delete)} duplicate entities")
            entities_col.delete(ids=entities_to_delete)
    
    # ── Step 3: Update chunk metadata ──
    print("\n=== Step 3: Updating chunk metadata ===")
    
    # Get all chunks
    chunk_count = chunks_col.count()
    print(f"Total chunks: {chunk_count}")
    
    # Process in batches
    batch_size = 500
    updated_chunks = 0
    
    for offset in range(0, chunk_count, batch_size):
        chunk_results = chunks_col.get(
            include=["metadatas"],
            limit=batch_size,
            offset=offset if offset > 0 else None,
        )
        
        if not chunk_results["ids"]:
            break
        
        for i, cid in enumerate(chunk_results["ids"]):
            meta = chunk_results["metadatas"][i]
            needs_update = False
            
            # Update entities list
            entities_json = meta.get("entities", "[]")
            try:
                entities = json.loads(entities_json)
                normalized_entities = []
                for e in entities:
                    ne = normalize_entity_name(e)
                    if ne not in normalized_entities:
                        normalized_entities.append(ne)
                if normalized_entities != entities:
                    meta["entities"] = json.dumps(normalized_entities)
                    needs_update = True
            except:
                pass
            
            # Update relationships
            rels_json = meta.get("relationships", "[]")
            try:
                rels = json.loads(rels_json)
                for r in rels:
                    old_source = r["source"]
                    old_target = r["target"]
                    r["source"] = normalize_entity_name(r["source"])
                    r["target"] = normalize_entity_name(r["target"])
                    if r["source"] != old_source or r["target"] != old_target:
                        needs_update = True
                if needs_update:
                    meta["relationships"] = json.dumps(rels)
            except:
                pass
            
            if needs_update:
                chunks_col.update(
                    ids=[cid],
                    metadatas=[meta],
                )
                updated_chunks += 1
        
        if offset % 2000 == 0:
            print(f"  Processed {offset + len(chunk_results['ids'])} chunks, updated {updated_chunks}")
    
    print(f"\nTotal chunks updated: {updated_chunks}")
    
    # ── Final stats ──
    print("\n=== Final Stats ===")
    final_entities = entities_col.count()
    print(f"Entities collection: {final_entities} items")
    print(f"Chunks collection: {chunks_col.count()} items")


if __name__ == "__main__":
    dedup_entities()
