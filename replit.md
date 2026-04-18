# Sessions

## Overview

Sessions is an AI research platform designed for crypto researchers, both institutional and retail. It centralizes and enhances knowledge across various crypto projects, tokens, and protocols. The platform converts diverse inputs (links, tickers, descriptions) into structured research intelligence, offering in-depth analysis, financial modeling, on-chain data visualization, and conversational AI agents with persistent memory. Its core value proposition is that it learns and improves with use, making the research suite progressively smarter.

Key capabilities include:
- Automated deal creation and enrichment from web links.
- Customizable research pipeline management.
- AI-driven research, fact-checking, and "Next Steps" recommendations.
- Detailed company profiles and funding history.
- Integrated payment system for AI services and platform fees.
- Generation of deep research reports for due diligence.
- Telegram bot integration for deal sourcing.
- Conversational AI for in-depth protocol and token research.
- A persistent knowledge graph ("Research Brain") that accumulates intelligence across sessions.

## User Preferences

I prefer iterative development with clear communication on progress and any potential roadblocks.
Ask before making major architectural changes or introducing new dependencies.
I prefer detailed explanations for complex technical decisions.
Ensure code is well-documented and follows best practices.
Focus on user experience and intuitive design.

## System Architecture

**Frontend:** Developed using React, TypeScript, and Vite, featuring `shadcn/ui` components, `TanStack Query` for data management, and `wouter` for routing. Styling is managed with Tailwind CSS, emphasizing a dark-first, crypto-native aesthetic.

**Backend:** An Express.js API server handles AI interactions, data persistence, and is configured with CORS for Chrome extension compatibility.

**Database:** PostgreSQL is used for data storage, with Drizzle ORM managing schema and interactions.

**Authentication:** Privy-based authentication secures the platform, supporting email or external wallet sign-in via embedded Tempo wallets (chain ID 4217). All API routes require Privy access token verification.

**Data Model:** The system's core entities include Users, Companies, Founders, Notes, Transactions, Token Profiles, Dune Queries, and Token Analyses, forming a comprehensive structure for deal and research data.

**Pipeline Stages:** Deals progress through predefined stages: `Discovered -> Researching -> Reaching Out -> In Diligence -> Passed / Invested`.

**AI Enrichment Pipeline:** This multi-step process for deal card generation includes web scraping, company and token identification (with contract address verification), comprehensive research, fact-checking, and due diligence reads. AI agents primarily utilize Claude Opus 4.6 with web search capabilities.

**Standalone Liquid Token Research:** Provides deep token analysis (supply, valuation, liquidity, value accrual, risk flags) executed asynchronously by a multi-turn AI agent, with results integrated into company profiles.

**Deep Research Reports:** Generated using a multi-turn AI approach, focusing on company, team, market, competition, and risk analysis, synthesized into comprehensive reports. These are also processed as asynchronous background tasks.

**AI Next Steps Advisor:** A two-stage AI agent (Generator and Verifier) provides actionable and validated recommendations based on the current deal context.

**UI/UX:** Adheres to a consistent design featuring dark backgrounds, subtle borders, monospace fonts, and a green accent color. The dashboard offers pipeline visualization, company listings, detailed company views, and dedicated pages for wallet management, credit purchasing, and analytics. Real-time AI enrichment progress is communicated via Server-Sent Events (SSE).

**Payment Architecture:** A server wallet (`0x8518b315b3DFC4415Be7E75b2571Df635b27552a`) pays for Anthropic AI services via Tempo MPP (USDC.e). On-chain cost tracking queries Transfer events. An admin panel supports cost reconciliation and configurable daily cost threshold alerts.

**Token Intelligence Dashboard:** Includes token profile management, real-time token snapshots, and an integrated Dune Analytics query manager for user-added and auto-attached query visualization. An AI token analysis agent synthesizes data from these sources.

**Data Tab (AI Chart Dashboard):** A chat-driven interface allowing users to generate custom charts. The Data Agent (Opus 4.6) selects data sources (Dune Analytics, DeFiLlama, CoinGecko, Allium), fetches data, and creates interactive Recharts visualizations. It features a self-learning query system with retry loops and prompt evolution.

**Session Research (Conversational AI):** A chat-based interface for researching DeFi protocols, providing inline charts, tables, metric cards, and analysis. Powered by a Claude Opus 4 ReAct agent with 16 specialized tools for data retrieval and analysis. Conversations are persisted with session management. Features include: (1) highlight-to-dive-deeper — select any section of assistant output and click "Dive Deeper" to recurse into that specific analysis, (2) "Add to Reports" button on each assistant message to save session output as a viewable report, (3) "Save as Model" button on messages with structured data (tables/charts/metrics) to extract and save as spreadsheet-style financial models, (4) professional presentation with properly sized typography (13px body, 14-18px headers), 300px-tall charts, card-based metric displays, and polished styling throughout.

**Financial Models (Model Viewer):** Saved financial models from session research are displayed at `/models/:id` in a spreadsheet-style UI. The extraction pipeline (`POST /api/research/messages/:msgId/save-as-model`) parses structured artifacts (tables, metric cards, charts, comparisons, callouts) from message content and JSONB artifacts into typed sections, plus extracts assumptions from content patterns and sources from markdown links. The Model Viewer renders tables with numeric alignment and alternating rows, metric card grids, Recharts charts, comparison panels, scenario analysis (bear/base/bull), callouts, assumption lists, and source links. Supports CSV download and Google Sheets export (via CSV download + import instructions). Schema: `financial_models` table with JSONB columns for sections, assumptions, and sources. Key files: `client/src/pages/model-viewer.tsx`, `server/routes.ts` (model CRUD routes), `server/storage.ts` (model storage methods).

**Research Planner:** A Haiku-tier AI planner decomposes user prompts into structured `ResearchPlan`s with typed sub-questions, guiding the Session Research agent. It uses a taxonomy of 9 question types (including `derived-metric-chart` for multi-source computed time-series like P/E ratios) and playbook templates (JSON files), and validates the plan before execution. When the plan includes `derived-metric-chart` or `valuation-ask` types, `execute_code` is unblocked even in focused mode to enable data merging.

**Analyst Corpus:** A queryable index of writings from eight crypto analysts (TopherGMI, shaundadevens, thiccyth0t, CryptoHayes, AustinBarack, defi_monk, RyanWatkins_, robbiepetersen_), integrated as tools for the Session Research agent (`query_analyst_corpus`, `query_analyst_frameworks`, `analyst_perspective`). The corpus consists of 4,372 markdown documents (7,081+ chunks) and extracted reasoning frameworks, stored with Voyage AI embeddings for hybrid retrieval. ANALYST_NAMES and ANALYST_DISPLAY are defined in `shared/schema.ts`. Ingestion script: `scripts/ingest-analyst-corpus.ts`. Source markdown lives in `data/analyst-corpus/{analyst}/content/`.

**Analyst Thinking System:** Enhances analyst integration with three layers:
1.  **Framework Procedures in Plan:** Sub-questions in the research plan trigger Haiku calls to convert analyst frameworks into procedural reasoning steps, injected as `>>> PROCEDURE` directives for the agent.
2.  **`analyst_perspective` Tool:** A new tool that prompts a Haiku sub-call as a specific analyst persona, using their frameworks and corpus chunks to generate structured reasoning traces.
3.  **Multi-Perspective Debate (Deep Mode):** In deep mode, all eight analysts are invoked in parallel after the main agent loop. Their reasoning traces are injected into the final synthesis phase, requiring the agent to integrate, attribute, and reconcile all perspectives.

**Session Research Resilience:** Implements three layers of protection against API failures, including graceful error handling, recovery wrap-up calls, and partial response generation from tool call history. It also features extended backoff for specific errors and context compression for long sessions to prevent timeouts.

**Data Source Brain (Short-Circuit System):** An intelligent system that prevents redundant API calls by short-circuiting requests to tools and protocols known to return no data. It dynamically queries the "Research Brain" for alternative endpoints or tools.

**Research Brain (Knowledge Graph):** An Obsidian-style persistent knowledge graph that accumulates intelligence across all research sessions. It stores typed entities, relationships, verified facts with provenance, and detects contradictions. Smart context retrieval uses hybrid search (Voyage AI embeddings + tsvector keyword matching with Reciprocal Rank Fusion) on normalized `brain_facts` and `brain_entities` tables with HNSW vector indexes and GIN text indexes. Falls back to legacy JSONB keyword matching for users without embedded data. Preferences are always injected regardless of query match. Token budget caps brain context at ~12000 chars. The frontend provides an interactive force-directed graph visualization. Key files: `server/brain-retrieval.ts` (hybrid retrieval), `server/brain-embedding-sync.ts` (sync logic), backfill via `POST /api/admin/brain/backfill-embeddings`.

**Admin Wallet Management:** An admin panel for managing the server wallet's USDC.e balance, discovering on-chain MPP payment channels, and enabling channel closure or withdrawal.

**Chrome Extension:** A Manifest V3 extension for quick deal capture via context menu and content scripts, interacting with the backend API.

## External Dependencies

-   **AI Service:** Anthropic Claude (`claude-opus-4-6`) via Tempo MPP (`anthropic.mpp.tempo.xyz`)
-   **Authentication:** Privy (`@privy-io/node`, `PrivyProvider`, `usePrivy`)
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Payments:** Stripe (for subscriptions and credit purchases)
-   **Blockchain/Wallet:** Tempo chain (chain ID 4217) for embedded wallets and USDC transactions.
-   **DeFiLlama API:** Public API for protocol data and coin price history.
-   **Dune Analytics:** On-chain data queries via API.
-   **Allium API:** On-chain analytics via CLI.
-   **Telegram Bot Framework:** Grammy