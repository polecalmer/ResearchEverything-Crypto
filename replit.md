# Research Everything

## Overview

Research Everything (researcheverything.xyz) is a deal pipeline management and research intelligence dashboard for venture capitalists (VCs). It streamlines the sourcing, evaluation, and management of potential investments by transforming web links into structured deal intelligence. The platform offers efficient deal flow management, AI-powered enrichment, token analytics, and comprehensive reporting. Its vision is to empower VCs with an intelligent system for managing their deal pipeline, leveraging AI to reduce manual effort and improve decision-making.

Key capabilities include:
- Automatic deal creation and enrichment from web links.
- Customizable pipeline management.
- AI-driven research, fact-checking, and "Next Steps" recommendations.
- Detailed company profiles and funding history.
- Integrated payment system for AI services.
- Deep research report generation.
- Telegram bot integration for deal sourcing.

## User Preferences

I prefer iterative development with clear communication on progress and any potential roadblocks.
Ask before making major architectural changes or introducing new dependencies.
I prefer detailed explanations for complex technical decisions.
Ensure code is well-documented and follows best practices.
Focus on user experience and intuitive design.

## System Architecture

**Frontend:** Developed with React, TypeScript, and Vite, utilizing `shadcn/ui` for components, `TanStack Query` for data fetching, and `wouter` for routing. Styling is managed with Tailwind CSS, featuring a dark-first, crypto-native aesthetic.

**Backend:** An Express.js API server, configured with CORS, orchestrates AI interactions and manages data persistence.

**Database:** PostgreSQL with Drizzle ORM for data storage and schema management.

**Authentication:** Privy-based authentication with embedded Tempo wallets. Users can sign in via email or external wallet, with an embedded Tempo wallet (chain ID 4217) automatically created. All API routes are protected using Privy access token verification.

**Data Model:** Core entities include Users, Companies, Founders, Notes, Transactions, Token Profiles, Dune Queries, and Token Analyses, designed to support comprehensive deal and token intelligence.

**Pipeline Stages:** Configurable pipeline stages from `Discovered` to `Invested / Passed`.

**AI Enrichment Pipeline:** A multi-step process involving web scraping, company identification, token identification (including contract address finding and verification), comprehensive research, fact-checking, and identification of critical adjacent reads. All AI agents use Claude Opus 4.6 with web search.

**Standalone Liquid Token Research:** Deep token analysis runs as an asynchronous background job, using a multi-turn AI approach for market data, valuation, risk research, and synthesis.

**Deep Research Reports:** Generated via a multi-turn AI approach, focusing on company, team, market, competition, and risk research, synthesized into a final report. Reports support in-place AI editing — users can highlight a section, provide their own insight, and have Claude Opus 4.6 rewrite that section with the new context. Edits cost $0.50 per section via MPP paywall.

**AI Next Steps Advisor:** Generates and validates actionable recommendations based on deal context.

**UI/UX:** Features a consistent dark design with green accents, providing pipeline visualization, company lists, detailed views, wallet management, and analytics. Server-Sent Events (SSE) display AI enrichment progress in real-time.

**Payment Architecture:** Utilizes a server wallet for AI service payments to Anthropic via Tempo MPP, and an MPP paywall for platform fees charged to users. Costs are tracked internally with a markup applied to user charges. Long-running AI tasks are handled as async background jobs to prevent timeouts.

**Token Intelligence Dashboard:** Includes token profile management, real-time token snapshots, integration with a Master Dune Query Library, and an AI token analysis agent. Features a $0.50 paywall for AI features.

**Data Tab (AI Chart Dashboard):** A chat-driven interface for building custom charts. The Data Agent (Opus 4.6) determines data sources (Dune Analytics, DeFiLlama, CoinGecko, Allium, StonksOnChain), fetches data, and creates interactive visualizations. It incorporates a self-learning query system with retry loops, query memory, data sanity checks, and prompt evolution based on failures and successes to continuously improve accuracy and efficiency.

**NLP-Driven Modelling Tab:** A financial modelling workspace powered by Opus 4.6 acting as a quantitative analyst. Users describe what they want to model in natural language (e.g., "Build a DCF with 3-year projections", "Comparable analysis vs sector"), and the AI generates structured financial models with assumptions, projection tables, key metrics, scenario analysis (bull/base/bear), and analytical commentary. Models leverage full company context — research reports, data charts, token intelligence, and company metadata. $0.50 per model via MPP paywall. Stored in the `financial_models` table with validate-first pattern.

**Master Reports:** A block-based report composition workspace. Users create master reports and compose them from multiple block types: free-text/markdown, referenced deep research reports, referenced financial models, referenced dashboard charts, and tables. Blocks can be reordered via up/down controls. Reports can be exported as Markdown. Free to create (no paywall). Data model: `master_reports` (id, userId, title, timestamps) and `master_report_blocks` (id, masterReportId, blockType, content, referenceId, displayOrder). All block mutations enforce ownership — blocks must belong to the report, and referenced entities must belong to the user.

**Admin Wallet Management:** An admin panel for managing the server wallet, discovering payment channels, and allowing channel closure/withdrawal.

**Chrome Extension:** A Manifest V3 extension for quick capture of web links, utilizing context menus, content scripts, and a background service worker to interact with the backend API.

## External Dependencies

-   **AI Service:** Anthropic Claude (`claude-opus-4-6`) via Tempo MPP (`anthropic.mpp.tempo.xyz`)
-   **Authentication:** Privy (`@privy-io/node`, `PrivyProvider`/`usePrivy`)
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Payments:** Stripe
-   **Blockchain/Wallet:** Tempo chain (chain ID 4217), USDC
-   **DeFiLlama API:** For protocol TVL, fees, revenue, and coin price history
-   **Dune Analytics:** On-chain data queries via API key
-   **StonksOnChain API:** For Hyperliquid HIP-3 fee analytics
-   **Allium API:** For on-chain analytics (real-time prices, wallet balances, Explorer SQL)
-   **Telegram Bot Framework:** Grammy