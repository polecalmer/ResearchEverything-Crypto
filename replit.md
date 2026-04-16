# Research Everything

## Overview

Research Everything (researcheverything.xyz) is a deal pipeline management and research intelligence dashboard for venture capitalists (VCs). It aims to streamline the process of sourcing, evaluating, and managing potential investments by combining a web application with a Chrome extension. The platform transforms web links into structured deal intelligence, offering tools for efficient deal flow management, AI-powered enrichment, token analytics, and comprehensive reporting. Its vision is to empower VCs with an intelligent system to manage their deal pipeline from discovery to investment, leveraging AI to reduce manual effort and improve decision-making.

Key capabilities include:
- Automatic deal creation and enrichment from web links.
- Customizable pipeline management.
- AI-driven research, fact-checking, and "Next Steps" recommendations.
- Detailed company profiles and funding history.
- Integrated payment system for AI services and platform fees.
- Deep research report generation for due diligence.
- Telegram bot integration for deal sourcing.

## User Preferences

I prefer iterative development with clear communication on progress and any potential roadblocks.
Ask before making major architectural changes or introducing new dependencies.
I prefer detailed explanations for complex technical decisions.
Ensure code is well-documented and follows best practices.
Focus on user experience and intuitive design.

## System Architecture

**Frontend:** Built with React, TypeScript, and Vite, utilizing `shadcn/ui` for components, `TanStack Query` for data fetching, and `wouter` for routing. Styling uses Tailwind CSS with a dark-first, crypto-native aesthetic.

**Backend:** An Express.js API server orchestrates AI interactions and manages data persistence, configured with CORS for Chrome extension support.

**Database:** PostgreSQL with Drizzle ORM for schema and interactions.

**Authentication:** Privy-based authentication with embedded Tempo wallets (chain ID 4217), supporting email or external wallet sign-in. All API routes are protected with Privy access token verification.

**Data Model:** Core entities include Users, Companies, Founders, Notes, Transactions, Token Profiles, Dune Queries, and Token Analyses, structuring comprehensive deal and research data.

**Pipeline Stages:** Deals progress through `Discovered -> Researching -> Reaching Out -> In Diligence -> Passed / Invested`.

**AI Enrichment Pipeline:** A multi-step process for deal card generation, including web scraping, company identification, token identification (with contract address finder/verifier), comprehensive research, fact-checking, and due diligence reads. AI agents utilize Claude Opus 4.6 with web search capabilities.

**Standalone Liquid Token Research:** Deep token analysis (supply, valuation, liquidity, value accrual, risk flags) runs as an asynchronous background job via a multi-turn AI agent, saving results to company profiles and a dedicated table.

**Deep Research Reports:** Generated using a multi-turn AI approach, focusing on company, team, market, competition, and risk analysis, synthesized into a final report. These also run as asynchronous background tasks.

**AI Next Steps Advisor:** A two-stage agent (Generator and Verifier) provides actionable and validated recommendations based on deal context.

**UI/UX:** Features a consistent design with dark backgrounds, subtle borders, monospace fonts, and a green accent color. The dashboard provides pipeline visualization, company lists, detailed company views, and pages for wallet management, credit purchasing, and analytics. Real-time AI enrichment progress is displayed via Server-Sent Events (SSE).

**Payment Architecture:** A server wallet (`0x8518b315b3DFC4415Be7E75b2571Df635b27552a`) pays Anthropic for AI services via Tempo MPP (USDC.e). On-chain cost tracking queries Transfer events to compute real costs (protocol fees to 0xfeEC). The `response.cumulative` field from MPP is NOT the actual settled cost — it represents off-chain voucher amounts that may never be claimed. Real cost = Total Funded - Current Balance. Admin page has an "On-Chain Cost Report" panel. Deep research reports and token analyses run as background tasks to avoid timeouts, with client-side polling for status updates.

**Token Intelligence Dashboard:** Includes token profile management, real-time token snapshots, and an integrated Dune Analytics query manager. This allows users to add, browse, auto-attach, and visualize pre-built Dune queries. An AI token analysis agent synthesizes data from user-attached Dune queries and token snapshots.

**Data Tab (AI Chart Dashboard):** Provides a chat-driven interface for generating custom charts. The Data Agent (Opus 4.6) selects data sources (Dune Analytics, DeFiLlama, CoinGecko, Allium), fetches data, and creates interactive Recharts visualizations. It features a self-learning query system with retry loops, query memory for proven queries, data sanity checks, intelligent data source routing, and prompt evolution based on learned rules from failures.

**Session Research (Conversational AI):** A chat-based research interface at `/research` where users ask natural language questions about DeFi protocols and receive inline charts, tables, metric cards, and analysis. Powered by Claude Opus 4 with extended thinking (10K thinking budget) via a ReAct agent (`server/session-research-agent.ts`) with 16 tools: DefiLlama (TVL/fees/revenue/volume/price/summary/yields/stablecoins/chain TVL), list/compare protocols, Dune SQL + table discovery, Allium token snapshots, execute_code (sandboxed JS for financial modeling), Anthropic web_search, and `update_research_brain` (agent-driven knowledge graph recording). Up to 15 tool rounds per query. Conversations are persisted with session management (create/list/delete). Frontend parses structured `artifact:chart`, `artifact:table`, and `artifact:metric_cards` blocks from agent responses and renders them inline using Recharts (including ComposedChart with dual Y-axes for mixed-unit series). Routes: `/api/research/sessions` (CRUD), `/api/research/sessions/:id/messages` (chat). Uses `callAnthropicRaw` via MPP for AI inference.

**Research Brain (Knowledge Graph):** An Obsidian-style persistent knowledge graph at `/brain` that accumulates intelligence across all research sessions. The graph stores typed entities (protocol/token/chain/person/fund/concept) with categories, competitors, tags, and summaries; relationships between entities (competes_with, built_on, invested_in, forked_from, partners_with, related_to); verified facts with provenance tracking (source tool, confidence level, date); and contradiction detection when data changes between sessions. The agent explicitly records findings via the `update_research_brain` tool at the end of each session. Smart context retrieval (`server/brain-retrieval.ts`) uses entity-graph traversal + keyword matching to inject only relevant prior knowledge into each new session prompt, avoiding context pollution. The merge logic in routes handles entity research count tracking, fact deduplication, contradiction detection, and relationship accumulation. The frontend provides an interactive force-directed graph visualization (canvas-based, no external lib) with node colors by entity type, edge rendering for relationships, drag/pan/zoom, and a detail sidebar showing entity info, facts, relationships, and data changes. DB columns: `research_brains` table with entities/knowledge/preferences/relationships/contradictions/meta JSONB columns. API: `GET /api/brain/graph`.

**Admin Wallet Management:** An admin panel for managing the server wallet's USDC.e balance, discovering on-chain MPP payment channels, and allowing channel closure or withdrawal.

**Chrome Extension:** A Manifest V3 extension facilitating quick deal capture via a context menu item and content scripts, interacting with the backend API through a background service worker.

## External Dependencies

-   **AI Service:** Anthropic Claude (`claude-opus-4-6`) via Tempo MPP (`anthropic.mpp.tempo.xyz`)
-   **Authentication:** Privy (`@privy-io/node`, `PrivyProvider`, `usePrivy`)
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Payments:** Stripe (for subscriptions and credit purchases)
-   **Blockchain/Wallet:** Tempo chain (chain ID 4217) for embedded wallets and USDC transactions.
-   **DeFiLlama API:** Public API for protocol data (TVL, fees, revenue) and coin price history.
-   **Dune Analytics:** On-chain data queries via API.
-   **Allium API:** On-chain analytics (real-time prices, wallet balances, Explorer SQL) via CLI, authenticated with Tempo wallet.
-   **Telegram Bot Framework:** Grammy