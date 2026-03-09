# How I Create Deep Research Reports

## Overview

This is the exact process I follow when you ask me to run a deep research on a project, protocol, or company. The goal is to go from a URL or name to a structured, investment-grade research document in a single conversation turn.

---

## Phase 1: Information Gathering (Web Search)

I run 5–8 sequential web searches, each targeting a different angle of the project. The searches are layered intentionally — broad first, then increasingly specific as I learn more about what the project actually is.

**Search sequence for Propr as an example:**

| Search # | Query | Purpose |
|----------|-------|---------|
| 1 | `web_fetch` the URL directly | Get the primary source content — what the project says about itself |
| 2 | `propr.xyz crypto DeFi` | Broad discovery — what category is this, who's talking about it |
| 3 | `Propr XBorg prop trading firm` | Identify the builder/team and confirm the core product |
| 4 | `propr.xyz funded trader challenge rules profit split` | Get the actual product mechanics — pricing, rules, structure |
| 5 | `Propr XBorg SwissBorg Hyperliquid prop firm review` | Third-party coverage, reviews, community sentiment |
| 6 | `XBG token Propr revenue share stakers buyback` | Token economics and value flow between parent and product |
| 7 | `PROPR token TGE seed round $17.5M FDV tokenomics` | Specific token launch details, FDV, allocation |
| 8 | `backtestr.xyz Propr trading agent AI` | Product roadmap and differentiated features |
| 9 | `"propr" "prop firm" Hyperliquid on-chain transparency payout` | Exact-match search for detailed operational claims |

**Key principles for searching:**

- **Start with the project's own site** — always `web_fetch` the URL first if possible, since the project's self-description reveals what they think their value prop is.
- **Search for the team/backers separately** — the project page often buries or overstates backer involvement. Independent searches surface the real relationship.
- **Search for the token separately from the product** — tokenomics and product quality are independent variables. Don't conflate them.
- **Search for competitors by category, not by name** — searching "crypto prop firm" or "on-chain prop trading" surfaces the competitive landscape better than searching for specific competitors.
- **Use quoted exact phrases** for specificity when earlier searches return too much noise.

**What I'm extracting from each search:**

- Core product description and mechanics
- Team background and credibility signals
- Backer names, involvement depth, and distribution potential
- Token structure, FDV, supply, allocation, vesting
- Competitive positioning — who else does this, what's different
- Traction metrics — users, volume, payouts, TVL, social following
- Red flags — rule changes, payout complaints, regulatory issues
- Roadmap items — what's live vs. coming soon vs. vaporware

---

## Phase 2: Synthesis & Structure

Once I have 60–90 search results ingested, I mentally organize the research into a standard framework. I don't use every search result — most are noise. I'm looking for the 15–20 genuinely informative data points.

**Standard report structure:**

```
1. Executive Summary
   - What is it (one paragraph)
   - Why it matters / core thesis (one paragraph)
   - Key numbers and upcoming catalysts (one paragraph)

2. Product Overview
   - Core product mechanics (how does it actually work)
   - Asset universe / scope
   - UX and tooling
   - Roadmap features (what's live vs. coming soon)

3. Business Model & Economics
   - Revenue streams (be specific — not just "fees")
   - Unit economics if available
   - Structural advantages or disadvantages of the model

4. Team & Backers
   - Who built it (background, credibility, track record)
   - Who backs it (nature of backing — equity? advisory? strategic?)
   - Community and build-in-public signals

5. Token Economics
   - Token parameters (supply, FDV, allocation)
   - Value flow (how does revenue reach the token)
   - Staking / governance / utility mechanics
   - Dual-token dynamics if applicable

6. Competitive Landscape
   - Traditional competitors
   - Crypto-native competitors
   - Advantages (be honest)
   - Risks / moat fragility (be equally honest)

7. Key Metrics & Traction
   - Table format — hard numbers only
   - Context for what the numbers mean relative to the industry

8. Risk Analysis
   - Platform/dependency risk
   - Regulatory risk
   - Team execution risk
   - Token/dilution risk
   - Market sizing reality check

9. Investment Considerations
   - Bull case (steelman it)
   - Bear case (steelman it equally)

10. Conclusion
    - Net assessment
    - Key open questions for further diligence
    - What metric to watch going forward
```

**Principles for the structure:**

- **Product before token** — always understand what the thing does before analyzing the token. Too many crypto reports lead with tokenomics.
- **Separate what's live from what's roadmap** — clearly flag features that are "coming soon" vs. actually shipped.
- **Bull and bear cases get equal weight** — if the bull case is 5 bullets, the bear case is 5 bullets. I'm not writing marketing material.
- **Risk section is mandatory** — even if the project looks great, every project has risks. Omitting them is dishonest.
- **Use tables for data, prose for analysis** — numbers go in tables. Opinions and reasoning go in paragraphs. Don't mix them.

---

## Phase 3: Document Generation

I generate a `.docx` file using the `docx-js` npm library (not Python, not markdown-to-docx conversion). This gives full control over formatting.

**Document design choices:**

- **Font**: Arial throughout (universally supported)
- **Body text**: 10.5pt, color #333333 (not pure black — easier on eyes)
- **H1**: 16pt bold, dark color — section headers
- **H2**: 13pt bold, accent color (blue) — subsections
- **Accent color**: #1A73E8 (Google blue — clean, professional)
- **Tables**: Light gray borders, alternating row shading, accent-colored header row
- **Page size**: US Letter with 1" margins
- **Header/footer**: Report title + page numbers

**Title page elements:**

- Category label (e.g., "DEEP RESEARCH") in small caps with letter spacing
- Project name large and centered
- One-line descriptor
- URL
- Date and key backer/builder line

**The actual code flow:**

```
1. npm install -g docx (if not already installed)
2. Write a Node.js script that:
   a. Defines helper functions (h1, h2, p, headerCell, cell, bulletList)
   b. Constructs the Document object with styles, numbering config, and sections
   c. Title page as Section 1 (no header/footer)
   d. Main content as Section 2 (with header/footer)
   e. Packs to buffer and writes to file
3. Run: node script.js
4. Validate: python validate.py output.docx
5. Copy to /mnt/user-data/outputs/
6. Present to user
```

---

## Phase 4: Conversation Summary

After presenting the file, I provide a TL;DR in chat that covers:

- **What it is** — one sentence
- **Product mechanics** — the key numbers (profit split, asset count, etc.)
- **Token play** — FDV, allocation, TGE timing
- **Key risks** — the 3–4 things that could go wrong
- **Bull angle** — why someone might invest anyway

This is intentionally shorter than the document. The doc is the full analysis; the chat summary is for quick decision-making on whether to read the doc at all.

---

## Calibration Notes

**Things I deliberately do:**

- Cross-reference the project's claims against independent sources (e.g., if they say "$1.2M in payouts," I look for third-party confirmation)
- Flag when a number is self-reported vs. independently verified
- Note when a team's background doesn't match the product domain (esports team building a trading firm)
- Call out vaporware explicitly ("this feature is listed as coming soon with no shipping date")
- Compare FDV/valuation to comparable projects at similar stages

**Things I deliberately avoid:**

- Price predictions or "should you invest" recommendations
- Taking the project's marketing framing at face value
- Ignoring the bear case because the bull case is exciting
- Treating token airdrop APY as "real yield" when the token doesn't exist yet
- Assuming backers = endorsement (backing can mean many things)

---

## Time & Tool Budget

A typical deep research like the Propr one uses:

- **7–9 web searches** (each returning ~10 results, so 70–90 total snippets reviewed)
- **0–2 web fetches** (for primary source pages if the search snippets aren't detailed enough)
- **~15 minutes of search + synthesis** before document generation begins
- **1 document creation cycle** (write script → run → validate → present)

The bottleneck is almost always search quality, not document generation. If the first 3 searches don't surface the right information, the whole report suffers. That's why the search sequence matters more than any other part of the process.
