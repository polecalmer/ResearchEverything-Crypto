---
source: blockworks
author: blockworks-0xresearch
date: 2025-12-04
url: https://blockworks-research.beehiiv.com/p/monad-s-first-week
title: "Monad’s first week"
type: article
tags: [crypto, defi, research]
---

# Monad’s first week

Hyperliquid’s frontend wars

Kunal Doshi & Shaunda Devens December 04, 2025

GM! Markets leaned back into risk-on territory as employment data fueled rate cut expectations ahead of tomorrow's payrolls print. In today’s ediition, we assess Monad’s ecosystem traction one week post-TGE and analyze whether Hyperliquid’s builder codes are a distribution flywheel or a long-term commoditization trap.

Markets continued to claw back losses from Monday’s selloff, with BTC, the S&P 500, and the Nasdaq up 2.52%, 0.22%, and 0.05%, respectively, yesterday. Even safe haven Gold has given back some gains and is down -0.12% on the day as risk appetite improves.

The uptick came after a surprise decline in private sector employment. Private employers shed 32K jobs in November, compared with expectations for job growth. This pushed the odds of a rate cut next week to 85%, up from 80% a week ago. Microsoft dragged on the Nasdaq, falling more than -2% after reports that the company has lowered AI software sales quotas due to softer than expected demand.

Across crypto sectors, most indices finished in the green except Gaming, which fell -1.65%. Gaming has been one of the weakest performers this year and is down -77% year to date. Memes, typically the most reflexive sector during market rebounds, also lagged with a modest 1.24% gain. The index was weighed down by PUMP and PENGU, which fell -2.54% and -1.80%, respectively, on the day.

On the upside, the AI sector led the market with a 7.46% gain. TAO continues to drive the index higher and climbed 7.6% ahead of its halving next week. L1s followed with a 6.45% move, powered by ETH and BNB, which make up 63% of the index and were up 6.6% and 5.2%, respectively.

Flows tell a more cautious story. After five days of inflows, BTC ETF flows turned negative again with a modest -$14.9M in outflows. ETH ETFs, however, saw a strong rebound with $140.2M of inflows after two days of declines earlier in the week. Even so, flows have yet to show real conviction when set against the -$4.4B in net outflows seen across November.

Now that we are about one and a half weeks past the Monad TGE, it is a good moment to step back and assess how the chain is actually performing post launch. After a strong initial rally, MON has cooled off and is down -28% on the week, leaving it up a modest 16% from its ICO price. On the ecosystem side, DeFi TVL continues to climb and now sits at $277.5M.

A large portion of that TVL is concentrated in AUSD. Around $144M of the $277.5M sits inside Agora’s stablecoin, which is being farmed across various protocols to earn ecosystem incentives. Upshift holds $73M and is deploying AUSD across DeFi protocols such as Morpho, Uniswap and Euler. Morpho currently offers 4.5% APY on AUSD and 5.98% on USDC, with most of the yield coming from MON incentives rather than organic borrow demand. Incentives are an acceptable way to jump start early liquidity, but the real test will be whether Monad can attract DeFi applications that generate sustainable, organic yield once the incentive fire hose tapers off.

Looking at native apps, Nad.fun has been the breakout leader in both accounts and transactions since day one. It is Monad’s native memecoin launchpad, but its staying power is not guaranteed. Only two tokens launched there have crossed the $1M market cap mark. Even Chog, the chain’s first community token, is down more than 65% from its highs and sits at $4.5M today. Not exactly the early momentum you would want for a vibrant meme ecosystem.

Other homegrown projects are gaining traction. FastLane has become the primary LST on Monad. Pinot Finance is emerging as an alternative DEX to Uniswap. Lumiterra, an MMORPG, has quietly put up strong usage numbers and ranked third by accounts and second by transactions yesterday.

On the chain level, activity looks promising for a network this early. Monad generated $100K in fees over the last seven days, placing it ahead of chains like Avalanche and Ton. Daily transactions and active addresses have been hovering around 2.2M and 117K, respectively. These are respectable metrics for a chain that just came out of the gate.

But one data point stands out. WormholeScan shows that 75% of the assets bridged into Monad have already flowed back out to other chains. That is an early sign that users may be farming and rotating rather than sticking around.

For Monad, the next phase is all about conversion. Can the chain turn early speculative inflows into sticky liquidity and real economic activity? The charts above are the ones I’ll be watching closely to see whether this ecosystem can turn early hype into lasting traction.

Every market speaks a different language. But they all understand Chainlink. This is how $867 trillion in tokenized assets speak blockchain.

Our latest report outlines why Wall Street is adopting Chainlink as the industry-standard oracle platform.

See why the world’s largest financial institutions are choosing Chainlink.

Hyperliquid: The frontend wars

One of Hyperliquid’s core innovations is builder codes. These codes function as a protocol-level parameter in transaction payloads, allowing interfaces to append a builder address for automated, onchain fee capture. Builders can attach a surcharge of up to 100 basis points (1%) on spot and 10 basis points (0.1%) on perps.

This decoupling of execution from settlement enables frontends to monetize proprietary flow without the technical complexities of maintaining an orderbook or the capital inefficiency of bootstrapping liquidity. As shown below, third-party frontends integrate Hyperliquid perps and add their own variable fee tiers on top, effectively creating a differentiated pricing landscape for the same underlying execution.

As such, builder codes have unlocked a powerful distribution flywheel. Nearly 40% of daily active users now trade through third-party frontends rather than the native UI, a share that briefly crossed 50% in late October. The top three builders alone, Based, Phantom, and pvp.trade, have collectively captured more than $31M in fees.

From a market structure perspective, this pushes Hyperliquid away from the fully integrated crypto exchange model and closer to the layered intermediation of traditional equities. In a centralized exchange like Binance, one entity controls the full stack across onboarding, routing, matching and custody.

Hyperliquid’s design mimics the US equity market, where retail brokers (Robinhood, Schwab) own the client relationship and monetize distribution, while routing orders to wholesalers (Citadel Securities, Virtu) that handle execution and settlement. In effect, the stack becomes two-tiered:

A broker-like distribution layer, where builders compete for order flow and differentiate on product and fee pass-through.

A central execution venue, where Hyperliquid concentrates liquidity and handles matching and margining.

While new to crypto perps, this decoupling mechanism has already played out on Solana. Trading terminals like Photon and Axiom controlled the user flow by focusing on the consumer layer. Photon grew first by being the fastest Solana memecoin sniper, while Axiom eventually challenged it with a broader product suite and more aggressive points and rebate designs. These terminals effectively functioned as builders: They sat on top of DEXs, bolted on their own fee markups, and maintained accounting manually. Hyperliquid’s builder codes essentially turn that pattern into a native protocol primitive.

However, the Solana example also highlights the risk. Trading terminals captured 77% of Solana's DEX revenue over the past year, $633M vs. $188M for DEXs, a 3.4x multiple that highlights that owning the frontend is often more valuable than owning the backend. Specifically, is the frontend too valuable for Hyperliquid to give away?

The relationship between frontends and backends is rarely purely symbiotic. Frontends like Jupiter aggregate various backends (Meteora, Raydium, Orca) and return the best route given size, fees and slippage constraints.

This forces DEX backends into severe margin compression. With zero moat, they must be the cheapest route to win flow. Since they don't own the user, backends are also at risk of replacement. We see this when Pump.fun replaced Raydium as its liquidity backend with its own in-house AMM, significantly impacting Raydium's volume share.

Right now, Hyperliquid does not face this problem. By pioneering builder codes on perps, it is effectively a singular builder code environment. However, if builders evolve from a UI on top of HL into true routers that can send flow to competing backends, they start to resemble a smart order router in traditional finance. In this scenario, builders can:

Optimize all-in cost: Calculate spread/slippage + taker/maker fees + builder surcharge − rebates + expected funding.

Bargain with venues: Demand higher builder shares or rebates with the threat of routing flow elsewhere.

Capture the user relationship: While venues are forced to compete purely to be the cheapest, best-execution wholesale liquidity provider.

Similarly, in traditional finance, wholesalers compete with broker-dealers for volume. Robinhood routes to Citadel Securities, Virtu, and Jane Street based on which provides the best execution and payment for order flow.

While rival DEXs like Drift and Ostium have integrated builder codes, none have emerged as genuine competitors to date. However, a significant structural risk remains: If a venue like Lighter were to pair builder rebates with its zero-fee model, it could theoretically allow wallets like Phantom and Rabby to bypass Hyperliquid’s 4.5 bps fee. This would enable frontends to capture the entire fee stack, effectively doubling their revenue per trade compared to the current Hyperliquid model.

LiquidTrading serves as a leading indicator of this future. The Paradigm-backed terminal, which raised $7.6 million in its seed round, has facilitated $5.6 billion in volume on Hyperliquid. But crucially, it also allows users to trade on Ostium and Lighter via the same interface. If larger builders follow this path and begin actively routing flow based on venue rebates rather than loyalty, Hyperliquid builder frontends could evolve into a commoditized perp aggregator, directly threatening the protocol's ability to capture value.

Still, there is a fundamental difference. Spot is easy to aggregate because each swap is atomic and the asset is fungible across venues. One transaction equals one fill, and a router can seamlessly split a trade across multiple pools. However, with perps, positions are persistent and venue-specific. A BTC-PERP position on Venue A is not fungible with a BTC-PERP position on Venue B due to differences in index composition, funding rates, liquidation engines and risk limits.

To route perps across venues meaningfully, the market needs one of two difficult solutions:

User fragmentation: Users must keep collateral on multiple venues, which is capital inefficient and results in poor UX.

Prime brokerage layers: The router must act like a clearing layer, solving the hard problems of credit extension, cross-margining and liquidation coordination.

While non-fungibility offers a short-term defense, the harsh reality is that frontends are rational economic actors; they will migrate if a competitor offers superior margins. Yet, the data suggests this threat is currently contained. Despite the high user counts on third-party interfaces, the vast majority of volume, over 90%, still originates from Hyperliquid’s native frontend.

Furthermore, the HYPE token adds a retention layer. Builders can hold HYPE to access fee discounts, allowing them to stack revenue streams: referrals, builder fees, and volume-based discounts. With this, the cost of switching for incrementally better fees may not be worth it for existing frontends. Finally, the flow coming from builders appears to be additive rather than cannibalistic. These are new users entering the ecosystem via wallets and terminals, not users switching interfaces.

Therefore, while builder codes offer an effective expansion vector, expecting Hyperliquid to maintain total dominance over its distribution layer is unrealistic. As the sector matures, Hyperliquid will face a tougher grind to defend its lead against aggregators and low fee competitors. However, building a performant onchain orderbook remains an immense technical moat, and with frontend margins remaining healthy, the incentives for builders to switch are low. Still, in a rapidly expanding market, this is not a battle to retain volume, but rather a more competitive race for growth where Hyperliquid remains the heavyweight to beat.

Hylo: Solana’s New Stablecoin Primitive

Blockworks Research profiles Hylo as a fast-growing Solana stablecoin system built on two linked tokens: HYUSD, an overcollateralized dollar asset, and xSOL, a leveraged SOL token with no funding rates or liquidations. Both draw from the same LST collateral pool, where hyUSD stays fixed at $1 and xSOL’s price adjusts with the pool’s variable reserve, creating built-in leverage. Yield flows only to sHYUSD, which earns over 13% APY and serves as the protocol’s backstop. Hylo has grown to nearly $100M TVL, averages around $280K in monthly revenue, and is now widely integrated across Solana DeFi.

Buybacks and Futarchy Won’t Save Crypto But Their Common Denominator Will

Dougie argues that buybacks rose to prominence not because they are optimal, but because trust in token design eroded and teams needed a simple way to signal alignment. Hyperliquid shows that buybacks work only when a protocol already has exceptional economics, while MetaDAO shows that clear ownership, transparent treasuries and market-governed decisions can restore trust without financial engineering. Despite appearing as the opposite, both succeed because they make rights and value flows explicit. The deeper lesson is that transparency, not any single mechanism, is what creates healthy token economies and lets markets properly assess competence and outcomes.

Based16z argues that algorithmic incentives have created a "super-pareto" reality where a single topic or symbol captures nearly all mindshare, effectively creating a "Megachurch" where the entire internet consumes the same singular signal. This homogenization creates a winner-take-all environment where the gap between the top narrative and everything else expands aggressively, offering a trading edge for those who bet on "growth virality" rather than fundamental value. The piece uses the American Eagle/Sydney Sweeney trade to illustrate how capital flows now follow extreme memetic concentration.

Crypto's premier institutional event is returning to NYC this coming March 24-26.

Ticket prices will increase soon, so lock yours in today!
