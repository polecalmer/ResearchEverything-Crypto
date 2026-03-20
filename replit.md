# BookMark

A deal pipeline management dashboard for VCs with a companion Chrome extension. Turn any link into structured deal intelligence with right-click capture and lightweight pipeline management.

## Architecture

- **Frontend:** React + TypeScript + Vite, with shadcn/ui components, TanStack Query, wouter routing
- **Backend:** Express.js API server with CORS enabled for extension access
- **Database:** PostgreSQL with Drizzle ORM
- **AI:** Anthropic Claude claude-opus-4-6 via Replit AI Integrations (no API key needed) for automatic deal enrichment
- **Extension:** Chrome Manifest V3 extension with context menu, content scripts, and popup
- **Styling:** Tailwind CSS with Inter font, editorial black/white primary color system

## Authentication

Username/password auth with passport-local, express-session, scrypt password hashing. Sessions stored in PostgreSQL via connect-pg-simple.
- `POST /api/register` — create account
- `POST /api/login` — sign in
- `POST /api/logout` — sign out
- `GET /api/user` — current user (401 if not authenticated)
- All `/api/companies`, `/api/enrich`, `/api/founders`, `/api/notes` routes protected with `requireAuth` middleware
- Companies scoped to users via `userId` column
- Orphaned companies (no userId) are auto-assigned to the first user who logs in

Key files: `server/auth.ts` (auth setup + routes), `client/src/hooks/use-auth.tsx` (useAuth hook)

## Data Model

- **Users**: id, username, password (scrypt hashed), credits (integer, default 0), stripeCustomerId
- **Companies**: Core deal entities with userId, name, one-liner, description, sector, business model, stage, funding history, competitive landscape, source URL, website URL, GitHub URL, Twitter URL, LinkedIn URL, pipeline stage, and tags
- **Founders**: Linked to companies with name, role, bio, LinkedIn/Twitter/GitHub/personal URLs, prior companies
- **Notes**: Time-stamped notes attached to companies

## Pipeline Stages

`Discovered -> Researching -> Reaching Out -> In Diligence -> Passed / Invested`

## Pages

- `/` - Landing page (unauthenticated) / Pipeline dashboard (authenticated)
- `/auth` - Login/register page
- `/companies` - Companies list/grid view with search and filters
- `/companies/:id` - Company detail with founders, notes, tags, pipeline management, and dynamic Next Steps advisor
- `/add` - Add new deal form with founder fields
- `/extension` - Browser extension setup instructions
- `/data` - Pipeline analytics: total sourced, deals by stage/sector/model, investment rate, funnel summary

## Chrome Extension (`extension/` folder)

- `manifest.json` - Chrome Manifest V3 config
- `background.js` - Service worker: context menu creation, API calls to dashboard
- `content.js` / `content.css` - Injected into pages: floating confirmation card UI
- `popup.html` / `popup.js` - Extension popup: dashboard URL configuration
- `icons/` - Extension icons

### Extension Flow
1. User right-clicks on any webpage -> "Add to Dealflow"
2. Background script sends URL to `/api/companies/enrich-and-create`
3. AI agent (Claude claude-opus-4-6) researches the company and populates all fields automatically
4. Content script shows floating confirmation card inline (auto-dismisses after 5s)
5. Card links to company detail in dashboard

## Key Files

- `shared/schema.ts` - Database schema and types
- `server/db.ts` - Database connection
- `server/storage.ts` - CRUD operations (DatabaseStorage)
- `server/routes.ts` - REST API endpoints
- `server/enrichment.ts` - AI enrichment service (Claude claude-opus-4-6 via Replit AI Integrations)
- `server/replit_integrations/` - Anthropic AI integration (auto-configured, do not modify)
- `client/src/App.tsx` - Root layout with sidebar
- `client/src/pages/` - All page components
- `client/src/components/` - Reusable components (sidebar, theme toggle, quick capture)

## AI Enrichment (5-Stage Pipeline)

When any input is submitted (URL, company name, tweet, founder profile, blog post, etc.):
0. **Web Scraper** — Detects URLs in input, fetches real page content (meta tags, body text, outbound links). If a social profile links to a company website, scrapes that too. Agents receive this real data instead of guessing blind.
1. **Identifier Agent** — Determines which company is referenced using scraped content + input
2. **Research Agent** — Builds comprehensive deal card using scraped web content as primary source
3. **Fact-Checker Agent** — Cross-checks every claim, flags uncertain/hallucinated info
4. **Hallucination Firewall** — Final pass that strips unverified data, ensures accuracy

Key files: `server/scraper.ts` (web scraper), `server/enrichment.ts` (pipeline orchestrator)

All agents use Claude Opus 4.6 with web search enabled. The Identifier, Research, and Fact-Checker agents can actively search the internet to find and verify real-time information. URLs are domain-validated (linkedin.com, github.com, x.com/twitter.com) via sanitizeUrl() instead of blanket stripping. The Add Deal page shows real-time SSE progress of each stage (scraper + 4 agents). Company detail page shows Links section (Website, GitHub, Twitter/X, LinkedIn) and founder cards show all social links.

Two flows: Quick Capture (one-click enrich + create) and Add Deal page (streaming enrich → review → submit).

## AI Next Steps Advisor (2-Stage Pipeline)

Each deal page has a "Recommended Next Steps" section powered by a 2-stage AI pipeline:
1. **Generator Agent** — Analyzes the full deal context (company data, founders, notes, source URL, pipeline stage, data gaps) and produces 4-6 highly specific, actionable recommendations
2. **Verifier Agent** — Reviews each step against the actual deal data, checking for factual accuracy, hallucinated details, contradictions (e.g., suggesting "find website" when one exists), and stage appropriateness. Rejects invalid steps and annotates verified ones.

Only verified steps are shown, each with a green shield icon and the verifier's assessment note. Results are cached for 5 minutes and automatically regenerate when the pipeline stage changes.

## Enrichment Pipeline (3 Agents)

The enrichment pipeline uses 3 AI agents (down from 4 — Fact-Checker and Firewall were merged into a single Verify & Clean agent):
1. **Identifier Agent** — Resolves company identity from any input (URL, tweet, profile, etc.) with web search
2. **Research Agent** — Deep research to build comprehensive deal card with web search
3. **Verify & Clean Agent** — Combined fact-checking + hallucination firewall in one pass with web search; verifies claims and strips unverified content

Pipeline stages in frontend: Scraper → Identifier → Research → Verify & Clean (total: 4 steps including scraper)

## Credits & Payments (Stripe)

- **Subscription model**: $20/mo (Monthly) or $150/yr (Annual), each includes 33 enrichment credits per billing period
- **Credit packs**: 10 credits ($3.00), 50 credits ($12.00) — buy extra any time
- Stripe Checkout for both subscriptions and one-time payments
- Webhook handles: `checkout.session.completed` (initial sub + credit purchases), `invoice.paid` (subscription renewals), `customer.subscription.updated/deleted` (status changes)
- Credits stored on user record, deducted atomically via SQL `credits > 0` check
- User fields: `credits`, `stripeCustomerId`, `subscriptionStatus`, `subscriptionId`, `subscriptionPeriodEnd`
- Key files: `server/stripeClient.ts`, `server/webhookHandlers.ts`, `server/seed-credits.ts`, `client/src/pages/credits.tsx`
- Subscription products have `metadata.credits_per_period`, credit products have `metadata.credits`
- `/credits` page (Billing) shows subscription status, subscribe/cancel options, and extra credit packs
- Landing page has Pricing section with Monthly/Annual plans and credit pack info

## Deep Research Reports

- "Generate Deep Research Report" button on each company detail page
- Uses Claude Opus 4.6 with extensive web search (up to 20 searches) to produce investment-grade markdown reports
- Reports follow a structured format: Executive Summary, Product Overview, Business Model, Team & Backers, Token/Equity Economics, Competitive Landscape, Key Metrics, Risk Analysis, Investment Considerations, Conclusion
- Reports are stored in the `reports` table and linked to companies
- Report viewer page at `/reports/:id` with markdown rendering and .md download
- Generation is async — the API returns immediately with a reportId, then the agent runs in the background
- Key files: `server/enrichment.ts` (generateDeepResearch function), `client/src/pages/report-viewer.tsx`, `client/src/pages/company-detail.tsx` (DeepResearchSection)

## Telegram Bot

Drop any link or company name into a Telegram chat with the BookMark bot and it auto-enriches and adds to your pipeline.

- Bot uses Grammy (lightweight Telegram bot framework) with long polling
- Users link their BookMark account via `/link username password` command
- Once linked, any text message triggers the AI enrichment pipeline and creates the deal automatically
- Bot replies with company name, one-liner, sector, stage, and founders
- Commands: `/start`, `/link`, `/unlink`, `/status`
- User's `telegramChatId` stored on the users table for account linking
- Key file: `server/telegram.ts`

## API Endpoints

- `POST /api/enrich` - AI enrichment only (requires 1 credit, returns enriched data without saving)
- `POST /api/enrich/stream` - AI enrichment with SSE progress events (requires 1 credit)
- `POST /api/companies/enrich-and-create` - AI enrichment + create company + founders (requires 1 credit)
- `GET /api/credits` - Get current credit balance
- `GET /api/credits/products` - List all products (subscriptions + credit packs) from Stripe
- `POST /api/credits/checkout` - Create Stripe Checkout session (supports mode: "payment" or "subscription")
- `GET /api/subscription` - Get current subscription status
- `POST /api/subscription/cancel` - Cancel subscription at end of billing period
- `GET /api/companies/:id/reports` - List reports for a company
- `POST /api/companies/:id/reports/generate` - Start deep research report generation (async)
- `GET /api/reports/:id` - Get a specific report
- `GET/POST /api/companies` - List/create companies
- `GET/PATCH/DELETE /api/companies/:id` - Read/update/delete company
- `GET /api/companies/:id/next-steps` - AI-generated context-aware next steps with 2-stage pipeline (Generator → Verifier)
- `GET/POST /api/companies/:id/founders` - List/add founders
- `GET/POST /api/companies/:id/notes` - List/add notes
- `DELETE /api/notes/:id` - Delete note

All API endpoints support CORS for cross-origin requests from the browser extension.
