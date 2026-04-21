# Sessions

## Overview

Sessions is an AI research platform designed for crypto researchers to centralize and enhance knowledge across various crypto projects, tokens, and protocols. It transforms diverse inputs into structured research intelligence, offering in-depth analysis, financial modeling, on-chain data visualization, and conversational AI agents with persistent memory. The platform aims to learn and improve with use, making the research suite progressively smarter.

Key capabilities include automated deal creation, customizable research pipeline management, AI-driven research and fact-checking, detailed company profiles, integrated payment systems, deep research report generation, Telegram bot integration for deal sourcing, and a persistent knowledge graph ("Research Brain").

## User Preferences

I prefer iterative development with clear communication on progress and any potential roadblocks.
Ask before making major architectural changes or introducing new dependencies.
I prefer detailed explanations for complex technical decisions.
Ensure code is well-documented and follows best practices.
Focus on user experience and intuitive design.

## System Architecture

**Frontend:** Built with React, TypeScript, and Vite, utilizing `shadcn/ui` for components, `TanStack Query` for data management, and `wouter` for routing. Styling is handled with Tailwind CSS, featuring a dark-first, crypto-native aesthetic. Real-time AI enrichment progress is communicated via Server-Sent Events (SSE).

**Backend:** An Express.js API server manages AI interactions and data persistence, configured with CORS for Chrome extension compatibility.

**Database:** PostgreSQL is used for data storage, with Drizzle ORM managing schema and interactions.

**Authentication:** Privy-based authentication secures the platform, supporting email or external wallet sign-in via embedded Tempo wallets (chain ID 4217). All API routes require Privy access token verification.

**Data Model:** Core entities include Users, Companies, Founders, Notes, Transactions, Token Profiles, Dune Queries, and Token Analyses, structuring deal and research data. Deals progress through predefined stages: `Discovered -> Researching -> Reaching Out -> In Diligence -> Passed / Invested`.

**AI Enrichment Pipeline:** A multi-step process for deal card generation, involving web scraping, company/token identification, comprehensive research, fact-checking, and due diligence. AI agents primarily use Claude Opus 4.7 with web search, employing streaming API calls for long-running sessions.

**Standalone Liquid Token Research & Deep Research Reports:** Provides in-depth token analysis and comprehensive research reports, both processed asynchronously by multi-turn AI agents.

**AI Next Steps Advisor:** A two-stage AI agent (Generator and Verifier) provides actionable recommendations based on deal context.

**Sessions (Conversational AI):** This serves as the unified research surface, with a **Research/Data mode toggle**. Research mode uses a full research agent with multi-round tool use and brain context. Data mode routes to the **Data Agent** for fast chart building, employing proven query lookup, sanity checks, retries, and automatic source fallback.

**Data Agent (Company-Level Charts):** Generates custom charts via Dune SQL, DeFiLlama, CoinGecko, and Allium data sources. It features a self-learning query system and semantic coherence checking. Charts can be saved with `RefreshRecipe` for one-click live data refresh, organized into Reports, and viewed in the Data Station.

**Derived Metric Registry:** Defines `DerivedMetricRecipe` entries for computing metrics like P/E ratio, P/S ratio, and capital efficiency.

**Data Station (`/station`):** A dashboard for all saved charts, allowing organization into named collections and bulk refreshing.

**Financial Models (Model Viewer):** Displays saved financial models from session research in a spreadsheet-style UI. The extraction pipeline parses structured artifacts into typed sections, assumptions, and sources. The viewer supports scenario analysis, CSV download, and Google Sheets export.

**Research Planner:** A Haiku-tier AI planner decomposes user prompts into structured `ResearchPlan`s with typed sub-questions, guiding the Session Research agent.

**Analyst Corpus & Thinking System:** A queryable index of writings and frameworks from crypto analysts. The system integrates this via `analyst_perspective` tools and, in "deep mode," facilitates multi-perspective debate by invoking parallel analyst agents.

**Session Research Resilience:** Implements graceful error handling, recovery wrap-up calls, partial response generation, and context compression for long sessions. Features a "Continue Analysis" UX for interrupted responses.

**Data Source Brain (Self-Learning System):** An intelligent system with feedback loops that learn from proven queries, runtime observations, and system learnings to optimize tool usage and short-circuit known-bad API calls.

**Research Brain (Knowledge Graph):** An Obsidian-style persistent knowledge graph accumulating intelligence across sessions. It stores typed entities, relationships, verified facts with provenance, and detects contradictions. Smart context retrieval uses hybrid search with category peer expansion.

**Chrome Extension:** A Manifest V3 extension for quick deal capture and interaction with the backend API.

## External Dependencies

-   **AI Service:** Anthropic Claude (`claude-opus-4-6`) via Tempo MPP (`anthropic.mpp.tempo.xyz`)
-   **Authentication:** Privy (`@privy-io/node`, `PrivyProvider`, `usePrivy`)
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Payments:** Stripe
-   **Blockchain/Wallet:** Tempo chain (chain ID 4217)
-   **DeFiLlama API**
-   **Dune Analytics API**
-   **Allium API**
-   **Telegram Bot Framework:** Grammy