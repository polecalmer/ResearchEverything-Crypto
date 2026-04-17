---
source: twitter
author: shaundadevens
date: 2025-12-09
url: https://x.com/shaundadevens/status/1998416698962215060
title: "1/ US options hit $89T notional in September, dwarfing crypto futures ($1.2T). In SPX, 61% of volume"
type: thread
tweet_count: 28
likes: 283
tags: [crypto, defi]
---

### Tweet 1/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416698962215060)

1/ US options hit $89T notional in September, dwarfing crypto futures ($1.2T). In SPX, 61% of volume is 0DTE and retail is &gt;50% of that flow, bleeding out in toxic auctions and theta decay

With incumbents blocked by regulation, is DeFi the solution?

Breaking down Equity perps: https://t.co/52OZxVrdqH

---

### Tweet 2/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416712480485480)

@felixprotocol @VestExchange 2/ A Perpetual Future is a cash-settled, delta-one derivative that replicates spot exposure with no expiry.

Unlike options or dated futures, price convergence is enforced economically via funding rates rather than a delivery date.

This periodic value exchange incentivizes

---

### Tweet 3/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416729240981660)

3/ In contrast, options are convex derivatives granting the right to buy/sell at a strike before expiry.

Buyers pay an upfront premium for a non-linear, path-dependent payoff where value decays over time (Theta). While designed for volatility trading, retail uses them for https://t.co/pzP4JcXJXy

---

### Tweet 4/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416744780792268)

4/ Yet, in TradFi, options still dominate.

We aggregated OCC data across 20 exchanges, converting contract volume to dollar terms, to find the true scale: $89T in monthly notional turnover. SPX alone accounted for $59.8T (67%), with SPY adding another $11.2T (13%). https://t.co/sBMDyRgrwL

---

### Tweet 5/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416760694042708)

5/ The majority of this volume (61%) is from 0DTE options expiring within one day, the purest form of leverage.

With no time value left, contracts embed median leverage of 200x (range: 150-350x). Retail drives 54% of this cohort.

We believe that, rather than trading volatility, https://t.co/piaeLY7xlo

---

### Tweet 6/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416778125562210)

6/ Additionally, retail options traders face toxic flow.

Orders placed during off-hours execute at the 9:30 a.m. opening auction, which tends to overshoot fundamental value and then reverse, costing around 50% of daily negative returns in the first five minutes.

Since the https://t.co/Z7HPGbKYlx

---

### Tweet 7/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416795221545142)

7/ While perpetuals serve as suitable alternatives, US regulation blocks compliant equity perps via Dodd-Frank requirements that are incompatible with crypto's integrated stack.

DeFi fills this vacuum via Reg S offshoring, capturing the non-US market (80% APAC overnight flow), https://t.co/n3X7ISU2ZO

---

### Tweet 8/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416808551051542)

8/ Can perps actually absorb this flow?

At a high level, a perp contract specification only needs a mark and an oracle, as with Hyperliquid’s HIP-3 design.

However, in practice, bringing TradFi assets onchain forces three constraints: continuous oracles, adequate liquidity, and

---

### Tweet 9/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416827035299861)

9/ Requirement One: continuous oracles.

1. Regular hours: Chainlink, Pyth and similar feeds deliver licensed equity prices during the cash session.

2. Overnight: Blue Ocean ATS pricing fills the gap. It handles only about 0.4% of consolidated volume, yet explains roughly 9% of https://t.co/x1XPfKWxhZ

---

### Tweet 10/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416843321889049)

10/ Requirement Two: Adequate exchange liquidity.

1. Funding stability: carry costs come from the mark-to-oracle basis. Thin liquidity makes that basis volatile, spiking funding and breaking the carry trade.

2. Mark integrity: risk engines liquidate against the mark. In shallow https://t.co/dd8v1Xvgwp

---

### Tweet 11/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416855917273181)

11/ Requirement Three: Reliable hedging mechanisms.

Unlike crypto-to-crypto perps, equity perp hedges sit on TradFi rails, for example hedging a Unit long with an E-mini S&amp;P short. That creates structural frictions:

1. Weekend delta gap: if the perp moves on Saturday, the

---

### Tweet 12/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416872673542485)

12/ With these three constraints in mind, only a handful of designs even attempt equity perps at scale. Volume is already clustering on Hyperliquid’s HIP-3 orderbooks, which cleared roughly $9.4B in equity perp volume over the last 30 days with daily peaks above $1B by tapping https://t.co/Bh8r1vNIVB

---

### Tweet 13/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416885315199092)

13/ @OstiumLabs is a peer-to-pool perp DEX for RWAs (FX, commodities, indices and single-name equities), effectively an onchain CFD model.

Traders face a protocol-owned pool rather than a CLOB, executing directly at a TradFi oracle price with minimal slippage. In return they pay

---

### Tweet 14/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416902440513580)

14/ That efficiency comes with hard structural trade-offs. Because prices come straight from TradFi oracles, Ostium cannot self-discover prices when those feeds are offline.

Equity trading runs limited hours, overnight leverage is cut to 10x, and weekend trading halts entirely. https://t.co/m2JV5wHDj9

---

### Tweet 15/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416918496288856)

15/ Ostium manages LP risk through a hybrid B-book / A-book model rather than leaving all flow fully internalized. By default, flow is B-booked against the onchain OLP vault, with dynamic fees adjusting based on inventory and flow quality to keep mean-reverting, retail-style flow https://t.co/o1oqhpZTiU

---

### Tweet 16/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416934241718298)

16/ On the orderbook side, Hyperliquid’s HIP-3 reframes the exchange as infrastructure.

Instead of listing every market itself, Hyperliquid runs an auction-based system where external deployers win the right to list markets, plug their oracle and mark parameters into HyperCore, https://t.co/2Zs4Qcu4o0

---

### Tweet 17/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416950469529972)

17/ @tradexyz is the vertical integration of @unitxyz existing infrastructure dominance.

Under HIP-2, Hyperliquid outsourced spot listings and Unit captured that layer by building custody and bridging rails for majors like UBTC and UETH, turning itself into the default spot https://t.co/DScFhJJzqZ

---

### Tweet 18/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416963572478317)

18/ Building alongside Unit is @felixprotocol, an integrated financial suite on HyperEVM that already shipped the ecosystem’s lending and CDP primitives.

Felix leans into Hyperliquid alignment by quoting its equity markets in native USDH rather than USDC. Settling in USDH

---

### Tweet 19/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416980681134463)

19/ Trade and Felix share a common weekend pricing framework.

When offchain venues are shut, both rely on internal pricing bounded inside predefined bands. Trade allows ±(1 / max leverage) around the stock close; Felix uses the lower of 20% or ±(1 / max leverage).

The idea is https://t.co/MZBwVgdkmK

---

### Tweet 20/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998416996032290873)

20/ The mark is set using a median of multiple inputs and constrained inside predefined price bands.

These bounding bands don’t remove manipulation risk, but they materially reduce the chance of liquidations by limiting how far the mark can move against a max-leverage position https://t.co/cbleSwYbgC

---

### Tweet 21/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998417012113215933)

21/ We tested HIP-3 liquidity via a microstructure study of Trade analyzing ~79k orderbook snapshots.

1. Spreads: Average quoted spreads around 1.7 bps, significantly tighter than typical overnight equities where spreads are often above 25 bps.
2. Inversion: Pre-market spreads https://t.co/rRjwMcDTcd

---

### Tweet 22/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998417027271430410)

22/ Overall, HIP-3’s real edge is distribution.

New markets do not start from zero. They inherit immediate reach to ~880k cumulative Hyperliquid users and plug into builder-driven funnels such as Phantom and Axiom, which together have referred roughly 275k users directly from https://t.co/orQCQGgDB5

---

### Tweet 23/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998417039980146946)

23/ Even so, there is room for architectures that do not rent HyperCore. @VestExchange is a primary example.

By running its own integrated stack instead of bidding in HIP-3 auctions, Vest competes on three structural pivots: unlimited markets, since listings are not gated by

---

### Tweet 24/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998417056115630387)

24/ Solana is in an unusual spot: Hyperliquid has stripped Solana’s users via builder integrations in Phantom and Axiom

Yet &gt;$150M of tokenized xStocks sit on Solana’s spot layer. A Solana-native perp venue could plug these directly into its margin engine as both collateral and https://t.co/w7H8CWhEJM

---

### Tweet 25/28
**@shaundadevens** | 2025-12-09 | [link](https://x.com/shaundadevens/status/1998417068379816182)

25/ The regulatory vacuum around roughly $48T in 0DTE leverage demand is pushing equity risk onchain by default

For the comprehensive report on landscape, competitors, architecture, market opportunity and positioning, read the full report on @blockworksres.

---

### Tweet 26/28
**@shaundadevens** | 2025-12-10 | [link](https://x.com/shaundadevens/status/1998658141140180996)

@zkmattwyatt @felixprotocol @VestExchange @ventuals doesnt fit cleanly under equities, so was not included in the report but @_dshap has got you covered with a deep dive https://t.co/Geo89GiMnt

---

### Tweet 27/28
**@shaundadevens** | 2025-12-10 | [link](https://x.com/shaundadevens/status/1998658351287116122)

@tjbitbounce @felixprotocol @VestExchange my man. thank you.

---

### Tweet 28/28
**@shaundadevens** | 2026-01-10 | [link](https://x.com/shaundadevens/status/2010012421151453252)

@blockworksres 26/ Full report https://t.co/3qYU6hcNJA
