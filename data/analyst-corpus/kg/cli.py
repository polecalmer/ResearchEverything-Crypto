#!/usr/bin/env python3
"""
CLI for the Crypto Analyst Knowledge Graph.

Usage:
    python cli.py build                    # Build the index (run once)
    python cli.py query "your question"    # Query the KG
    python cli.py query "question" -a thiccyth0t  # Query specific analyst
    python cli.py entity "Uniswap"         # Explore entity relationships
    python cli.py stats                    # Show KG statistics
    python cli.py test                     # Run test queries
"""

import sys
import json
import argparse
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))

from kg import CryptoKG, format_results


def cmd_build(args):
    """Build the knowledge graph index."""
    kg = CryptoKG()
    analysts = args.analysts if args.analysts else None
    kg.build_index(analysts=analysts)
    
    stats = kg.stats()
    print(f"\n📊 Index Statistics:")
    print(f"   Chunks: {stats['chunks']}")
    print(f"   Entities: {stats['entities']}")
    print(f"   Location: {stats['persist_dir']}")


def cmd_query(args):
    """Query the knowledge graph."""
    kg = CryptoKG()
    results = kg.query(
        args.question,
        analyst=args.analyst,
        n_results=args.n_results,
    )
    
    if args.json:
        print(json.dumps(results, indent=2, default=str))
    else:
        print(format_results(results))


def cmd_entity(args):
    """Explore entity relationships."""
    kg = CryptoKG()
    results = kg.get_entity_graph(args.entity_name, analyst=args.analyst)
    
    if args.json:
        print(json.dumps(results, indent=2, default=str))
    else:
        print(f"\n{'='*60}")
        print(f"Entity: {results['entity']}")
        print(f"{'='*60}")
        
        if results["related_entities"]:
            print(f"\nRelated Entities:")
            for e in sorted(results["related_entities"]):
                print(f"  • {e}")
        
        if results["relationships"]:
            print(f"\nRelationships:")
            for r in results["relationships"]:
                print(f"  {r['source']} --[{r['type']}]--> {r['target']}")
        
        if results["relevant_chunks"]:
            print(f"\nRelevant Content:")
            for i, c in enumerate(results["relevant_chunks"], 1):
                print(f"  [{i}] {c['title']} ({c['date']})")
                print(f"      {c['text'][:200]}...")
        print()


def cmd_stats(args):
    """Show knowledge graph statistics."""
    kg = CryptoKG()
    stats = kg.stats()
    print(f"\n📊 Knowledge Graph Statistics:")
    print(f"   Chunks indexed: {stats['chunks']}")
    print(f"   Entities indexed: {stats['entities']}")
    print(f"   Database location: {stats['persist_dir']}")
    print()


def cmd_test(args):
    """Run test queries to verify the system works."""
    kg = CryptoKG()
    
    test_queries = {
        "thiccyth0t": [
            "What does thiccyth0t think about Bitcoin's fundamental value?",
            "How does thiccyth0t approach trading and risk management?",
            "What frameworks does thiccyth0t use for market analysis?",
            "What does thiccyth0t say about DeFi and liquidity provision?",
            "How does thiccyth0t analyze market microstructure?",
        ],
        "TopherGMI": [
            "What does TopherGMI think about token valuation and fundamentals?",
            "How does TopherGMI analyze DeFi protocols?",
            "What is TopherGMI's view on Bitcoin and macro markets?",
            "How does TopherGMI approach portfolio construction?",
            "What does TopherGMI say about NFTs and digital assets?",
        ],
    }
    
    print("\n" + "=" * 70)
    print("RUNNING TEST QUERIES")
    print("=" * 70)
    
    for analyst, queries in test_queries.items():
        print(f"\n{'─'*70}")
        print(f"Analyst: {analyst}")
        print(f"{'─'*70}")
        
        for i, q in enumerate(queries, 1):
            print(f"\n{'─'*50}")
            print(f"Query {i}: {q}")
            print(f"{'─'*50}")
            
            results = kg.query(q, analyst=analyst, n_results=3)
            
            if results["chunks"]:
                for j, chunk in enumerate(results["chunks"][:3], 1):
                    meta = chunk["metadata"]
                    score = f" (sim: {1 - chunk['distance']:.3f})" if chunk.get("distance") else ""
                    print(f"\n  Result {j}: {meta['title']} — {meta['date']}{score}")
                    
                    # Show first 300 chars of text
                    text = chunk["text"][:300]
                    if len(chunk["text"]) > 300:
                        text += "..."
                    for line in text.split("\n")[:5]:
                        print(f"    {line}")
                    
                    # Show entities
                    if chunk.get("entities"):
                        print(f"    Entities: {', '.join(chunk['entities'][:8])}")
            else:
                print("  No results found.")
            
            if results["analytical_patterns"]:
                print(f"  Patterns: {', '.join(results['analytical_patterns'])}")
    
    print(f"\n{'='*70}")
    print("TEST COMPLETE")
    print(f"{'='*70}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Crypto Analyst Knowledge Graph CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Build command
    build_parser = subparsers.add_parser("build", help="Build the knowledge graph index")
    build_parser.add_argument(
        "-a", "--analysts",
        nargs="+",
        choices=["thiccyth0t", "TopherGMI"],
        help="Analysts to index (default: both)"
    )
    build_parser.set_defaults(func=cmd_build)
    
    # Query command
    query_parser = subparsers.add_parser("query", help="Query the knowledge graph")
    query_parser.add_argument("question", help="Question to ask")
    query_parser.add_argument("-a", "--analyst", help="Filter by analyst")
    query_parser.add_argument("-n", "--n-results", type=int, default=5, help="Number of results")
    query_parser.add_argument("--json", action="store_true", help="Output as JSON")
    query_parser.set_defaults(func=cmd_query)
    
    # Entity command
    entity_parser = subparsers.add_parser("entity", help="Explore entity relationships")
    entity_parser.add_argument("entity_name", help="Entity name to explore")
    entity_parser.add_argument("-a", "--analyst", help="Filter by analyst")
    entity_parser.add_argument("--json", action="store_true", help="Output as JSON")
    entity_parser.set_defaults(func=cmd_entity)
    
    # Stats command
    stats_parser = subparsers.add_parser("stats", help="Show KG statistics")
    stats_parser.set_defaults(func=cmd_stats)
    
    # Test command
    test_parser = subparsers.add_parser("test", help="Run test queries")
    test_parser.set_defaults(func=cmd_test)
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    args.func(args)


if __name__ == "__main__":
    main()
