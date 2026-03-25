# Research Everything

## Overview

Research Everything (researcheverything.xyz) is a deal pipeline management and research intelligence dashboard for venture capitalists (VCs), designed to streamline the process of sourcing, evaluating, and managing potential investments. It combines a web application with a companion Chrome extension to transform any web link into structured deal intelligence. The platform aims to provide VCs with tools for efficient deal flow management, AI-powered enrichment, token analytics, and comprehensive reporting.

Key capabilities include:
- Right-click capture of web links for automatic deal creation and enrichment.
- Lightweight pipeline management with customizable stages.
- AI-driven research, fact-checking, and "Next Steps" recommendations.
- Detailed company profiles including founders, notes, and funding history.
- Integrated payment system for AI services and platform fees.
- Deep research report generation for in-depth due diligence.
- Telegram bot integration for quick deal sourcing.

The vision is to empower VCs with a seamless and intelligent system to manage their deal pipeline, from initial discovery to investment, leveraging AI to reduce manual effort and improve decision-making.

## User Preferences

I prefer iterative development with clear communication on progress and any potential roadblocks.
Ask before making major architectural changes or introducing new dependencies.
I prefer detailed explanations for complex technical decisions.
Ensure code is well-documented and follows best practices.
Focus on user experience and intuitive design.

## System Architecture

**Frontend:** Developed with React, TypeScript, and Vite. It utilizes `shadcn/ui` for UI components, `TanStack Query` for data fetching, and `wouter` for routing. The styling is managed with Tailwind CSS, featuring a dark-first, crypto-native aesthetic inspired by Tempo explorer.

**Backend:** An Express.js API server, configured with CORS to support the Chrome extension. It primarily acts as an orchestrator for AI interactions and manages data persistence.

**Database:** PostgreSQL is used for data storage, with Drizzle ORM managing database interactions and schema.

**Authentication:** Privy-based authentication with embedded Tempo wallets. Users can sign in via email or external wallet, with an embedded Tempo wallet (chain ID 4217) automatically created. All API routes are protected using Privy access token verification.

**Data Model:**
- **Users:** Stores user authentication details, wallet information, and credit balance.
- **Companies:** Core deal entities, including name, description, sector, stage, funding history, URLs, pipeline stage, and AI-generated scores/reasons.
- **Founders:** Linked to companies, capturing founder details and social links.
- **Notes:** Time-stamped notes associated with companies.
- **Transactions:** Logs all payment activities, including AI service costs and platform fees.
- **Token Profiles:** On-chain token data linked to companies (contract address, chain, ticker symbol).
- **Dune Queries:** Saved Dune Analytics query configurations per company (query ID, label, visualization type).
- **Token Analyses:** AI-generated on-chain intelligence reports per company (background job pattern, polls every 5s).

**Pipeline Stages:** `Discovered -> Researching -> Reaching Out -> In Diligence -> Passed / Invested`

**AI Enrichment Pipeline (6 visible steps, up to 8 internal):**
1.  **Web Scraper:** Fetches content from URLs.
2.  **Identifier Agent:** Identifies the company from input and scraped data.
3.  **Token Identifier Agent:** Detects if the project has a liquid token. Classifies into Tier 0-3 using the liquid token analysis framework (Tier 0: Monetary Premium, Tier 1: Great, Tier 2: Average, Tier 3: Bad).
    - **3a. Contract Address Finder (conditional):** When a liquid token is detected, searches CoinGecko/CoinMarketCap/block explorers for ALL contract addresses across chains (native, wrapped, bridged).
    - **3b. Contract Address Verifier (conditional):** Verifies candidate addresses, checks on-chain existence and liquidity, selects the PRIMARY address (highest volume chain, prefers EVM).
4.  **Research Agent:** Builds a comprehensive deal card (VC research runs for ALL projects).
5.  **Verify & Clean Agent:** Combines fact-checking and hallucination firewall, stripping unverified data.
6.  **Due Diligence Reads Agent:** Finds 4-5 critical adjacent reads (research papers, whitepapers, regulatory docs, market analyses) relevant to the investment thesis. Stored as JSON in `adjacentReads` column.
All AI agents use Claude Opus 4.6 with web search capabilities. Liquid token projects get a "Liquid Token" tag and stage automatically. Token profiles are auto-populated when a liquid token is detected (no longer requires a contract address — works for L1-native tokens). The liquid token analysis framework is stored in `server/skills/liquid-token-analysis.md`. The contract finder/verifier sub-steps use the standard enrichment MPP tier ($0.50 maxDeposit) and appear as sub-items under step 2 in the pipeline UI.

**Standalone Liquid Token Research:** The deep token analysis (supply, valuation, liquidity, value accrual, risk flags) runs as a standalone background job via the "Generate AI Token Analysis" button on the Token Intelligence tab. Uses `server/token-agent.ts` with multi-turn approach (3 sequential calls: market data research → valuation & risk research → synthesis). Runs as an async background task (same pattern as deep research reports) to avoid gateway timeouts. Results saved to both `token_analyses` table and `liquidTokenAnalysis` column on the company.

**Deep Research Reports:** Also use multi-turn approach (3 sequential calls: company/team/market research → competition/risk research → synthesis into final report). Each call stays under ~90s to avoid MPP proxy gateway timeouts.

**AI Next Steps Advisor (2 Stages):**
1.  **Generator Agent:** Analyzes deal context to produce actionable recommendations.
2.  **Verifier Agent:** Validates recommendations for accuracy and relevance.

**UI/UX:** The application features a consistent design language with near-black backgrounds, subtle borders, monospace fonts for addresses/amounts, and a green accent color. The dashboard provides pipeline visualization, company lists, detailed company views, and dedicated pages for wallet management, credit purchasing, and analytics. Real-time SSE (Server-Sent Events) are used to display AI enrichment progress.

**Payment Architecture (Server Wallet):**
1.  **Server wallet → Anthropic (AI cost):** Server wallet (`0x8518b315b3DFC4415Be7E75b2571Df635b27552a`) pays Anthropic via mppx with Tempo payment method. **Single shared channel** with $5 deposit for ALL AI features (enrichment, deep research, token analysis, data charts, next-steps). Channel persists across requests; only destroyed on channel-specific errors (insufficient balance, expired, closed). Real MPP costs captured from `onChallenge` callback and tracked per session.
2.  **User → Owner wallet (platform fee):** MPP paywalls on backend `prepare` endpoints charge a platform fee before AI sessions start. Owner wallet: `0x342fFFBcEbb761bC2c7B512333AF5E397b4cB72d`.
3.  **Cost tracking:** Enrichment/next-steps pipelines: mppCost flows client→server via /api/enrich/step. Deep research: runs entirely server-side as background job, mppCost tracked internally. All pipelines apply 1.5x markup for user charge.
4.  **Deep research architecture:** The `/reports/prepare` endpoint creates the report record, kicks off the Anthropic call as a background async task, and returns immediately. The client polls report status every 5s until complete. No HTTP timeout issues since the long AI call runs server-side.

**Token Intelligence Dashboard:**
Company detail pages feature four tabs: "Project Intelligence" (deal content), "Token Intelligence" (profiles, snapshots, Dune queries), "Research Report" (full-page AI analysis, liquid-token companies only), and "Data" (AI-powered chart dashboard). The Token Intelligence tab includes:
- Token profile management (contract address, chain, ticker)
- Token snapshot card (price, market cap, 24h volume, holder count, price change) via Allium MPP (with CoinGecko fallback)
- Master Dune Query Library (`master_dune_queries` table) — centralized catalog of all Dune queries with protocol/chain tags, categories, descriptions. Synced from external database via `/api/master-dune-queries/sync` endpoint. Queries auto-attach to relevant companies based on tag matching when token profiles are created, or manually via "From Library" browser or auto-attach button.
- Dune Analytics query manager (add pre-built queries by ID, browse from master library, auto-attach by protocol/chain tags, visualize as bar/line/area/table via Recharts)
- AI token analysis agent with query selection logic (background job, same pattern as deep research — server runs async, client polls). Agent selects relevant Dune queries from user's attached set, fetches token snapshot, and produces structured analysis.
- MPP paywall (user→owner): $0.50 flat fee on any AI feature
- MPP shared channel (server→Anthropic): single $5 deposit channel for all AI features; channel stats visible in admin analytics

**Data Tab (AI Chart Dashboard):**
The Data tab provides a chat-driven interface for building custom charts. Users describe what they want (e.g. "HYPE price vs revenue 90D"), and the Data Agent (Opus 4.6) determines the best data source, fetches data, and creates interactive Recharts visualizations. Supports:
- Data sources: Dune Analytics saved queries (by ID), Dune SQL (agent writes raw DuneSQL/Trino queries on the fly — the most powerful source for custom on-chain analytics, any protocol, any time range), DeFiLlama (TVL, fees, revenue), CoinGecko (price history via DeFiLlama coins API), Allium (real-time snapshots), Allium Prices (on-chain OHLCV price history), Allium SQL (custom on-chain analytics — holder distribution, balance queries across 150+ chains)
- Chart types: line, bar, area, composed (multi-axis overlays)
- Each chart is saved to `dashboard_charts` table with its data source config, so users can refresh for updated data anytime
- Agent can create single or multiple charts from one request
- **Self-learning query system:** The Data Agent uses a closed feedback loop inspired by autoresearch:
  - **Retry loop (Layer 1):** When a Dune SQL query fails or returns bad data, the error/sample is fed back to the LLM, which rewrites the query. Up to 2 retries before falling back to other sources.
  - **Query memory (Layer 2):** When a dune-sql query succeeds and passes sanity checks, it's saved to `proven_queries` table with protocol + metric type. On future requests, the system checks for a proven query first — skipping LLM generation entirely. Queries accumulate success counts; queries that fail 3 times are deactivated.
  - **Data sanity checker:** All chart data goes through `checkDataSanity()` which catches all-zero datasets, raw wei values (>1e15), and majority-negative currency values.
  - **Data source routing:** DeFiLlama is preferred for aggregate metrics (revenue, fees, TVL, volume). Dune SQL is used only for metrics DeFiLlama doesn't cover (lending, user counts, custom analytics).
- Key files: `server/data-agent.ts`, `server/defillama-client.ts`, `client/src/pages/data-tab.tsx`

Key files: `server/dune-client.ts`, `server/token-agent.ts`, `server/allium-client.ts`, `client/src/pages/token-intelligence.tsx`

**Admin Wallet Management:**
The admin page includes a Server Wallet panel (`server/wallet-manager.ts`) that shows USDC.e balance, discovers on-chain MPP payment channels via `ChannelOpened` events from the escrow contract, and allows closing/withdrawing channels. Uses the same Tempo fee-payer transaction pattern as mppx internally: `prepareTransactionRequest` → `signTransaction` → `sendRawTransactionSync`. Channel discovery is incrementally cached — only scans new blocks after the last scan. API routes: `/api/admin/wallet`, `/api/admin/wallet/close-all`, `/api/admin/wallet/channel/:id/close`, `/api/admin/wallet/channel/:id/withdraw`.

**Chrome Extension:** Manifest V3 extension facilitating quick capture. It creates a context menu item, injects content scripts for UI, and uses a background service worker to interact with the backend API.

## External Dependencies

-   **AI Service:** Anthropic Claude (`claude-opus-4-6`) via Tempo MPP (`anthropic.mpp.tempo.xyz`)
-   **Authentication:** Privy (`@privy-io/node` for backend, `PrivyProvider`/`usePrivy` for frontend)
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Payments:** Stripe (for subscriptions and one-time credit purchases)
-   **Blockchain/Wallet:** Tempo chain (chain ID 4217) for embedded wallets and USDC for transactions. Tempo MPP skill reference at `server/skills/tempo-mpp.md`.
-   **DeFiLlama API:** Free public API for protocol TVL, fees, revenue, and coin price history
-   **Dune Analytics:** On-chain data queries via API key (`DUNE_API_KEY`)
-   **Allium API:** On-chain analytics via CLI (`allium` installed at `~/.local/share/../bin/allium`). Authenticated with Tempo wallet (chain-id 4217, uses `MPP_SERVER_WALLET_KEY`). Endpoints: realtime prices, wallet balances, Explorer SQL for custom analytics. Costs: $0.01-0.03 per call, paid from server wallet PathUSD.
-   **Telegram Bot Framework:** Grammy

## Skill Files
- `server/skills/liquid-token-analysis.md` — Liquid token analysis framework (tier classification, supply analysis, valuation models, risk flags)
- `server/skills/tempo-mpp.md` — Tempo MPP builder skill (channel management, wallet ops, client/server patterns, testing)