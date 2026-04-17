---
source: blockworks
author: shaundadevens
date: 2025-10-20
url: https://blockworks-research.beehiiv.com/p/weekends-are-for-trading
title: "Weekends are for trading"
type: article
tags: [crypto, defi, research]
---

# Weekends are for trading

Weekends are for trading

Understanding Trade.XYZ's HIP-3 equities

Shaunda Devens October 20, 2025

Gm everyone and happy Monday! Gold continues its dominance over BTC, up 4.6% while crypto fell 5.4% last week. Today we dive a little deeper into Trade.XYZ HIP-3 parameters and understand how it is offering 24/7 indices markets.

Over the last week, Gold (+4.64%) outperformed BTC (-5.39%). Equities remained relatively stable, with the S&P 500 up modestly +0.42% and Nasdaq 100 gaining +0.75%, suggesting calmer waters in traditional markets compared to crypto.

However, volatility spiked beneath the surface. The VIX surged from 16.43 on Oct. 9 to 25.31 by Oct. 16, a +54% jump and the highest close since April, driven by renewed US-China tariff headlines and macro jitters. While the VIX has since retreated to 19, indicating short-term stress is winding down, some uncertainty remains.

In crypto, the standout performer was the AI sector, up +14.07%, led by TAO (+14.4%), and DEXE (+10.7%), significantly outpacing other indices. However, not all AI tokens benefited. FET dropped -23% following Ocean Protocol's contentious exit from the ASI merger alliance on Oct. 8, with Fetch.ai's CEO alleging undisclosed token mints and swaps, and Binance ceasing OCEAN ERC-20 deposits from Oct. 20.

On the downside, Ethereum Eco (-11.29%), Launchpad (-12.57%), and L2 (-15.11%) faced substantial pressure, highlighting investors rotating away from speculative or scaling-focused plays.

At our DAS Livestream, Blockworks Research and Teddy from Kairos Research sat down to discuss:

Staking’s tokenomics and utility challenges: We examined Cosmos's 21-day staking unlock period vs. liquid staking's flexibility, highlighting debates over staking's real long-term utility and whether it meaningfully impacts token demand or simply delays selling pressure.

Market volatility and exchange stability: We discussed recent volatility exposing Binance's operational challenges, contrasting with Hyperliquid's resilience under similar market stress. We compared decentralized liquidity management methods favorably against centralized exchange practices.

DeFi innovations and institutional integration: We explored the significance of emerging projects such as Plasma 1 and the GPU-backed stablecoin USDA, focusing on their innovative approaches to crypto lending and collateralization. We highlighted Coinbase’s recent integration with Morpho as a clear signal of increasing institutional participation in DeFi.

Effective community and governance models: We analyzed Monad's successful pre-launch community-building strategy, contrasting strong governance models vs. less transparent alternatives. We emphasized the necessity of transparent, user-focused governance for long-term protocol viability.

Emerging blockchain competitors: We evaluated the competitive positioning of newer blockchain platforms, such as Monad and Mega ETH, against established players, specifically focusing on scalability, transaction efficiency and the strategic implications of layer-1 vs. layer-2 solutions.

Macro-driven bullish sentiment: We addressed ongoing optimism driven by macroeconomic factors like AI-driven growth expectations and anticipated interest rate reductions. We highlighted how these conditions could further support institutional crypto adoption and general risk asset appreciation.

Find the full livestream on YouTube, Spotify, Apple Podcasts, and X.

How 24/7 markets actually work

Bringing 24/7 trading to equities could be one of crypto's most significant market structure innovations, and early signs are promising. Trade.XYZ, XYZ100 equity volumes continued through the weekend (Oct. 18-19), with $5.16 million and $7.89 million, respectively, validating the thesis even as volumes naturally tapered during off hours. But how does an onchain perpetual maintain fair pricing when underlying equity markets are closed?

Everything about Trade.XYZ perpetuals, matching, order types, funding, liquidations and auto-deleveraging, runs on HyperCore. Trade.XYZ (Like all HIP-3 Deployers) handles only the oracle price and mark price.

During standard market hours, the oracle pulls from CME's Micro E-mini Nasdaq-100 futures (currently the December 2025 contract, ticker NMZ5), converting the dated futures price to an implied cash index using cost of carry. This keeps pricing live when cash equity markets are closed while giving market makers straightforward hedging paths. The oracle is taken from Pyth.

When equity markets close for the weekend, TradeXYZ's oracle operates through a sequential process:

Switch to internal mode: The oracle stops consuming external equity data and anchors to the last external spot price seen at Friday's close.

Drift using orderbook pressure: The system calculates an Impact Price Difference (IPD) by measuring average execution prices on each side of the book. If buy orders lift the ask, IPD turns positive. If sell orders hit bids, IPD goes negative

EMA adjustment with speed limit: The oracle price adjusts toward this orderbook-implied level using an 8-hour exponential moving average, with per-tick adjustments capped at roughly 9.5% of the gap. For example, if IPD indicates price should be at $10,100 when the oracle is at $10,000, the movement per tick (3 seconds) is $9.5.

Mark price protection: The mark price (used for margin and liquidations) takes the median of three inputs: oracle price, oracle plus a 150 second EMA of (perpetual mid minus oracle), and median of best bid, best ask and last trade.

Safety clamp: A hard boundary prevents the mark from wandering more than ±(1/max leverage) from Friday's close. With 20x max leverage and a $10,000 close, the mark stays bounded between $9,500 and $10,500.

Snap back on reopen: When external markets resume (Sunday evening futures or Monday cash equities), the oracle returns to externally derived spot pricing on its next tick (roughly every 3 seconds)

The system is optimized for market makers to hedge positions effectively as the safety clamp allows them to avoid liquidation on weekends when they cannot rebalance, while the gradual EMA adjustment prevents sudden price shocks that would force immediate position changes. However, there are still drawbacks, especially for more volatile single equities, which will probably have lower leverage requirements.

That being said, TradeXYZ is not the first to tackle this challenge. Ostium has captured peak $200 million in indices weekly trading volume using a different approach.

However, rather than synthesizing internal pricing during market closures, Ostium pauses market execution entirely when underlying venues are closed. For RWAs (equities, indices, FX, commodities), Ostium operates a purpose-built pull oracle with Stork that includes market hours and holiday schedules. When the underlying market is closed, no market orders are allowed. Traders can place limit and stop orders that queue and trigger on the first valid tick after markets reopen.

Overall, while it is still unclear which design will win (continuous synthetic pricing or session-aligned execution), Trade.XYZ's approach is validating 24/7 trading, and can broadly be applied to any asset they want to list.

This chart perfectly illustrates why sentiment is bearish/tired even though $BTC still above $100k

A basket of the top 50 altcoins now trading BELOW where they were post-FTX crash in 2022

— Luke Martin (@VentureCoinist)  6:56 PM • Oct 18, 2025

x.com/i/article/1979…

— David Hoffman (@TrustlessState)  1:22 PM • Oct 19, 2025

— CBB (@Cbb0fe)  5:56 PM • Oct 19, 2025

6 AI models trading $10K each, fully autonomously

Real money. Real markets. Real benchmark.

Who's your money on? Link below

— Jay A (@jay_azhang)  10:25 PM • Oct 17, 2025
