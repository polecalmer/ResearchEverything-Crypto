# Autoresearch Eval System — Handoff

## What was built

A self-improving benchmark and evaluation system for Research Everything's AI data agent. The system tests whether the agent can generate correct charts from natural language queries, scores results against ground truth, analyzes failures, and generates prompt improvements automatically.

## Final Numbers

### 500-Case Ecosystem Benchmark (Apr 9, 2026)

**89.6% accuracy (448/500 passed)**

| Metric Type | Accuracy | Cases |
|-------------|----------|-------|
| TVL | 99.6% | 241 |
| Fees | 95.1% | 82 |
| Revenue | 84.0% | 81 |
| Market Cap | 100.0% | 7 |
| Intent: Vague | 100.0% | 7 |
| Intent: Multichain | 85.7% | 7 |
| Intent: Timerange | 75.0% | 8 |
| Intent: Implicit | 71.4% | 7 |
| Intent: Comparison | 62.5% | 8 |
| Price | 47.8% | 46 |
| P/E Ratio | 66.7% | 6 |

### Accuracy Progression

| Date | Accuracy | Cases | Milestone |
|------|----------|-------|-----------|
| Mar 25 | 40.0% | 30 | First run — baseline |
| Mar 25 | 93.3% | 30 | Slug resolution + hints |
| Mar 26 | 98.0% | 50 | Training loop peak |
| Mar 27 | 94.2% | 431 | Full DeFi benchmark |
| Mar 29 | 76.3% | 224 | Out-of-sample test |
| Apr 9 | 89.6% | 500 | Final ecosystem benchmark |

## System Architecture

```
Production App (Replit) ──── reads rules from ──── PostgreSQL DB
                                                        |
Benchmark Runner (local) ── writes rules to ────────────┘
```

### Key Components

- **server/benchmark/cli.ts** — CLI entry point for all benchmark operations
- **server/benchmark/runner.ts** — Core benchmark loop: execute cases, score, analyze, improve
- **server/benchmark/eval.ts** — Scoring: magnitude (40%), trend (20%), shape/MAPE (40%)
- **server/benchmark/cross-validate.ts** — Reference data fetching from DeFiLlama/CoinGecko
- **server/benchmark/train.ts** — Automated training loop with budget cap and convergence
- **server/benchmark/seed.ts** — Auto-generates cases from DeFiLlama protocol list
- **server/benchmark/seed-compound.ts** — Compound financial query cases
- **server/benchmark/seed-intent.ts** — Intent interpretation cases (50 cases, 5 categories)
- **server/benchmark/crawl-protocols.ts** — Indexes 7,804 projects into project_knowledge
- **server/benchmark/research.ts** — Protocol revenue model discovery via Claude API
- **server/dune-mcp-client.ts** — Dune MCP table discovery for SQL generation

### Database Tables

| Table | Purpose |
|-------|---------|
| benchmark_cases | 900 test cases across all categories |
| benchmark_runs | Run history with accuracy tracking |
| benchmark_case_results | Per-case scores within each run |
| system_learnings | 136 active prompt rules (auto-generated) |
| proven_queries | Cached working SQL queries |
| project_knowledge | 7,804 projects with structured metadata |
| protocol_revenue_models | Researched revenue logic per protocol |
| query_templates | SQL templates for compound queries |

### CLI Reference

```bash
# Standard benchmark
npx tsx server/benchmark/cli.ts run --subset 50 --verbose

# Force Dune SQL (no DeFiLlama fallback)
npx tsx server/benchmark/cli.ts run --subset 50 --force-dune --verbose

# Compound/P/E cases only
npx tsx server/benchmark/cli.ts run --compound --verbose

# Intent interpretation cases only
npx tsx server/benchmark/cli.ts run --intent --verbose

# Dry run (don't apply improvements)
npx tsx server/benchmark/cli.ts run --subset 50 --dry-run --verbose

# Automated training loop
npx tsx server/benchmark/train.ts

# Seed cases
npx tsx server/benchmark/cli.ts seed
npx tsx server/benchmark/cli.ts seed-compound
npx tsx server/benchmark/cli.ts seed-intent

# Protocol crawler
npx tsx server/benchmark/crawl-protocols.ts

# Status and failures
npx tsx server/benchmark/cli.ts status
npx tsx server/benchmark/cli.ts failures [runId]
```

## What Went Into Production

These changes are live in the production data-agent.ts:

1. **P/E routing** — System prompt routes P/E to DeFiLlama revenue + CoinGecko mcap, never Dune SQL
2. **DATA_AGENT_SYSTEM export** — Benchmark imports the same prompt as production
3. **Time range rules** — Agent interprets "last month", "YTD", "since the merge" correctly
4. **Comparison completeness** — Agent produces data for ALL mentioned protocols
5. **Dune MCP table discovery** — Agent sees available tables before writing SQL
6. **136 learned rules** — In system_learnings table, read by production on every request
7. **JSON repair** — Handles markdown-fenced JSON, trailing commas, mixed text
8. **Revenue slug fallbacks** — MakerDAO tries [makerdao, maker, sky]
9. **CoinGecko ID mappings** — Canonical mapping for 20+ major tokens

## Known Limitations

1. **Price accuracy (47.8%)** — Most failures are small tokens without CoinGecko data. DeFiLlama coins fallback helps but many tokens are simply not indexed anywhere.
2. **Revenue near-zero protocols** — WBTC, Tether Gold, Lombard LBTC have negligible revenue. Agent returns flat/zero which doesn't match DeFiLlama's tiny non-zero values.
3. **Dune private query limit** — Free tier caps private queries. Fixed by setting `is_private: false` in dune-client.ts. Queries are public but auto-archived after execution.
4. **MPP wallet funding** — 500-case benchmark costs ~$95 in Claude API via MPP. Channel deposit is $20.
5. **Intent comparison (62.5%)** — Multi-protocol comparisons sometimes miss an entity. Prompt tuning can improve this.

## Cost Model

| Operation | Cost | Time |
|-----------|------|------|
| 50-case benchmark | ~$10 | ~8 min |
| 500-case benchmark | ~$95 | ~80 min |
| Training epoch (5x50 + compound) | ~$55 | ~50 min |
| Protocol crawler | $0 (free APIs) | ~15 min |

## Environment Variables

```
DATABASE_URL=postgresql://...    # Supabase PostgreSQL
DUNE_API_KEY=...                 # Dune Analytics API key
MPP_SERVER_WALLET_KEY=...        # MPP wallet private key (pays for Claude API)
```

## Git Status

Branch: `autoresearch-eval`
5 commits ahead of origin (need `gh auth login` + `git push`)
