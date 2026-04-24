# Sessions — Research Everything Crypto

> The perspective layer for AI-driven crypto research. Every session leaves a trace; tomorrow's research stands on today's.

Sessions is an interactive, iterative research platform powered by AI. It runs deep analysis, builds financial models, generates investment-grade memos, and has conversations that remember your work. It is built around a **compounding knowledge graph** (the "Brain") that gets smarter with every session.

---

## What it does

- **Research sessions** — ask any crypto question and get a multi-round, tool-using analyst response with charts, tables, callouts, and verified numbers.
- **Deterministic chart pipeline** — "show me HYPE ARR vs price last 6 months" routes to a pre-indexed chart generator (not the agent loop) for speed and correctness.
- **Analyst lenses** — eight indexed analysts (TopherGMI, shaundadevens, thiccyth0t, CryptoHayes, AustinBarack, defi_monk, RyanWatkins_, robbiepetersen_) can be invoked as reasoning perspectives via `analyst_perspective`.
- **The Brain** — entities, facts, relationships, preferences, and methodology rules from every session, retrieved via hybrid (vector + text) search for context on future runs.
- **Self-improving benchmark** — a 500+ case benchmark runs the agent, scores it against ground truth, and auto-generates prompt rules on failures. Currently at 89.6% accuracy.
- **Memos (PDF)** — one-click export of a prompt + response as a Bloomberg-style printable memo with a dedicated cover page, static chart snapshots, and clean typography.
- **Library** — saved reports, live charts, and the Brain graph — everything a session produces, searchable.
- **Companies & pipeline** — deal-flow tracking with enrichment, company deep-dives, and reports tied to companies.
- **MPP payments** — all upstream AI (Anthropic, OpenRouter) and data (Allium) traffic goes through [Tempo MPP](https://tempo.xyz) payment channels. No API keys for upstream providers, just a USDC-funded server wallet.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Client (Vite + React + Wouter + TanStack Query + shadcn/ui)        │
│  — sessions, library, companies, admin, memo view                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────────┐
│  Server (Express + TypeScript, ran via tsx in dev)                  │
│  ┌───────────────────────┐  ┌────────────────────────────────────┐  │
│  │  session-research     │  │  Brain (entities, facts, rels)     │  │
│  │  -agent.ts            │◄─┤  brain-retrieval.ts                │  │
│  │  — tool loop, modes   │  │  brain-synthesis.ts                │  │
│  │  — planner reflection │  │  brain-embedding-sync.ts           │  │
│  └─────────┬─────────────┘  └────────────────────────────────────┘  │
│            │                                                        │
│  ┌─────────┴────────┐  ┌─────────────────┐  ┌────────────────────┐  │
│  │ data-agent.ts    │  │ research-planner│  │ analyst-corpus.ts  │  │
│  │ — deterministic  │  │ — sub-questions │  │ — analyst lenses,  │  │
│  │   chart pipeline │  │   + playbooks   │  │   frameworks, RAG  │  │
│  └─────────┬────────┘  └─────────────────┘  └────────────────────┘  │
│            │                                                        │
│  ┌─────────┴─────────────────────────────────────────────────────┐  │
│  │  Upstream clients                                             │  │
│  │  — mpp-client.ts (Anthropic via Tempo MPP)                    │  │
│  │  — openrouter-mpp-client.ts (Kimi, GPT, Gemini via OpenRouter)│  │
│  │  — dune-client, defillama-client, coingecko-ids, allium-client│  │
│  │  — stonks-client, scraper, dune-mcp-client                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────────┐
│  PostgreSQL (Supabase)                                              │
│  — users, conversations, messages (with artifacts)                  │
│  — brain_entities, brain_facts, brain_relationships                 │
│  — system_learnings (auto-generated + manual rules)                 │
│  — benchmark_cases, benchmark_runs, proven_queries                  │
│  — analyst_documents, analyst_chunks, analyst_frameworks            │
│  — companies, reports, research_reports, report_charts              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Local setup

### Prerequisites
- Node 20+
- PostgreSQL (we use Supabase, but any 15+ works — the app expects the `pgvector` extension for embeddings)
- A funded server wallet on Tempo mainnet (for MPP) — only required if you want to actually call Anthropic/OpenRouter

### Install

```bash
git clone https://github.com/polecalmer/ResearchEverything-Crypto.git
cd ResearchEverything-Crypto
npm install
cp .env.example .env
# fill in the .env — see Environment below
npm run db:push     # applies the Drizzle schema to your DB
npm run dev         # starts Express + Vite on http://localhost:5000
```

### Environment

See `.env.example` for the full list. Bare minimum for localhost dev:

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Postgres connection string (Supabase-flavoured). |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `VITE_PRIVY_APP_ID` | Auth (wallet + email via Privy). |
| `MPP_SERVER_WALLET_KEY` | Hex private key of the on-chain wallet that pays Anthropic/OpenRouter/Allium via Tempo MPP. Needs ~$20+ USDC on Tempo. |
| `DUNE_API_KEY`, `DEFILLAMA_PRO_API_KEY`, `STONKS_API_KEY`, `VOYAGE_API_KEY` | Direct-billed data + embeddings APIs. |
| `TELEGRAM_BOT_TOKEN` | Optional; leave blank on localhost. |
| `DEEP_RESEARCH_PARALLEL=0` | 1 = fan out deep sub-questions in parallel (faster, higher spend). Keep 0 on localhost. |
| `ENABLE_STRIPE=0` | 1 = init Stripe on startup. 0 = skip entirely. |
| `MPP_NO_STREAMING=0` | 1 = non-streaming Anthropic path (useful on flaky networks). |

---

## Notable subsystems

### The agent loop (`server/session-research-agent.ts`)
Routes the user's message through one of three modes:

- **Quick** — 3 tool rounds, Sonnet, short answer, ~$5 spend cap.
- **Focused** — 4-10 rounds, adaptive spend, good default for most questions.
- **Deep** — up to 20 rounds, Sonnet for routine rounds and Opus for reflection/wrap-up, decomposed into sub-questions by `research-planner.ts`, optionally fanned out in parallel.

Tools available: `search_proven_queries`, `execute_dune_sql`, `discover_dune_tables`, `query_defillama_*`, `query_yield_pools`, `query_stablecoins`, `query_chain_tvl`, `get_token_snapshot`, `compare_protocols`, `execute_code` (pandas in sandbox), `query_analyst_corpus`, `query_analyst_frameworks`, `analyst_perspective`, `update_research_brain`, Anthropic's hosted `web_search`.

Hard style rules live in `BASE_PROMPT` — e.g. no em dashes in output, no hallucinated numbers, every figure must be traceable to a tool call or a verified Brain fact.

### The Brain (`server/brain-*.ts`)
A knowledge graph scoped per user, with:
- **Entities** (protocols, tokens, companies) with categories, summaries, research counts.
- **Facts** (topic, text, date, source, confidence), embedded via Voyage, searchable via hybrid RRF.
- **Relationships** between entities.
- **Methodology rules** — global `synthesis_discipline` rules surfaced at the top of context on every run (e.g. "for peer comparison tables, every numeric cell must come from its own fetch; never fill peer rows from training knowledge").

### The deterministic chart pipeline (`server/data-agent.ts`)
Detects chart-intent messages via regex (`CHART_INTENT_PATTERNS`), extracts protocol + metric + time range + variants via a small LLM call, then builds the chart from pre-catalogued recipes (proven queries, DeFiLlama endpoints, Dune tables) with no agent loop. Much faster and more accurate than routing to the agent.

### The benchmark (`server/benchmark/`)
CLI harness that runs 900+ test cases, scores against ground-truth (magnitude 40%, trend 20%, shape 40%), analyses failures, and can auto-generate `system_learnings` rules to fix recurring failures. Used to iterate on the prompt + recipes until stability.

```bash
# Standard benchmark
npx tsx server/benchmark/cli.ts run --subset 50 --verbose

# Full ecosystem (500 cases)
npx tsx server/benchmark/cli.ts run --all

# Training loop (auto-apply improvements)
npx tsx server/benchmark/train.ts
```

### MPP (`server/mpp-client.ts`, `server/openrouter-mpp-client.ts`)
Payment-channel client for Tempo MPP. On first call, opens a channel with a ~$35 USDC deposit; subsequent calls are settled via vouchers. Automatically rotates channels on `amount-exceeds-deposit` 402 responses.

- `ANTHROPIC_MPP`: `https://anthropic.mpp.tempo.xyz/v1/messages` (native Anthropic format)
- `OPENROUTER_MPP`: `https://openrouter.mpp.tempo.xyz/v1/chat/completions` (OpenAI format — gives access to Kimi, Mistral, Gemini, GPT-4o, etc.)

`scripts/reclaim-channels.ts` is a standalone utility that force-closes any orphaned channels and reclaims their deposits back to the wallet.

### Memos (`client/src/pages/memo-view.tsx`)
Standalone route at `/memo/:sessionId/:msgId` that renders a single user prompt + assistant response as a Bloomberg-style printable memo. Auto-opens the browser Save-as-PDF dialog with the headline as the filename. Features:
- Cover page (masthead, kicker, headline, deck, byline only)
- Research content starts on page 2
- Live recharts SVGs are snapshotted to static PNG data URLs at 2× DPI on mount, so charts render consistently in the PDF
- All artifact components (`MetricCards`, `InlineTable`, `CalloutBlock`, etc.) are restyled via print CSS for light/serif/Calibri output
- Em-dash / en-dash normalization for existing content

---

## Repository layout

```
client/src/
├── App.tsx                     # Wouter routes
├── pages/
│   ├── session-research.tsx    # Main chat interface
│   ├── library.tsx             # Reports, charts, brain tabs
│   ├── memo-view.tsx           # PDF-ready memo view
│   ├── admin.tsx               # Analytics, wallet, system_learnings
│   ├── companies.tsx           # Deal pipeline
│   └── …
├── components/
│   ├── research-artifacts.tsx  # MarkdownText, InlineChart, MetricCards, ThinkingPanel, MessageBubble
│   └── ui/                     # shadcn/ui primitives
└── lib/
    ├── research-utils.ts       # Artifact types, format helpers, dateTicks logic
    └── queryClient.ts          # TanStack Query setup

server/
├── session-research-agent.ts   # The agent loop (~4000 lines — the main thing)
├── research-planner.ts         # Sub-question decomposition + playbook catalog
├── data-agent.ts               # Deterministic chart pipeline
├── brain-retrieval.ts          # Hybrid-search retrieval + methodology rules
├── brain-synthesis.ts          # LLM summarisation of research into brain updates
├── mpp-client.ts               # Anthropic via Tempo MPP
├── openrouter-mpp-client.ts    # OpenRouter via Tempo MPP
├── analyst-corpus.ts           # Analyst RAG
├── data-source-brain/          # Fact-level metadata about data sources
├── benchmark/                  # Eval harness + self-improving loop
└── routes/                     # Express route modules

shared/
└── schema.ts                   # Drizzle schema (single source of truth for all tables)

scripts/
├── reclaim-channels.ts         # Force-close orphaned MPP channels
└── …

data/
└── research-planner/
    ├── question_types.json     # Classification taxonomy for the planner
    └── playbooks.json          # Multi-step research playbooks
```

---

## License

MIT.
