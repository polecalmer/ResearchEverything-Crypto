---
source: blockworks
author: blockworks-0xresearch
date: 2026-04-13
url: https://blockworks-research.beehiiv.com/p/oil-s-back-miners-win
title: "Oil's back, miners win"
type: article
tags: [crypto, defi, research]
---

# Oil's back, miners win

Oil's back, miners win

Crude spikes, and crypto miners rally 19%

Kunal Doshi & Shaunda Devens April 13, 2026

GM, and happy Monday!

Geopolitical volatility is driving markets this week, as the breakdown of US-Iran talks and threats of a Strait of Hormuz blockade caused crude oil to jump 7% to $103. This sudden spike reignites inflation concerns just as we head into a critical stretch of PPI data and US bank earnings.

Despite the macro pressure, the Crypto Miners sector rallied 19%; they continue to trade as high-beta AI infrastructure plays following multi-billion-dollar data-center deals with Google and Meta. In today’s edition, we also dive into the frontier of leverage in prediction markets, unpacking the four emerging models racing to capture institutional demand.

Over the past week, all major benchmarks moved higher, led by the Nasdaq and BTC, which gained 3.17% and 2.78% respectively. The S&P 500 and gold followed with gains of 2.63% and 0.93%. However, much of this strength has come under pressure, with a sharp reversal seen in Monday’s premarket trading.

Weekend developments once again proved to be the key driver. On April 11, the US Vice President confirmed that talks with Iran had broken down without agreement. A day later, Trump announced plans to blockade the Strait of Hormuz, prompting a strong response from Iran’s Revolutionary Guards, who warned that any military presence near the Strait would be treated as a ceasefire breach. Markets reacted quickly, with crude oil jumping 7% to $103, bringing inflation concerns back into focus.

Across crypto sectors, performance was broadly positive, with around 60% of sectors closing the week in the green. Crypto Miners led the rally, up 19%, followed by the Privacy sector, which gained 17.1%, largely driven by ZEC’s 48% surge. As highlighted in last Friday’s edition, the move in ZEC appears to have been driven by a short squeeze, with crowded positioning unwinding as prices moved higher.

The rebound in Equities also spilled over into Miners, which continue to trade as high-beta AI infrastructure plays. Names like HUT, WULF, RIOT and CIFR posted gains between 20% and 35%. This strength was supported by a steady stream of data-center related announcements, reinforcing the durability of AI-driven demand. CoreWeave in particular stood out, announcing a long-term agreement with Meta worth up to $21B through 2032, alongside additional capacity commitments tied to Anthropic’s Claude models. HUT also rallied on the back of a 15-year agreement with Google that could generate up to $17.7B in revenue, further validating the pivot of miners into AI infrastructure.

Looking ahead, markets are entering a critical stretch with both macro data and corporate earnings in focus. The week begins with major US banks reporting, which should give an early read on financial conditions and credit demand.

On the macro side, inflation remains front and center. The upcoming PPI data on Tuesday will be closely watched for any signs that higher energy prices are feeding through into broader costs. At the same time, developments in oil markets and any escalation in geopolitical tensions will continue to drive sentiment, keeping volatility elevated in the near term.

Leveraged prediction markets

Prediction markets are evolving beyond simple spot trading, with leverage emerging as the next major feature frontier. While retail traders are drawn to leverage for amplified returns, the institutional case centers on capital efficiency. For example, Kalshi’s weather markets have already facilitated roughly $595M in cumulative volume, proving to be a natural hedging instrument for energy companies and agricultural traders. As platforms race to capture this demand, four distinct leverage models are emerging, each tackling risk and capital formation differently:

The Lending Pool: Similar to traditional DeFi lending (e.g., Aave or Morpho), traders deposit their tokenized prediction-market positions (like Polymarket’s ERC-1155 NFTs) as collateral to borrow stablecoins and loop their exposure. Risk is socialized among depositors, and jump risk is managed using calendar-based early closure ramps that linearly reduce liquidation thresholds to zero before market resolution.

The Prime Broker: Instead of a pooled credit vault, this acts as a venue-native margin model that monitors account health and manages liquidations directly. It enforces per-market leverage caps and utilizes Dutch auctions to handle large liquidations with minimal order book impact.

The Synthetic Desk: Operating as a Contract for Difference (CFD), the desk sits as the counterparty between the trader and the underlying market. Because the trader only holds a synthetic claim, the desk can internalize risk management, utilizing dynamic, signal-triggered leverage decay as time-to-resolution shortens.

The Perps Exchange: This model applies standard perpetual funding rates to prediction markets, as seen with dYdX’s TRUMPWIN-USD market. However, standard perps assume a persistent balance between longs and shorts. Because prediction markets converge toward a binary $0 or $1 outcome, this mean-reversion assumption structurally breaks down right when the contract approaches its final resolution.

The winning model will ultimately be the one that can keep positions open the longest, because financing revenue, rather than trading fees, drives leverage economics. Modeling against the 2024 election data, financing revenue accounts for over 87% of total fee revenue. A well-functioning, platform-wide leverage layer could generate ~$15M in annual incremental fee revenue in a base case, scaling up to $50.7M in a bull scenario. Despite these innovations, all four models inherit a shared structural vulnerability: Centralized Limit Order Books (CLOBs) are poorly suited for the discrete information jumps of prediction markets.

When news breaks or game states change instantly, stale limit orders are picked off by informed takers before makers can cancel them. For example, in a Kalshi NHL market (Dallas vs. Calgary), a single resting limit order resulted in a 21,840-contract fill at 99 cents just as the game shifted; the market resolved at $0 twenty minutes later, resulting in an adverse selection loss of ~$21,384. Until base-layer venue architecture evolves — potentially toward batch auction designs — leverage providers will be forced to build complex workarounds for structural problems they cannot independently solve.

For a detailed analysis, see Blockworks Research’s full report: Leverage in Prediction Markets.

1. Weekend Market Note: Hormuz Blockade

The note finds that TradeXYZ’s recent surge in activity was driven primarily by geopolitical volatility, with oil markets dominating both volume and price action as traders reacted to shifting expectations around US-Iran negotiations. A brief risk-on move tied to early signs of de-escalation quickly reversed after talks collapsed, leading to a sharp spike in crude and a broad selloff in equities. Equity markets saw unusually high participation and are now pricing a significantly negative open, suggesting traders expect continued downside pressure while energy markets remain elevated.

2. How Many Traders Are Profitable on Polymarket

The analysis finds that Polymarket profitability is extremely skewed, with the vast majority of traders losing money and only a tiny fraction earning meaningful income. While about 16% of traders are technically profitable, just 2% have made over $1,000, and fewer than 0.1% generate consistent monthly income at levels comparable to a salary. Most profitable traders are short-lived, with the majority active for only one to two months, and the probability of sustaining meaningful earnings over time drops rapidly to near zero. The core takeaway is that despite viral narratives around easy profits, Polymarket behaves more like a winner-take-most market where consistent success is rare and heavily concentrated among a small group of participants.

3. Solana Perps: Engineering the Missing Piece

The report argues that Solana’s biggest remaining challenge in perps is not demand but execution, with general-purpose blockspace failing to provide the deterministic guarantees market makers need to quote tightly. This has pushed high-performance flow toward purpose-built venues like Hyperliquid, creating a persistent liquidity and pricing gap.

New protocols like Phoenix, Bulk and Bullet are attempting to close this gap through different tradeoffs between composability and performance, while upcoming infrastructure upgrades may help at the base layer. The key conclusion is that if Solana can achieve competitive execution while preserving its composability advantage, it can capture durable share, but failure to do so risks ceding the most valuable derivatives market to specialized chains.

Introducing Blockworks Investor Relations, an IR platform built for onchain businesses.The latest Blockworks offering brings together analytics, a branded investor relations site, and integrated advisory support into a single platform. The result is a more efficient way to share your story, build trust with investors, and engage a global audience from day one.

Check out our cofounder Michael Ippolito's keynote at DAS NYC launching the new IR platform.

Explore Blockworks Investor Relations
