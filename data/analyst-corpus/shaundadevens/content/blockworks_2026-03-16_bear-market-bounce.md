---
source: blockworks
author: blockworks-0xresearch
date: 2026-03-16
url: https://blockworks-research.beehiiv.com/p/bear-market-bounce
title: "Bear market bounce?"
type: article
tags: [crypto, defi, research]
---

# Bear market bounce?

Sam Schubert & Shaunda Devens March 16, 2026

Hi, everyone. Crypto continued to push higher this month even as equities struggled, with AI once again leading the tape. The divergence has become harder to ignore, but the broader macro backdrop is also turning less supportive as crude pushes above $100, the Dollar Index climbs back above 100, and stagflation fears start to re-enter the picture.

Below, we break down whether the move reflects a real shift in regime or simply an oversold bounce in a still-damaged market. We also look at how that macro stress showed up over the weekend in TradeXYZ’s crude perp, where repeated band hits exposed the limits of the old bounding-band design and helped prompt the platform’s updated model.

Crypto posted a broad green month while equities struggled. AI led decisively at 59.3%, with Crypto Equities at 22.4%, Perps at 20.5%, DEXs at 19.2%, and BTC at 6.8%. Nearly every sector finished positive, with only the Ethereum Ecosystem, Lending, and Crypto Miners in the red. NASDAQ slipped 1.4%, and gold gained 1.5% as the divergence between crypto and traditional markets widened.

Zoom out to the yearly view, and the picture inverts. Most sectors remain deeply underwater: Modular −90.2%, Solana Eco −72.6%, Gaming −71.7%, and DePIN −63.4%.

Gold at 69.0% has outperformed nearly all of crypto on a 1Y basis, and the S&P at 17.7% has beaten the majority of sectors. Only a handful of indices with direct revenue or equity exposure have kept pace.

The monthly rally looks more like a bear market bounce than a trend reversal, particularly as the Iran conflict pushes Brent above $100 and stagflation fears weigh on the market. Crypto’s relative strength this month may owe more to oversold positioning than a fundamental regime shift.

The Dollar Index also climbed to 100.4 this week, its highest since May 2025. The Iran conflict is driving safe-haven flows into the greenback, compounded by the US energy-independence advantage. A DXY above 100 has historically been a headwind for risk assets, tightening global dollar liquidity and reducing appetite for alternative stores of value. If the conflict drags on and the dollar holds these levels, the monthly crypto rally could face real resistance, particularly for assets that have bounced hardest from oversold levels without fundamental catalysts behind them.

In last week’s Monday edition, we noted that TradeXYZ’s crude perp tracked CL closely but hit its bounding band — making it two consecutive weekends where price discovery was constrained by off-hours risk controls rather than trading interest.

To understand why the band exists, we start with the oracle. When external markets are open, the oracle tracks the relayer’s live price feed. When they close, it switches to a smoothed internal estimate built from order-book impact prices. This transition matters because the mark — the price used for margin, liquidations, and unrealized PnL — is derived from it. The mark is a median of three inputs: the oracle, a short-horizon basis adjustment, and live market-state terms from the order book. This construction makes direct manipulation difficult in normal conditions. But once the hedge venue closes and the oracle loses its live anchor, even small order-book distortions can propagate through the mark into a large, leveraged open-interest base. The bounding band caps this off-hours sensitivity.

Under the legacy design, the mark could move only ±(1/max leverage) from the last external close — ±5% for CL, ±4% for Silver. A one-year TradFi closure-gap check across 40 underlyings and 2,069 reopen events showed this was well calibrated for normal conditions: The median exceedance rate was 0%, with 35 of 40 assets staying at or below a 5% breach rate.

The weakness was in the tails. Because the band’s width is mechanically linked to max leverage, it can also constrain genuine off-hours discovery and max leverage: A 100x market would imply only ±1% price movement. When true macro information exceeds the static band, price can freeze at the limit and defer adjustment into the reopen window.

Bounding Bands v2 solves this by altering the reference logic, not the instantaneous width. The ±5% band for CL and BRENTOIL remains, but when the oracle reaches 90% of the distance to the bound, the reference re-anchors to that edge and a fresh ±5% window opens. This can repeat twice per direction, expanding the total discoverable range to roughly +15.76%/−14.26% from the original reference.

The practical implication: v2 preserves the same immediate risk envelope that market makers quote against, but allows the reference to ratchet in response to persistent pressure. In ordinary closures, the static design sufficed. In macro tail events, v2 should reduce freeze-at-limit behavior and compress reopen gap risk by letting more of the true adjustment happen during the closed session.

1. Onchain Market Making Is the Future of Global Trading — with Temporal’s Founder Ben Coverston

Ben Coverston, founder of Temporal, joins the Frictionless Podcast to argue that prop AMMs and high-throughput execution layers are the endgame for onchain trading. The conversation covers Temporal’s market-making and block-building engines, why competitive sequencing on Solana matters for liquidity quality, and how the team plans to bring every tradable asset onchain.

Ben also digs into the mechanics of building a liquid perp DEX, the tradeoffs around MCP (Multiple Concurrent Proposers) and censorship resistance, and why payment for order flow may reshape DeFi market structure the same way it reshaped equities.

2. PUMP.FUN, ACX & AAVE | Livestream

Danny and Boccaccio from 0xResearch break down a $50 million Aave swap that resulted in extreme slippage, debating whether front-end design or user responsibility should bear the blame. They also cover pump.fun’s potential multichain expansion and what its launchpad economics look like at scale.

The episode closes on ACX’s plan to convert its token structure into equity, a move designed to unlock traditional partnerships and position the project for a possible acquisition.

3. The Blockchain to House all Finance

SmartestXYZ updates his Hyperliquid thesis to reflect the chain’s broader ambition to become the blockchain for all finance, now supported by a rapidly expanding ecosystem. In the updated report, he covers HIP-3 deployers, trading frontends, and the growing set of projects building on Hyperliquid.

DAS NYC's lineup is bringing the biggest names in finance to the stage.

Don't miss the institutional gathering of the year — this March 24−26.
