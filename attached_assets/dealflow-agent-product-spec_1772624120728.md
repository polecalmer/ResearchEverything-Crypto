# Dealflow Agent — Product Spec

**One-liner:** A browser extension that turns any link into structured deal intelligence — replacing passive, manual deal sourcing for VCs.

---

## The Problem

VCs encounter potential deals everywhere — a link from a colleague, a tweet, a Product Hunt launch, a YouTube demo, a HackerNews thread. Today, most of these signals die in browser tabs, bookmarks, or Slack messages. The activation energy between "hmm, interesting" and actually having structured context to act on is too high. There's no system that captures deal signals at the point of discovery and automatically builds investable context around them.

Existing tools (Affinity, Harmonic, Crunchbase) address pieces of this, but none of them solve the core friction: **zero-effort capture from any web surface + AI-powered structuring + pipeline management in one flow.**

---

## The Product

A lightweight browser extension with a companion web dashboard.

### Core Interaction: Right-Click → "Add to Dealflow"

The VC right-clicks on any webpage — a company site, a tweet, a LinkedIn profile, a pitch deck PDF, a blog post, a GitHub repo — and selects **"Add to Dealflow"** from the context menu.

A small floating card appears inline (the user never leaves the page):

- 2-3 second loading state while the AI processes the URL
- Confirmation of what the agent understood: **Company Name**, one-liner description, inferred stage
- Optional: quick-assign a pipeline stage or tag via dropdown
- "Edit" link if the agent got something wrong
- Card auto-dismisses after a few seconds

The heavy enrichment happens async in the background. The right-click moment should feel instant and effortless — like bookmarking, but smarter.

**Why right-click is the right trigger:**

- **Intentional.** The user has already made a micro-decision that something is worth capturing. Every pipeline item carries a human signal of interest from day one.
- **Universal.** Works on any web surface without platform-specific scrapers. The AI figures out context from whatever URL it receives.
- **Familiar.** Zero onboarding friction. The entire tutorial is: install extension, right-click, click "Add to Dealflow."

---

## Intelligence Layer

Once a URL is ingested, the agent builds a structured **Company Card** through several enrichment stages:

### 1. Entity Resolution

The agent resolves the URL to an actual company entity. A TechCrunch article, a founder's Twitter thread, a GitHub repo, and the company's landing page should all collapse into the same entity. This prevents duplicates and builds a richer picture as the VC encounters the same company across multiple surfaces (often before they even realize it's the same company).

### 2. Company Card

Structured fields auto-populated by the agent:

| Field | Description |
|---|---|
| **Company Name** | Resolved entity name |
| **One-Liner** | What they do in one sentence |
| **Description** | Longer product/market description |
| **Sector / Vertical** | e.g., AI Infra, Fintech, DevTools, Consumer |
| **Business Model** | SaaS, Marketplace, Infrastructure, Consumer, etc. |
| **Stage (Inferred)** | Pre-seed → Seed → Series A → B → Growth — inferred from team size, funding history, product maturity signals |
| **Funding History** | Known rounds, investors, amounts |
| **Competitive Landscape** | 3-5 comparable or competing companies |
| **Source URL** | Original link that triggered capture |
| **Date Captured** | Timestamp of right-click |

### 3. Founder & Team Enrichment

- Founder names, bios, LinkedIn profiles, Twitter/X handles
- Prior companies and exits
- Public talks, writing, podcasts
- Shared connections (if integrations allow)

**One-Click Outreach:** A "Get in Touch" button that doesn't just surface an email address — it drafts a contextual outreach message referencing something specific about the company or founder's work. Cold email with context converts 5-10x better than generic reach-outs. This is the feature that kills inertia between "interesting" and "in conversation."

### 4. Live Monitoring

Once a company enters the pipeline, the agent tracks public signals on an ongoing basis:

- New job postings (hiring velocity, role types)
- Product launches (Product Hunt, app store updates)
- Press mentions and media coverage
- Funding announcements
- GitHub commit velocity / open-source traction
- Social media traction and follower growth

Surfaced as a feed or weekly digest: *"3 companies in your pipeline had notable activity this week."*

---

## Dashboard / CRM

The dashboard is the companion to the extension. The extension captures; the dashboard manages.

### Pipeline View

Kanban-style pipeline with opinionated default stages:

```
Discovered → Researching → Reaching Out → In Diligence → Passed / Invested
```

Each card shows the company one-liner, stage, sector tags, days in stage, and a signal indicator (green = recent activity, grey = quiet).

### Company Detail View

Full company card with all enriched data, founder profiles, competitive landscape, monitoring feed, notes, and activity log.

### Features

- **Notes & annotations** — add context after calls, meetings, or further research
- **Tagging by thesis area** — e.g., "AI Agents," "Crypto Infra," "Climate," or custom tags
- **Search & filter** — by sector, stage, date captured, tag, signal activity
- **Sharing** — share cards with partners; team-level visibility into shared pipeline
- **Deal attribution** — track who sourced what and when (matters for fund operations)

### Design Principle

Opinionated but lightweight. This is not Salesforce. The dashboard should feel closer to a well-organized reading list than an enterprise CRM. If a VC needs training to use it, it's too complex.

---

## Pattern Layer (Post-MVP)

Once enough deal flow is structured, the agent can surface higher-order insights:

- **Thesis clustering:** "You've saved 6 companies in the AI agent infra space in the past 2 months — here's an auto-generated market map."
- **Connection mapping:** "This founder previously worked at Company X, which is also in your pipeline."
- **Network intelligence:** "Three of your LP contacts follow this founder on Twitter."
- **Velocity signals:** "Companies in your 'Researching' stage that have been there for 30+ days" — nudge to act or pass.
- **Sector heat maps:** Track which sectors are trending in your own pipeline over time.

This is where the tool goes from useful to unfair advantage.

---

## Competitive Positioning

| Tool | What It Does | Gap |
|---|---|---|
| **Affinity** | Relationship intelligence CRM for dealmakers | Heavy CRM, no browser-native capture, no AI structuring |
| **Harmonic** | Company discovery + enrichment database | Discovery-focused, not capture-from-anywhere workflow |
| **Crunchbase** | Company and funding database | Static database, no pipeline management, no live signals |
| **Notion / Airtable** | Manual deal tracking in spreadsheets/databases | Zero automation, all manual entry |
| **Chrome bookmarks** | Saving links | No intelligence, no structure, graveyard of tabs |

**Our wedge:** Browser-native capture from any web surface + AI-powered structuring + lightweight pipeline management. No one does all three well.

---

## Business Model

**Target user:** Individual VCs, angels, small-to-mid-size funds (1-20 partners).

| Tier | Price | Features |
|---|---|---|
| **Solo** | $50-100/mo | Extension + dashboard, AI enrichment, monitoring for up to N companies |
| **Team** | $150-300/mo per seat | Shared pipeline, partner visibility, deal attribution, team analytics |
| **Fund** | Custom | API access, custom integrations (email, calendar), priority enrichment, dedicated support |

**Data moat:** Over time, the structured company intelligence compounds. The more companies captured across users, the better entity resolution, competitive mapping, and pattern detection become.

---

## Risks & Mitigations

**Data accuracy.** If auto-generated company cards are wrong or stale, trust erodes fast. Mitigation: confidence scoring on each field, easy inline editing, and a feedback loop where corrections improve the model.

**Entity resolution failures.** Merging the wrong entities is worse than creating duplicates. Mitigation: default to suggesting merges rather than auto-merging; let the user confirm.

**Distribution.** VCs are a small, high-value audience (~50K globally who actively source). Mitigation: seed with 20-30 power users who use it daily; the extension format is lightweight to try; word-of-mouth in a tight-knit community does the rest.

**Enrichment latency.** If the background enrichment takes too long, the dashboard feels empty. Mitigation: show progressive loading states on the dashboard; prioritize the most useful fields first (one-liner, stage, founders) and backfill the rest.

---

## MVP Scope

The minimum viable product to validate the core loop:

1. **Browser extension** with right-click "Add to Dealflow" on any page
2. **Inline confirmation card** showing company name, one-liner, inferred stage
3. **AI enrichment pipeline** that builds a company card from a URL (product description, sector, stage, founders, funding history)
4. **Web dashboard** with kanban pipeline, company detail view, notes, and basic tagging
5. **Founder lookup** with LinkedIn/Twitter links and one-click contextual outreach draft

**Explicitly deferred:** Live monitoring, pattern/thesis layer, team features, integrations, mobile app.

---

## Go-to-Market

1. **Private alpha** with 20-30 active VCs (source from personal network, Twitter/X VC community)
2. **Iterate on enrichment quality** — this is the make-or-break. If the company cards are good, the product sells itself.
3. **Public beta** with a waitlist and referral mechanic (invite 3 VCs, get a month free)
4. **Content-led growth** — publish anonymized deal sourcing insights ("What 500 VCs are looking at this quarter") to build brand in the ecosystem
5. **Fund-level sales** once team features are ready
