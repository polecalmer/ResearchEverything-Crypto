---
source: blockworks
author: blockworks-0xresearch
date: 2025-08-28
url: https://blockworks-research.beehiiv.com/p/from-bets-to-blocks
title: "From bets to blocks"
type: article
tags: [crypto, defi, research]
---

# From bets to blocks

Prediction markets get a boost, Solana speeds up

Kunal Doshi & Shaunda Devens August 28, 2025

Prediction markets are heating up, with Polymarket crossing $350 million in weekly volume and pulling in a double-digit million investment from Trump Jr.’s 1789 Capital. At the same time, Solana is eyeing sub-second finality with Alpenglow (SIMD-0326), a proposed consensus shift that trades millions of validator votes for a flat fee. Both stories highlight the same theme: Markets are moving faster and investors are betting big on it.

Who could have predicted this!

While the broader market remains choppy, one corner of crypto is stealing the spotlight — prediction markets! The biggest headline of the week is that Trump Jr.’s 1789 Capital invested a double-digit million sum into Polymarket, fresh off its billion-dollar valuation led by Founders Fund. The kicker is that Trump Jr. also joined competitor Kalshi as a strategic advisor earlier this year. Talk about being structurally bullish on a trend.

The numbers back it up. Many assumed Polymarket’s momentum would fade after election season, but the platform is proving sticky. It generated $350 million in trading volume last week. The appeal is obvious. Prediction markets make news and culture tradable. They are fun and interactive, and because wagers require real money, they crowdsource probabilities that often cut through noise better than polls or pundits.

Around 40% of Polymarket’s volume comes from sports and another 40% from crypto. Built onchain, it can undercut traditional betting platforms with lower fees, greater transparency and more creative markets. Open interest sits at $132 million, reflecting strong activity and deep liquidity on the platform.

The momentum is forcing rivals to move. Kalshi has brought in KOL John Wang as head of crypto to lead its onchain push, while Robinhood is teaming up with Kalshi to launch pro and college football markets. With Polymarket giving a 96% odds of it going live in the US in 2025, the meta has just begun and investors are clearly eager for ways to get exposure to this sector.

Is your treasury losing value to inflation?

A new report from Liquid Collective and EigenCloud outlines a practical guide for making digital assets like ETH and SOL productive with uncorrelated, protocol-driven staking rewards.

Learn how to integrate institutional-grade staking and restaking to build a future-ready treasury.

Solana’s consensus stack, proof-of-history sequenced with TowerBFT, has always delivered faster block times than competitors. But finality still sits around 10-20 seconds, far from the Nasdaq-level latency Solana aspires to.

SIMD-0326 (“Alpenglow”) proposes cutting finality to ~100-150ms by moving validator voting off-chain. Today, validators continuously post votes onchain to signal fork choice, and these votes dominate throughput despite carrying no user value.

Under Alpenglow, validators instead pay a fixed “Admission Ticket” of 1.6 SOL per epoch, burned to the network. Leaders then gather votes off-chain through a component called Votor, compress them into certificates, and write those certificates onchain. The result is a swap: Millions of low-value vote transactions are replaced by one predictable fee per validator, lowering consensus overhead by ~20% and freeing blockspace for user activity.

The design also adjusts fault tolerance. TowerBFT today remains live unless more than 33% of stake is adversarial. Alpenglow introduces a “20+20” model, where the chain stays live with 20% malicious stake and another 20% offline. For applications like DeFi, specifically perpetual exchanges like Drift, sub-second finality transforms Solana from “fast” into a real-time settlement layer.

The economics are still under debate. Smaller validators face a flat 1.6 SOL per epoch fee regardless of stake, while reward flows remain undefined. Governance discussions (epochs 833-842) have emphasized the need for a clear rollout path, including sequencing for Alpenglow’s components. Still, if implemented, SIMD-0326 would represent one of Solana’s most significant structural upgrades.

A16z: The top 100 Gen AI consumer apps

This edition of the Top 100 Gen AI Apps shows a maturing ecosystem, highlighting top AI assistants like ChatGPT and Gemini alongside emerging players and Chinese app influence. It also covers trends in content creation and vibe coding, revealing key areas of growth and consumer adoption.

Physical AI: The next frontier for data

AI progress from digital sources is slowing as the web’s content is largely exhausted. The next breakthroughs will come from physical AI — robots, wearables, smart glasses, vehicles and sensors generating rich, real-world data that captures motion, touch and context, helping AI learn more accurately from how people actually live and interact.

Four pillars: How governments and banks are shaping stablecoins

Japan, the US and South Korea are moving toward integrating stablecoins into regulated financial systems, with Japan set to approve its first yen-backed stablecoin, Wyoming issuing a state-backed Frontier Token, and Korean banks exploring partnerships with Tether and Circle. Globally, banks and crypto firms are expanding stablecoin infrastructure, payment onramps and cross-border remittances, while regulatory shifts and regional challenges shape the pace of adoption.

The next batch of crypto ETPs will be built different.

Hear from the architects of ETPs designed for a staking economy.

As modular stacks and rollup-as-a-service providers like Gelato continue to support the full spectrum of decentralization, teams can deploy applications with their desired level of autonomy, composability, security, and cost-efficiency. This trajectory signals a broader architectural realignment, with implications for how value, risk, and security are distributed across the next generation of rollups.

x.com/i/article/1950…

— miya (@MiyaHedge)  5:10 PM • Aug 21, 2025

Quick thread on DATs, operational vs financial income, and BTC vs ETH vehicles 🧵

— Mippo 🟪 (@MikeIppolito_)  6:17 PM • Aug 27, 2025

x.com/i/article/1960…

— Infra | Raydium (@0xINFRA)  1:08 PM • Aug 26, 2025

Some interesting Nano Banana/Gemini 2.5 Flash Image use cases 👇🧵

— Google AI Developers (@googleaidevs)  11:31 PM • Aug 27, 2025
