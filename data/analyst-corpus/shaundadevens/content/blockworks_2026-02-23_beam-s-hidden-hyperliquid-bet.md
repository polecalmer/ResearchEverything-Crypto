---
source: blockworks
author: blockworks-0xresearch
date: 2026-02-23
url: https://blockworks-research.beehiiv.com/p/beam-s-hidden-hyperliquid-bet
title: "Beam’s hidden Hyperliquid bet"
type: article
tags: [crypto, defi, research]
---

# Beam’s hidden Hyperliquid bet

Beam’s hidden Hyperliquid bet

The Dreamcash connection explained

Sam Schubert & Shaunda Devens February 23, 2026

Hi all, happy Monday!

In today’s edition, we look at how Beam’s venture-heavy treasury and its stake in Dreamcash may offer indirect exposure to one of Hyperliquid’s fastest-growing deployers, as well as what that means for BEAM holders.

Perps dominated monthly performance as the only sector in the green, as we zoom in on Aftermath’s recent launch and how it’s bringing fully verifiable perps to Sui.

Crypto Equities (+4.4%) and Solana Eco (+3.1%) were the only meaningful winners on the week. The Nasdaq (+0.9%), S&P 500 (+0.9%) and Gold (+0.8%) were up marginally.

Bitcoin (−2.6%) was down again as ETF outflows extended. The damage was broad elsewhere, with the Privacy Index (−12.8%), Modular (−7.9%), RWAs (−7.3%) and L2s (−7.2%) leading the bleed.

Zooming out to the monthly view, the Perps category (+37.9%) is the sole outlier in a sea of red, with Gold (+2.3%) the only other sector in the green. The outperformance, obviously dominated by Hyperliquid, tells a clear story: When the broader market sells off, capital gravitates toward protocols with real revenue and usage-driven fundamentals.

The perps narrative has a new entrant worth watching: Aftermath went live on Sui on February 18 with a fully onchain orderbook, launching BTC/USDC as its first market. Unlike most perps platforms that rely on offchain sequencers, Aftermath runs every order, match and liquidation directly in Move smart contracts.

Just days after launch with only one market live, the protocol is burning 30 to 40 SUI per day purely from trading fees, with an average order cost of 0.001385 SUI as of the time of writing. Because Sui natively burns gas and storage fees, every trade directly reduces circulating supply while generating visible onchain revenue.

Aftermath is also flipping the typical fee dynamic. Dune data shows traders are receiving an average refund of around 0.03 SUI per transaction, with nearly 100% of transactions having negative fees (due to the dominance of cancels and fills).

This is possible because of Sui’s object-centric model, wherein each order is stored as an independent object with an upfront storage deposit that gets automatically refunded in the same transaction.

Aftermath also bakes in a fee-aware anti-toxic flow system shared with DeepBook: Bots that spam high gas to front-run stale prices get hit with toxicity fees, which are rebated to makers. Tighter maker protection means tighter spreads, which means better execution for everyone else. If it works as designed, it may give Aftermath a structural edge in attracting market-maker liquidity.

Beam’s unlikely HIP-3 play

Hyperliquid’s HIP-3 deployer market is consolidating faster than expected.

TradeXYZ remains dominant at roughly 87% of cumulative volume ($57.2 billion since November 2025), but marginal share has shifted. Dreamcash, a USDT-quoted deployer listing single-stock equities and commodities, scaled from negligible weekly throughput in November to about $1 billion in the most recent week, with trailing seven-day dominance reaching 20.2%. Cumulative volume is $5.24 billion, putting it clearly in second place ahead of Felix ($1.70 billion) and Kinetiq ($1.31 billion).

Additionally, Tether recently took a position in Dreamcash. With USDC still dominating Hyperliquid’s stablecoin float, Dreamcash’s choice to denominate markets in USDT directly grows USDT circulation on the venue, making a strategic partnership with Tether economically aligned. Proceeds have funded an incentive program of roughly $200,000 per week, and it may be extended.

Dreamcash’s growth isn’t limited to the deployer side. Builder-tagged volume — order flow routed through Dreamcash’s own frontend infrastructure — has scaled in step with total activity, reaching $1.98 billion of the $5.24 billion cumulative total (37.7%). That means Dreamcash is capturing growth on two fronts: a sticky retail user base through its mobile-first experience, and the more competitive, less-sticky HIP-3 deployer layer.

Still, for investors, the question is how to gain exposure to the protocol. Like most HIP-3 deployers, Dreamcash is pre-TGE, so direct exposure is effectively unavailable. However, there is an indirect route.

Dreamcash is built by Supreme Liquid Labs, an entity in which Beam holds 98% equity. Beam is a sovereign proof-of-stake Layer-1 with a foundation-managed treasury whose mandate is to grow BEAM, deployed via Beam Ventures. Historically, returns were recycled into the token via MIP-7: 60% directed to programmatic price support through onchain limit orders, 20% to the treasury in USDC, 15% to buybacks, and 5% to WETH/WBTC. While that structure was defined earlier in Beam’s lifecycle and may have evolved since, the key point is that the treasury mandate remains oriented around actions intended to accrue value back to BEAM holders.

Along with Dreamcash on the balance sheet, the treasury itself has undergone a structural transformation over the past four years, shifting from a conservative, cash-heavy balance sheet to a venture-dominated portfolio totaling approximately $175 million — of which $122 million sits in private venture positions, $31 million in cash, and $21 million in liquid crypto. At the current Q4 mark of $49 million, Beam trades at roughly 130% of total treasury value on a fully diluted basis. If that mark moves higher — which the Tether round and volume trajectory could suggest — the premium compresses meaningfully.

That said, a reported treasury value is not a realizable one. The portfolio is heavily illiquid, concentrated in a few outsized positions, and sector-level returns are uneven. In our full report, which we aim to publish in the following week, we’ll reprice the venture book on a position-by-position basis, discount for illiquidity, and break down where returns are actually coming from — and what the treasury is worth to a BEAM holder on a practical basis.

Jito BAM and Solana Market Structure | Lucas Bruder

0xResearch published a podcast episode with Lucas Bruder, co-founder of Jito Labs, on Jito’s BAM block builder and Solana market structure. BAM runs in trusted execution environments at 25% of network stake, providing transparent, verifiable block-building with 50ms batch auctions and application-controlled execution (ACE). The current focus is on prop AMMs.

Lucas discusses BAM’s coexistence with Harmonic, the 12−18 month path to MCP (multiple concurrent proposers), pending slot time reductions, and JitoSOL’s ETP efforts, including a 21Shares Europe launch and SEC task force engagement.

The Company That Owns the Backbone of the AI Economy

Black Panther Capital published a deep dive on IREN, arguing the former Bitcoin miner has built one of the most compelling AI infrastructure moats in the market. IREN controls 4.5 GW of grid-approved power across Texas and British Columbia, anchored by a $9.7 billion five-year Microsoft GPU-as-a-Service contract funded with minimal equity dilution. The company is targeting $3.4 billion in ARR by the end of 2026, which would utilize only 10% of its total power portfolio. The piece frames IREN’s vertically integrated model, land ownership, substations, and liquid-cooled data centers capable of 200kW per rack, as a structural advantage that capital alone cannot replicate given 5−7 year grid approval timelines.

Reducing Toxic Flow for Better Liquidity

Phoenix published a thread explaining toxic flow and how their perp exchange’s market structure is designed to minimize it. Toxic takers exploit the delay between CEX price moves and onchain quote updates, picking off stale market-maker orders for risk-free profit. Market makers respond by widening spreads, which gets passed through to end users as worse execution.

Phoenix’s solution uses a 30x compute unit asymmetry: Market maker quote updates cost ~5,000 CUs versus ~150,000 CUs for taker orders, giving makers significantly higher effective priority in Solana’s block ordering. The result is tighter spreads and better fills for retail users.

DAS NYC's lineup is bringing the biggest names in finance to the stage.Don't miss the institutional gathering of the year — this March 24−26.
