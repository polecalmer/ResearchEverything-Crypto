---
source: blockworks
author: blockworks-0xresearch
date: 2026-04-06
url: https://blockworks-research.beehiiv.com/p/after-drift
title: "After Drift"
type: article
tags: [crypto, defi, research]
---

# After Drift

Sam Schubert & Shaunda Devens April 06, 2026

Happy Monday, everyone! Ceasefire headlines gave crypto room to bounce, but the more interesting story may be where that rebound landed.

With Solana perps back in focus after Drift’s exploit, Phoenix is emerging as one of the more serious attempts to fix the chain’s execution problem without sacrificing onchain composability.

Reports of a proposed 45-day ceasefire between the US and Iran helped drive a relief rally across risk assets over the weekend. Brent fell toward $107.11, and Bitcoin climbed back above $69,000 as geopolitical anxiety eased and shorts were squeezed.

At the same time, the broader macro backdrop remains restrictive. March payrolls rose by 178,000 and unemployment fell to 4.3%, reinforcing higher-for-longer rate expectations even as sentiment stabilized.

In crypto, the rebound was broad but still selective. Memes led the daily move at +6.9%, followed by the Solana Ecosystem at +6.58%, AI at +2.47%, RWAs at +2.18%, and Revenue Leaders at +2.13%.

META rose 25%, likely helped by a fresh founder update that tried to shift the story back toward execution. The post highlighted $33M in treasury value secured, $35M in launched project market cap, early traction on the new permissionless platform, and a $6M P2P.me raise, even as management acknowledged that recent controversy had damaged trust and slowed momentum.

Watch Wednesday’s Fed minutes for any sign policymakers are becoming more concerned about inflation persistence or less willing to ease, and Friday’s CPI as the week’s main macro catalyst for rates, the dollar, and risk assets. Markets still expect no immediate policy shift, with Polymarket pricing a 98% probability that the Fed leaves rates unchanged at its next live decision on April 29th.

Solana’s perps complex does 5−10x less volume than Hyperliquid, and the gap is self-reinforcing: More volume attracts tighter spreads, tighter spreads attract more volume. The root constraint has been that Solana’s general-purpose blockspace was never designed to give makers the execution guarantees they need to quote tight on leveraged orderbooks.

April 1’s $280M exploit on Drift — which hit roughly half of Drift’s TVL through a social-engineering attack on its 2/5 multisig — compounds an already difficult position. At least eight protocols with Drift exposure were impacted, illustrating composability’s double edge: When the base layer fails, contagion spreads far beyond the primary venue. Before the exploit, Drift's monthly volume had already fallen 89% from its August 2025 peak.

Phoenix, built by Ellipsis Labs, is one of the strongest candidates to fill that gap in a fully onchain form. Ellipsis already proved it could solve execution on Solana with SolFi, a prop AMM that cut price impact on a $1M SOL trade from ~15 bps to ~5 bps.

The perps design attacks the same toxic flow problem at the compute layer: Market-maker quote updates cost ~500 CU versus ~150,000 CU for taker orders, giving MMs roughly 300x the effective scheduling priority at the same fee level.

Jito BAM strengthens this by running periodic intra-block auctions weighted by tip-per-CU efficiency, structurally favoring Phoenix's lower CU updates. The mechanism is probabilistic, not guaranteed, and leaders rotate every four slots, each running different client software. But it should start to tilt the odds enough that MMs can start quoting tighter without the stale quote risk that prevented the original spot book from gaining traction.

The composability thesis is what separates Phoenix from venues that move execution off Solana. Market state lives in Solana smart contracts; positions can serve as collateral in lending markets, basis trades can execute atomically, and third parties can build on top of Phoenix’s markets permissionlessly. The further a venue moves offchain for performance, the more directly it competes with Hyperliquid on matching engine design and accumulated liquidity depth, a race difficult to enter late.

Phoenix has no points program and no plans to launch a token. The risk is slower early traction when competitors have aggressive programs to acquire users; the upside is that all arriving flow is organic, the strongest signal of product-market fit when most volume metrics are clouded by incentives. The platform has been in private beta since December 2025; early numbers reflect that stage at ~$1M in open interest and ~$44M in March perp volume.

Solana Perps: Engineering the Missing Piece

Sam Schubert at Blockworks Research published a deep dive assessing why Solana’s perps complex still does significantly less volume than Hyperliquid and how three new protocols are attacking the execution gap from different angles. The report benchmarks round-trip costs across venues, finding Drift runs 3 to 4x Hyperliquid’s impact even at small clip sizes, and maps the composability-performance spectrum that defines each protocol's tradeoff.

Phoenix engineers around L1 constraints, using a 300x CU asymmetry between maker and taker transactions to tilt scheduling priority. Bulk distributes execution across a validator sidecar network with a SPAN-style risk engine claiming 70%+ margin reductions on hedged books. Bullet bridges into its own microsecond-latency sequencer and posts ZK proofs back to Solana. Drift's $280M exploit now underscores the urgency.

The Institutional Shift Driving Crypto Forward

Dan, Carlos and Danny on Lightspeed discuss how institutional and retail crypto are converging into a single financial industry, in this episode recorded at DAS. It opens on the perps regulatory landscape, noting TTF as a framework that could let US exchanges list tokenized futures products; Carlos argues this matters because it creates a pathway for regulated perps in the US without requiring full CFTC derivatives licensing. The panel covers Blockworks IR, a new product enabling real-time onchain investor relations versus the traditional quarterly update cycle, citing Robinhood's Vlad as a model for pushing IR transparency.

The back half focuses on crypto apps evolving into neobanks, with onchain card spend up materially over the last quarter and Maple Finance pitching syrup USDC yield to neobank platforms like SoFi. The DePIN segment highlights Helium's inflection point: AT&T and other carriers now offload real cellular traffic through the network, validating the token-bootstrapped infrastructure model six years after initial node deployments.

Introducing Blockworks Investor Relations, an IR platform built for onchain businesses.The latest Blockworks offering brings together analytics, a branded investor relations site, and integrated advisory support into a single platform. The result is a more efficient way to share your story, build trust with investors, and engage a global audience from day one.

Check out our cofounder Michael Ippolito's keynote at DAS NYC launching the new IR platform.

Explore Blockworks Investor Relations
