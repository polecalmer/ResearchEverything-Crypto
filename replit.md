# BookMark

## Overview

BookMark is a deal pipeline management dashboard for venture capitalists (VCs), designed to streamline the process of sourcing, evaluating, and managing potential investments. It combines a web application with a companion Chrome extension to transform any web link into structured deal intelligence. The platform aims to provide VCs with tools for efficient deal flow management, AI-powered enrichment, and comprehensive reporting.

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

**Pipeline Stages:** `Discovered -> Researching -> Reaching Out -> In Diligence -> Passed / Invested`

**AI Enrichment Pipeline (4 Steps):**
1.  **Web Scraper:** Fetches content from URLs.
2.  **Identifier Agent:** Identifies the company from input and scraped data.
3.  **Research Agent:** Builds a comprehensive deal card.
4.  **Verify & Clean Agent:** Combines fact-checking and hallucination firewall, stripping unverified data.
All AI agents (Identifier, Research, Verify & Clean) use Claude Opus 4.6 with web search capabilities.

**AI Next Steps Advisor (2 Stages):**
1.  **Generator Agent:** Analyzes deal context to produce actionable recommendations.
2.  **Verifier Agent:** Validates recommendations for accuracy and relevance.

**UI/UX:** The application features a consistent design language with near-black backgrounds, subtle borders, monospace fonts for addresses/amounts, and a green accent color. The dashboard provides pipeline visualization, company lists, detailed company views, and dedicated pages for wallet management, credit purchasing, and analytics. Real-time SSE (Server-Sent Events) are used to display AI enrichment progress.

**Payment Architecture (Dual System):**
1.  **User → Anthropic (AI cost):** User's Privy wallet directly pays Anthropic via `anthropic.mpp.tempo.xyz` using mppx-polyfilled fetch in the client.
2.  **User → Owner wallet (platform fee):** MPP paywalls on backend `prepare` endpoints charge a platform fee before AI sessions start.

**Chrome Extension:** Manifest V3 extension facilitating quick capture. It creates a context menu item, injects content scripts for UI, and uses a background service worker to interact with the backend API.

## External Dependencies

-   **AI Service:** Anthropic Claude (`claude-opus-4-6`) via Tempo MPP (`anthropic.mpp.tempo.xyz`)
-   **Authentication:** Privy (`@privy-io/node` for backend, `PrivyProvider`/`usePrivy` for frontend)
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Payments:** Stripe (for subscriptions and one-time credit purchases)
-   **Blockchain/Wallet:** Tempo chain (chain ID 4217) for embedded wallets and USDC for transactions.
-   **Telegram Bot Framework:** Grammy