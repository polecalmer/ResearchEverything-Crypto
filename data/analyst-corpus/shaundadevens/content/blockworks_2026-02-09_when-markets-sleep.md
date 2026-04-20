---
source: blockworks
author: blockworks-0xresearch
date: 2026-02-09
url: https://blockworks.com/newsletter/0xresearch/issue/post_b4398974-084d-40ac-9e46-814197510fe3
title: "When markets sleep - Hyperliquid's promise of 24/7 trading"
type: article
tags: [crypto, defi, research, hyperliquid, perps, hip-3, gold, btc]
---

# When markets sleep
## Hyperliquid's promise of 24/7 trading

**Authors: Kunal Doshi & Shaunda Devens**
**Date: February 09, 2026**

Risk assets had a rough week as softer labor data weighed on sentiment. Meanwhile, gold was the standout and pushed back above $5,000.

With a heavy macro calendar ahead, we flag the pockets of strength in perps and agent-linked names. Then we dive into a silver stress test that asks a simple question: Does Hyperliquid's 24/7 HIP-3 market actually produce useful prices when COMEX is closed?

The past week was a rough one across risk assets. All major benchmarks finished in the red — with the lone exception of Gold, which has climbed back above the $5,000 mark and staged a strong recovery after its 20% drawdown at the end of January. Over the past week, Gold gained 8.2%, while the S&P 500 fell −0.54%, the Nasdaq dropped −2.5%, and BTC slid an uncomfortable −7.7%.

Part of the weakness late last week came from disappointing labor data. Job openings in December fell to 6.54 million, the lowest level since September 2020. This week is also shaping up to be a volatile one, as markets brace for a heavy macro calendar. Non-Farm Payrolls and the January unemployment rate are due on Wednesday, followed by CPI on Friday. These releases will be critical in shaping expectations around rate cuts as investors weigh rising unemployment risks against still-sticky inflation. For now, the odds of a March cut remain low at 15.7%.

Despite the broad risk-off tone, there have been pockets of strength. One standout has been the Perps sector, driven largely by a rebound in HYPE, which is up 6.4% on the week. That strength has spilled over into other perp DEX tokens, with Aster up 18.6%, MYX Finance up 16.5%, and Lighter up 3.2%.

Another notable outperformer has been BNKR, which surged 90.7% on the week. Activity on Clanker continues to hit new highs, with 60%-75% of token launches now routed through Bankr. The product allows users to deploy tokens directly from X by tagging @bankrbot, and recent momentum has been due to the Claude-themed AI agent mania on Base, with Bankr providing the wallet infrastructure for these agents.

The team has also rolled out a new vesting system aimed at better aligning developers and traders. With plans to launch an agent-focused launchpad and a proprietary LLM gateway, Bankr is shaping up as a project worth watching closely.

— Kunal

## Hyperliquid's promise of 24/7 trading

The case for HIP-3 equity and commodity perps has always rested on a simple structure — delta-one exposure, no expiry, costs expressed through funding rather than roll mechanics. Volume has validated the thesis: 12x growth in 66 days, $4.8 billion daily notional, and TradFi-linked contracts accounting for nearly a third of the venue by late January. We believe the weekend sessions will follow the same trajectory — as more participants build these markets into their workflows, off-hours liquidity and price formation should compound in the same way weekday activity has. But right now, that's still a forward-looking view.

The question we wanted to test: Does Hyperliquid's 24/7 market currently produce useful prices when reference markets are closed?

To understand why this matters, consider how traditional markets handle overnight information. Most major venues — COMEX, NYSE, Nasdaq, LSE — use single-price call auctions to set the official open. Orders accumulate during a call period, the exchange disseminates indicative prices and imbalance data, a short freeze window restricts cancellations, and a matching engine selects one clearing price to maximize executed volume. On the NYSE, the imbalance freeze starts at 9:29:55 and the auction prints at 9:30. Nasdaq's Opening Cross follows a similar sequence. It's an efficient mechanism for clearing pent-up flow, but it concentrates overnight information, hedging demand, and stop flow into a single discrete print.

A continuous venue like Hyperliquid changes this dynamic. Rather than absorbing whatever the reopening auction clears at, traders can stage positions during the weekend at prevailing order-book prices. When external reference pricing resumes at the open, Hyperliquid's internal price is pulled back toward the oracle, which creates the economic incentive to price the gap ahead of time. In principle, this converts a discrete jump into a tradable path.

While the mechanism is sound, the current data is less supportive. Across 23 HIP-3 equity markets and 146 weekend samples, we compared the pre-open Hyperliquid mid (measured 15 minutes before the oracle reopen) against Friday's close as a predictor of Monday's opening price. The pre-open mid was closer to the oracle open only 50.7% of the time, with a median improvement of approximately 0.4 bps — effectively no signal.

For these markets, the oracle open is still better anchored to Friday's close, and deviations in internal-session prices do not produce any meaningful information. Weekend trading is happening — spreads are tight (median 0.93 bps versus 2.4 bps during normal hours), and the venue clears continuously — but the prices produced during that window do not yet hold significance.

Part of this is structural. Weekend volume across HIP-3 runs at roughly 0.31x of weekday levels, and the participant mix shifts sharply smaller — median trade size drops from $1,245 to $196. When depth is limited, price moves during the internal session tend to reflect positioning noise rather than fundamental repricing, and the oracle reopen washes them out.

Still, we think this is largely a function of where these markets are in their life cycles. Weekend volume and depth on HIP-3 are where weekday metrics were months ago, and weekday liquidity compounded quickly as participants built these markets into their workflows. In that sense, we believe meaningful weekend activity is on the horizon for Hyperliquid.

— Shaunda

## 1. IREN Q2 Earnings: What the Market Missed

Sam argues the selloff in IREN after Q2 earnings misses the structural transition underway, as the company develops from a Bitcoin miner to a vertically-integrated AI and HPC infrastructure platform. The call showed material de-risking through sub-6% Goldman and JPM GPU financing that now covers most of the Microsoft buildout, improving unit economics and valuation versus peers.

With owned power, land and data centers, IREN can scale faster than competitors constrained by third-party infrastructure, while Sweetwater and the newly-confirmed Oklahoma site create long-dated optionality not reflected in current multiples. Despite near-term dilution and capex, Sam sees the stock mispriced as BTC beta rather than scarce AI infrastructure.

## HIP-3 Silver Microstructure: Hyperliquid vs. CME

The author benchmarks Hyperliquid's HIP-3 silver perpetual against COMEX during the sharpest silver selloff since 1980, using 540,000 trades and 1.3 million depth snapshots.

Pre-crash, Hyperliquid offered competitive spreads for retail-scaled flow (median 2.4 bps vs. 3 bps on COMEX), though depth was orders of magnitude thinner. During the crash, both venues degraded, but Hyperliquid developed a heavier execution tail — spreads widened 2.1x, the basis briefly spiked to 463 bps, and roughly 1% of trades printed more than 50 bps from mid versus none on COMEX. The dislocation mean-reverted within 19 minutes.

The author concludes that HIP-3 handles small-to-mid clips at a surprisingly high level of market quality, but large-clip execution and depth under stress remain the capacity constraint.
