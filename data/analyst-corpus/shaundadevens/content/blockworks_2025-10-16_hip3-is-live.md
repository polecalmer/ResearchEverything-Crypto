---
source: blockworks
author: blockworks-0xresearch
date: 2025-10-16
url: https://blockworks-research.beehiiv.com/p/hip3-is-live
title: "HIP-3 is live"
type: article
tags: [crypto, defi, research]
---

# HIP-3 is live

XYZ100 volumes pop on launch

Boccaccio & Shaunda Devens October 16, 2025

Gold leads as BTC chops even with $5.9B of ETF inflows. HIP-3 is live, UNIT listed XYZ100, with early flow coming through Phantom and BasedApp. Ventuals begins taking deposits for its pre-IPO HIP-3 exchange.

Over the past day, Bitcoin underperformed (-2.09%) compared to traditional equity benchmarks (S&P 500 +0.36%, Nasdaq 100 +0.66%), while gold continued to outperform (+0.92%). The fiat debasement cycle is here, but it’s mostly people rushing to buy gold, while BTC chops around. Despite underperformance, we’ve seen significant inflows into BTC ETFs over the past two weeks, totaling $5.9B USD.

AI (-10.06%), L2s (-7.91%) and modular (-7.77%) underperformed over the past day, despite the AI and modular sectors leading the recovery on Tuesday and Wednesday. Crypto miners (-0.76%) and crypto equities (-2.16%) have held up the strongest over the past day, likely due to equity markets performing well.

Following last Friday, markets have seemingly still not found a strong footing. BTC continues to chop and underperform over the past few days, with some relief coming in today — finally.

For further context, at DAS London this week, it seemed that all anybody could talk about was this past Friday, who blew up, and when everything would get resolved. Following an intense and volatile move like that, where some alts go to $0.001, it makes sense for it to take some time for the market to find stable ground.

The real issue comes in when you plot BTC against the S&P 500 or gold. While the S&P 500 has recovered relatively well since Trump’s tariff threats (now back up to 6705) and gold has made new ATHs (with thousands queuing up to buy physical gold around the world), BTC’s continuing chop and under performance has started to lead to concerns. In addition, there is the potential of additional escalation from both the US and China with regard to tariffs, which could lead up to a full blown trade war.

On the other hand, following levels of liquidations not seen historically, we’re generally bullish cryptocurrencies, even though it might take some time for them to find some footing.

We direct revenue back to DeFi participants for consistently higher yields.

Equities and Pre-IPOs via HIP-3

Just last week we wrote about HIP-3's final stages of testnet, and now it's live on mainnet with UNIT already launching their HIP-3 DEX.

Their first product, XYZ100 — an index tracking the top 100 companies — has generated $24.1M, $21.6M, and $20.7M in volume over the first three days, respectively. This performance stands out when compared to spot volumes for tokenized equities, which typically range between $8M-$12M weekly.

A powerful indicator was seeing Phantom list the XYZ100 perp via their frontend. As discussed previously, HIP-3 markets will not be originally listed on Hyperliquid's frontend, meaning distribution is heavily dependent on builders listing markets.

Phantom (54K users) and BasedApp (28K users) have already listed XYZ100, though some builders like Axiom decided not to, showing the optionality at play here. While builders still account for a small amount of Hyperliquid's total volume (3.5%), they have significant distribution with 37% of Hyperliquid's users trading from these platforms.

Source: Allium HyperLiquid Dashboard

However, it remains unclear exactly how builders will approach HIP-3 market listings. According to Phantom's documentation, "Any HIP-3 perpetual futures market can be accessed via Hyperliquid-compatible platforms, including Phantom." This suggests that in a bull case scenario, Phantom could permissionlessly list all HIP-3 markets, though we expect some degree of curation.

The value proposition is clear: HIP-3 already provides deployers with institutional-grade orderbook technology, and with builder participation, potentially elite distribution as well. HIP-3 already abstracts the orderbook infrastructure layer, and builders will potentially abstract away the need for deployers to maintain frontends or build their own communities. The only thing that matters is listing markets users want to trade.

One such project that will depend heavily on builder distribution is Ventuals. Ventuals creates synthetic perpetual futures on private company valuations for firms like OpenAI, SpaceX, and Cursor. The platform's innovation lies in its hybrid oracle system that addresses the fundamental challenge of pricing illiquid private assets (50/50 weighting between offchain secondary market data and 8-hour EMA of mark price).

Source: Ventuals Testnet Dashboard

Builders' decision to list these markets would abstract everything away from users, meaning the end user simply sees the ability to buy and trade pre-IPO projects directly from their wallet, though this could be a risk as end users cannot accurately distinguish risks for pre-IPO tokens such as liquidity constraints.

Source: Blockworks Research

To secure the 500K HYPE requirement for HIP-3 deployment, Ventuals will open deposits for vHYPE on October 16 at 15:00 UTC. vHYPE holders receive 25% of exchange revenue as ongoing fee share, in addition to earning Ventuals points toward a future protocol stake with up to a 10x boost for early participants.

However, depositors take on liquidity risk, as withdrawals are paused if total deposits sit at the minimum 500K threshold, since this stake must be maintained for the exchange to operate. Over time, Ventuals will add HYPE from their treasury and purchase additional HYPE with exchange revenue to create a withdrawal buffer above the minimum requirement.

HIP-3.1 Oracle Amendment: Enhancing Oracle Flexibility for Proprietary and High-Speed Markets

HIP-3.1 by SedaProtocol, proposes targeted upgrades to Hyperliquid’s HIP-3 so builder-deployed perps can use proprietary and high-speed data. It shifts oracle accountability to deployers and providers while giving validators a circuit-breaker halt (66% vote, 7-day cooldown with potential partial or full slashing), replaces the fixed 1% per-update cap with a deployer-set max price deviation (0.01%–5%) adjustable post-launch, and requires multisig control for oracle updates. The result is broader asset coverage (equities, indices, rates, prediction markets), faster yet bounded price responsiveness, and clearer operational roles that protect users without constant validator oracle policing.

Arete Capital Hyperliquid 2026 Thesis: Housing The Entirety Of Finance

Arete Capital's 2026 thesis positions Hyperliquid as crypto's breakout growth story, arguing it could eventually "house the entirety of finance." With perp volume accelerating to nearly $400B monthly and market share climbing toward double digits globally, Hyperliquid is expanding beyond derivatives into spot trading, stablecoins that share T-bill yields, and permissionless markets for traditional assets and events. The thesis centers on a compounding liquidity flywheel driven by builder integrations and stablecoin adoption, targeting $1.9B in annualized revenue and 15-25% of Binance's perp volume by late 2026.

Why Price Prediction Markets Beat Perps Every Time

Limitless published a blog post arguing that price prediction markets are superior to perpetual futures (perps) for cryptocurrency trading. The post references "Bloody Friday" on October 10th when $19 billion in leveraged positions were liquidated as Bitcoin dropped from $121K to $106K. Limitless presents their platform as a liquidation-proof alternative where users buy simple "Yes" or "No" contracts without leverage risk.

TGE Mechanism: Liquidity Distributor + Launch Pool

Meteora published a blog post outlining its $MET TGE mechanism, combining a Liquidity Distributor with a DAMM v2 launch pool. The community, not the team, bootstraps day-one liquidity, with an optional Liquidity Distributor NFT representing an LP position that accrues trading fees and can be withdrawn later. A wide initial pricing band supports price discovery while mitigating divergence risk. Eligible users can either opt into LPing via the NFT or simply claim their airdrop at TGE.

— Boccaccio / Shaunda

DAS London: Get videos on demand

new proposal live for trading, written by yours truly

— Proph3t (@metaproph3t)  10:20 PM • Oct 15, 2025

Venture capitalists are among investors putting $75 million into a US startup’s push to install home solar and batteries for an electricity subscription — just as the residential market shrinks

— Bloomberg (@business)  11:24 AM • Oct 16, 2025

x.com/i/article/1978…

— Dan Kim (@dankimxyz)  4:28 PM • Oct 15, 2025

"Have recent events proven that hardcoding USDe to $1 was the correct choice?" @salveboccaccio

@gdog97_ explained the risk tradeoffs that money markets are making in regards to @ethena_labs USDe pricing and backing within DeFi

— 0xResearch (@0xResearch)  1:13 PM • Oct 16, 2025
