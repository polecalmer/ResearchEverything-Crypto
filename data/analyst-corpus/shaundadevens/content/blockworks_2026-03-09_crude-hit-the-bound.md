---
source: blockworks
author: blockworks-0xresearch
date: 2026-03-09
url: https://blockworks-research.beehiiv.com/p/crude-hit-the-bound
title: "Crude hit the bound"
type: article
tags: [crypto, defi, research]
---

# Crude hit the bound

Weekend trading carries signal

Kunal Doshi & Shaunda Devens March 09, 2026

Happy Monday! Today we focus on two related topics: how the latest Middle East escalation is repricing macro risk, and whether weekend trading is improving the handoff into traditional market reopens.

We first review the cross-asset impact of higher energy prices, then examine what HIP-3 weekend pricing captured ahead of the reopen and where price discovery remained constrained.

Market turbulence continued this week as tensions in the Middle East escalated. The Nasdaq and S&P 500 were down −2.4% and −3% respectively on the week. The biggest surprise, however, was the divergence between gold and BTC. Gold, traditionally viewed as the ultimate safe haven, was actually the worst-performing benchmark, falling −5.4%, while BTC moved the other way and posted gains of 0.77%.

At the center of the crisis is oil. Prices surged past $100 for the first time in four years as supply fears intensified. Roughly one-fifth of global oil supply flows through the Strait of Hormuz, which remains effectively closed. Several Middle Eastern producers have already reduced output, with Iraq and Kuwait cutting production and LNG exports from Qatar declining. Analysts now expect that UAE and Saudi Arabia could follow if the situation persists. On prediction markets, traders on Polymarket are assigning 36% odds that oil will reach $150 by the end of March.

Gold’s weakness has largely been attributed to forced selling as traders raise cash to cover margin calls elsewhere. BTC, on the other hand, showed relative strength, briefly crossing $70K midweek before settling closer to $66K. Part of the move may reflect investors positioning ahead of potential policy support if rising energy costs begin to strain the global economy.

Recent labor data also added to the shifting macro backdrop. February’s Nonfarm Payrolls report showed a surprise decline of 92K jobs, versus expectations for a 55K increase, while the unemployment rate rose to 4.4%. The report points to a cooling labor market just as inflation risks rise from higher energy prices.

This leaves the Fed in a difficult position. Higher oil prices could push inflation higher, making rate cuts harder to justify even as economic momentum softens. Market expectations have shifted accordingly, with the odds of only one cut in 2026 rising to 27%, while the probability of no cuts at all now sits at 18.4%.

Within crypto, the crypto-equities sector continued to stand out, rising 6% on the week. Gains were led by CRCL and COIN, up 10% and 8.4% respectively. CRCL continued to benefit from the momentum following its strong Q4 earnings report, and would also gain from a higher-for-longer rate environment through increased reserve income on government debt. COIN rallied after Trump publicly increased pressure on banks over the stablecoin-yield issue  surrounding whether crypto firms should be allowed to offer interest-like returns on stablecoins.

The AI sector was the next-strongest performer, gaining 2.6% on the week. The move was driven by NEAR and TAO, which rose 5.5% and 2.6%. At NEARCON, NEAR also introduced IronClaw, an open-source AI agent runtime that secures agents by sandboxing tools and encrypting secrets. This could be a major unlock for the AI agent economy by allowing developers to deploy autonomous agents without the security risks we currently see with OpenClaw.

For now all eyes remain on oil, as the next move in energy markets will likely dictate the direction of risk assets.

Hyperliquid handles weekend trading

WTI crude settled at $90.90 on Friday, March 6, up 35.6% on the week and marking the largest weekly gain in the history of the NYMEX futures contract.

CME Globex shut down at 5:00 PM ET. Within 40 minutes, HIP-3’s CL contract had fallen to $88.56 as weekend traders took profit after the most violent oil rally in four decades. By Saturday evening, it had recovered to $95.83 and remained there for the next 30 hours, pinned against the +5% discovery bound while traditional markets stayed closed until Sunday.

With markets open 24/7, the key question is whether weekend pricing improved the Monday handoff. This weekend, it mostly did. In the reopen-aligned sample of 40 weekend-by-market pairs, weekend-end prices were closer to the reopen print than the Friday close in 87.5% of markets. Median distance to reopen fell from 293.3 bps using the Friday close as the anchor to 92.0 bps using the weekend-end price, a median improvement of 154.0 bps. On meaningful moves, defined as |open return| >= 0.25%, directional hit rate reached 87.2%.

Cross-market fit also held up. Weekend-end returns versus reopen returns printed a slope of 1.39 and an R² of 0.77. In practical terms, the weekend tape carried substantial signal into the reopen.

The main limitation is that bounding bands cap how much price discovery can occur. CL and BRENTOIL dominated both flow and miss size. In reopen-aligned metrics, CL ended the weekend around +5.63% versus Friday, then reopened around +16.08%, implying an error of −1,046 bps. BRENTOIL showed the same pattern, ending the weekend at +4.85% versus Friday and reopening at +13.45%, for an error of −861 bps.

Aside from energy, the structure also looked clean. Single stocks were the strongest cohort this weekend: 95.5% finished closer than Friday, and median distance compressed from 285.6 bps to 88.8 bps. FX remained tight in absolute terms. Activity quality also mattered. Weekend daily volume ran at 26% of weekday pace, while daily trade count held at 62%, implying smaller average clip size but sustained participation. The most active weekend markets were CL ($480.5M, 315K trades), XYZ100 ($167.1M, 515K trades), SILVER ($106.2M, 67K trades), and NVDA ($76.6M, 52K trades). That made March 8 the highest-volume weekend in HIP-3 history.

Bottom line: This weekend supports the institutional 24/7 thesis. Weekend prices were generally informative and materially better than stale Friday closes. But in shock regimes, TradeXYZ still underprices jump magnitude before reopen due to bounding bands, then catches up violently when reference markets come back online.

1. The State of Crypto Leverage - Q4 2025

Galaxy argues that crypto credit is entering a more mature phase, in which offchain loan books are proving far more resilient than onchain leverage during market stress. In Q4 2025, onchain borrowing fell sharply as yields compressed and looping strategies became less attractive, while CeFi lending continued to grow with little visible distress despite the largest liquidation event in crypto history.

This suggests lending markets are healthier than in 2022, with less rehypothecation, better collateral, and more conservative structures. At the same time, futures open interest and onchain leverage have reset hard, while always-open perps are showing real utility beyond crypto. The broader takeaway is that crypto leverage is becoming less reflexive and more institutional over time.

2. Streaming Payments with Stablecoins: Rethinking How Payroll Solutions Pay People

This piece argues that payroll still runs on outdated batch systems, even though work and value creation happen continuously. Stablecoins already improve payroll by making payouts faster and more flexible, but streaming payments go further by letting salary accrue in real time instead of arriving in biweekly chunks.

Using onchain payment streams, employers could fund payroll once and let employees withdraw income as it vests second by second. The bigger idea is that payroll stops being a scheduled event and becomes programmable financial infrastructure in which income can be accessed, saved, borrowed against, or routed into other products as it flows.

Felix uses weekend oil trading as a case study for why 24/7 markets for traditional assets are becoming more credible.

The argument is that incumbent exchanges remain constrained by legacy market structure, settlement workflows, and regulation, while onchain venues can support continuous matching, block-level settlement, and automated risk management. The main limitation today is still off-hours price formation, as many weekend markets rely on self-referential pricing rather than deep 24/7 spot markets or robust onchain oracle inputs.

DAS NYC's lineup is bringing the biggest names in finance to the stage.

Don't miss the institutional gathering of the year — this March 24−26.
