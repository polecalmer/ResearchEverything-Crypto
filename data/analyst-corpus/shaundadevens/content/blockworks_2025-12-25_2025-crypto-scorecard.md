---
source: blockworks
author: blockworks-0xresearch
date: 2025-12-25
url: https://blockworks-research.beehiiv.com/p/2025-crypto-scorecard
title: "2025 crypto scorecard"
type: article
tags: [crypto, defi, research]
---

# 2025 crypto scorecard

2025 crypto scorecard

YTD indices plus perps outlook

Kunal Doshi & Shaunda Devens December 25, 2025

Today we’re wrapping 2025 with a cross-index scorecard and the main takeaway: Returns clustered in a few pockets (equities, miners, broker-style crypto stocks) while most of crypto beta got weighed down by supply and short-lived narrative bursts. We also look at perps, where the next market structure battleground is moving from fastest execution to most composable balance sheet.

As we approach year-end, it is a natural moment to step back and assess what worked, what did not, and what this year taught us. The chart below shows year-to-date performance across the indices we track, and it paints a sobering picture.

2025 was largely a year for equities. Gold, Crypto Mining stocks, Crypto Equities, the Nasdaq, and the S&P 500 all finished the year in positive territory. BTC, despite printing new all-time highs, is down -8% on the year. The picture for altcoins is far worse, with the Total 3 index down close to -20%.

One clear takeaway is bitcoin’s continued divergence from Gold. While BTC is often framed as digital gold, this year showed it still has work to do to earn that role. Central bank demand for gold remains strong, reinforcing its status as the default hedge in times of macro uncertainty. That said, flows tell a more nuanced story. Gold ETFs saw a record ~$69.2B of inflows this year, only modestly ahead of $33.5B into BTC ETFs and $20.1B of BTC purchased by DATs. Price action aside, demand for bitcoin accumulation is clearly building.

Crypto Miners were one of the standout performers, up 48.1% on the year, helped by their strategic pivot toward providing compute for AI workloads. However, concerns around an AI bubble remain a near-term headwind, with names like IREN down -22.9% over the past month.

Crypto Equities also had a strong year, up 23%. Investors continue to favor equity exposure to the crypto ecosystem over tokens, attracted by clearer cash flows and ownership structures. Stocks like HOOD and GLXY delivered returns of 202% and 34.6%, respectively, reinforcing that preference.

Within crypto native sectors, exchange tokens and buyback leaders were the best performers, both up around 20%. Much of that strength for both indexes came from BNB, which is up 20% year to date. Periodic spikes in activity driven by meme cycles and perp trading on BNB translated directly into fee growth and token performance.

Elsewhere, the damage has been severe. Most sectors are down more than -40% on the year, largely due to supply pressure. Roughly $31.8B of token unlocks hit the market in 2025, overwhelming available liquidity. The outlook for next year offers little relief, with another $31.4B of unlocks expected.

If there was a defining lesson, it is sadly this: 2025 rewarded traders, not long-term believers. Narratives ran hard, but briefly, often lasting only weeks. Discipline, profit taking and flexibility mattered more than conviction. The setup in 2026 may change, but the lessons from this year will remain just as relevant.

Crypto's premier institutional event is returning to NYC this coming March 24-26.

Composability in perps

Perp DEXs have spent the last cycle trading off speed vs. composability. High-frequency order books pushed execution onto isolated app-chains, while Ethereum-native venues inherited latency, fragmented liquidity and asynchronous cross-domain margin. The result is that most perp platforms behave like isolated trading venues. Users bridge in, margin sits idle, and the venue primarily monetizes execution.

Hyperliquid represents the dominant current solution path: Win on speed first, then add programmability back in. It built a purpose-built trading environment to make an onchain CLOB competitive, then started expanding beyond a pure venue by adding a general-purpose execution layer (HyperEVM) and balance-sheet style products so users can do more with the same collateral inside the ecosystem. The drawback is that this is largely composability within the Hyperliquid domain, rather than plug-and-play composability with the broader Ethereum existing collateral.

The alternative path is to build perps around Ethereum rollups instead of reconstructing an app-chain silo. Rollups keep you inside Ethereum’s security and asset universe, so composability is more native in the sense that applications can interoperate within the same execution environment. However, liquidity is still split across rollups, and cross-domain margin remains slow or asynchronous, especially for optimistic systems. Even zk systems historically had enough proving and finality delay that perps still operated like contained venues in practice. ZKsync’s Atlas is one attempt to shrink that verification gap, so a high-frequency execution layer can still reference Ethereum collateral without requiring the collateral itself to move.

Grvt fits the build around Ethereum approach: a perp venue designed to settle with zk proofs to Ethereum and lean on L1-native collateral sets, rather than forcing users into a standalone chain and rebuilding the stack inside it.

Lighter is another example, but it takes a more modular approach to programmability. LighterEVM is framed as a “sidecar” because it keeps the core exchange as a hyper-optimized, non-EVM engine (order book and liquidations proven with custom zk circuits), then adds a parallel smart contract lane so general-purpose compute does not contend with the matching path. At a high level, this resembles HyperEVM in that both put an EVM next to an exchange core, but the security and integration assumptions differ. Lighter is a zk rollup that settles to Ethereum (assets anchored on L1 and state transitions proven), while HyperEVM lives inside Hyperliquid’s own L1 domain and any Ethereum composability necessarily depends on bridging and messaging rather than native settlement alignment.

Going into 2026, as execution performance converges across venues, composability and capital efficiency will increasingly be the narrative battleground for perps: who can make collateral productive across a wider onchain balance sheet, not just who can match the fastest.

K-Scale: The Team That Tried to Beat Tesla

Chain of Thought talks about K-Scale as a case study in why open, low-cost humanoid robotics remains economically fragile despite technical breakthroughs. The team built a full-size, open-source humanoid faster and cheaper than heavily funded competitors, proving aggressive cost compression was possible. But early hardware revenue anchored investor expectations to weak margins, fundraising stalled and the company ran out of runway. The essay argues the failure was not technical but financial and structural: Robotics rewards closed systems, tight capital moats and manufacturing scale. K-Scale’s lasting contribution is its fully open-sourced designs, which may compound long after the company itself shut down.

Introducing Tempo Transactions

Tempo talks about introducing a native transaction type designed to make stablecoin payments work at real world scale. Tempo Transactions bake features like batching, concurrency, scheduled payments, fee sponsorship and biometric authentication directly into the protocol, removing the need for custom workarounds. This allows applications to run payroll, payouts, subscriptions and commerce flows with low cost and minimal complexity. By letting fees be paid in stablecoins and abstracting gas and wallets from users, Tempo aims to give fintechs and enterprises onchain payment rails that feel as seamless and reliable as traditional systems.

Citrini 26 Trades for 2026

Citrini’s “26 Trades for 2026” is a year-ahead watchlist meant to keep investors positioned for fast narrative and odds shifts rather than make precise forecasts. The free preview highlights three themes: 1) “Bullshit Jobs” frames 2026 as a potential inflection where AI adoption manifests as headcount cuts and margin expansion. Citrini proposes a screening framework that ranks “bureaucratic” firms (high overhead, high headcount per net income) with margin optionality, then builds an “AI Bureaucracy Alpha” watchlist that has materially lagged since ChatGPT and could re-rate if efficiency gains become measurable. 2) “Inference on Device” argues always-on agents favor edge compute on economics and latency, but flags RAM as the binding constraint, proposing a paired structure that goes long mobile on-device inference enablers while shorting consumer electronics most exposed to memory cost inflation. 3) “Post-Traumatic Supply Disorder” generalizes recent winners as industries that suffered prior overbuilds, then respond to new demand with capex discipline, creating pricing power and formalizing this with a quantitative screen that blends demand rebound, capital discipline and oligopoly structure. Examples span gas turbines, memory, and candidates across lithium, copper and trucking.
