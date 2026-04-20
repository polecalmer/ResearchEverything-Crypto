---
source: blockworks
author: blockworks-0xresearch
date: 2025-12-18
url: https://blockworks-research.beehiiv.com/p/robinhood-s-parlay-moment
title: "Robinhood’s parlay moment"
type: article
tags: [crypto, defi, research]
---

# Robinhood’s parlay moment

Robinhood’s parlay moment

Hyperliquid at a crossroads

Kunal Doshi & Shaunda Devens December 18, 2025

Today’s newsletter ties two themes together: where revenue concentrates when markets become a consumer product, and what happens when execution becomes a commodity. We start with a risk-off tape across tech, crypto and miners, then zoom in on Robinhood’s prediction market roadmap and Hyperliquid’s broker-vs.-venue crossroads.

Markets closed with a clear risk-off tone yesterday. Gold was the lone bright spot, finishing up 0.8%, while the S&P 500 ended flat and the Nasdaq and BTC fell -1.38% and -1.89%, respectively. The underlying drivers remain unchanged, with continued rotation out of the AI trade weighing on tech-heavy indices. This time, sentiment was rattled by reports that a key Oracle investor pulled out of a data center project. Although Oracle later disputed the claim, the headline was enough to push already cautious investors further into defensive positioning.

That weakness spilled into crypto, with every sector finishing in the red. One surprising holdout was the meme index, which declined just -1.2% despite typically being one of the most sentiment sensitive sectors. The index found support from M (MemeCore), which was the only constituent to close green and gained 1.96% on the day.

The hardest hit sectors were Crypto Miners and AI, both down close to -9%. Miners continue to feel pressure from fears that the AI trade is rolling over, with IREN now down -31% over the past month. In the AI index, TAO was the weakest performer, falling -9% despite its recent halving.

Some hopium for the readers: Despite the negative market sentiment, BTC ETFs have flipped positive once again and notched $346.1M worth of inflows yesterday. Let’s hope this trend can continue for at least a few consecutive days to end the year off on a slightly positive note.

It feels like every other week brings a major development in prediction markets. This week it was Robinhood, which unveiled new prediction market features at its keynote event. The growing focus makes sense. Prediction markets have become Robinhood’s fastest growing product by revenue, with 11B contracts traded by more than 1M users.

Sports continue to be the clear driver. They now account for about 35% of volumes on Polymarket and close to 90% on Kalshi. If we annualize sports volumes from the past four weeks across both platforms, that comes out to roughly $74.5B. For context, FanDuel saw about $50.7B wagered in 2024 and DraftKings around $49.4B. Prediction markets are no longer a niche product. They are directly competing with established Web2 incumbents.

The final missing piece has been parlays. Parlays make up roughly 30% of sports betting volumes and nearly 60% of industry revenues. They bundle multiple wagers into a single bet, offering much higher payouts but with far lower odds of winning. This is precisely why they are so lucrative for platforms.

Robinhood is now moving aggressively into this territory. It announced that users will soon be able to trade combinations of outcomes, totals and spreads for individual NFL games. Looking ahead to early 2026, users will be able to create custom combinations of up to 10 outcomes for NFL games. Robinhood will also allow trading on individual player performance. This is a meaningful leap from the basic win/lose markets currently offered and opens the door to far more speculation and volume. Robinhood plans to extend these features beyond football and eventually beyond sports altogether.

The remaining question is how Robinhood chooses to build. Will these products be developed in partnership with Kalshi or brought fully in house? This question became more relevant after Robinhood’s recent plans to build proprietary prediction market infrastructure through a joint venture with Susquehanna International Group. Coinbase also entered the picture this week by announcing a partnership with Kalshi to roll out prediction markets to its users. The arms race is clearly underway.

Sports markets have found clear product-market fit this year. With distribution at scale and increasingly sophisticated products, Robinhood’s latest moves could give it a meaningful edge. If there were a market today for the prediction market leader by volume in 2026, my bet would be on Robinhood.

How are DeFi and traditional rails actually converging?

Join this live Roundtable to hear voices from Blockdaemon, Aave, and Circle hash it out!

Hyperliquid crossroads: Robinhood or Nasdaq economics

Hyperliquid is clearing Nasdaq-scale perp volume, but earning Nasdaq-scale economics. Over the last 30 days, it cleared $205.6B of perpetual notional (a $617B/quarter run-rate), yet generated only $80.3M of fees, about 3.9 bps.

It monetizes like a wholesale execution venue.

By contrast, Coinbase reported $295B of trading volume in Q3 2025 with $1,046M of transaction revenue, an implied 35.5 bps take rate.

Robinhood shows similar retail-style monetization on crypto: $268M of crypto trading revenue on $80B of crypto notional implies 33.5 bps, alongside $647B of equity notional in Q3 2025.

The gap is wider than fee rates because retail platforms monetize multiple surfaces. In Q3 2025, Robinhood generated $730M of transaction-based revenue, plus $456M of net interest revenue and $88M of other revenue (largely driven by Gold subscriptions).

Hyperliquid, on the other hand, is currently much more dependent on trading fees, and those fees are structurally single-digit bps at the protocol layer.

This is best explained as positioning: Coinbase and Robinhood are broker/distribution businesses with balance-sheet and subscription monetization, while Hyperliquid is closer to the exchange layer. In traditional market structure, the profit pool is split across two layers.

The core split in TradFi is distribution vs the market. Retail platforms like Robinhood and Coinbase sit in the distribution layer and capture the high-margin surfaces. Exchanges like Nasdaq sit in the market layer, where pricing power is structurally capped and execution is competed toward commodity economics.

1) Broker-dealer = distribution + customer balance sheet

Broker-dealers own the customer relationship. Most users do not access Nasdaq directly; they access markets through a broker that handles onboarding, custody, margin/risk, support, and tax docs, then routes orders to venues. That ownership creates monetization beyond trading:

Balances: cash sweep spread, margin lending, securities lending

Packaging: subscriptions, bundles, cards/advisory

Routing economics: the broker controls flow and can embed payments/revenue sharing in the routing chain

This is why brokers can out-earn venues: The profit pool sits where distribution and balances sit.

2) Exchange = matching + rulebook + infra, with capped take

Exchanges run the venue: matching, market rules, deterministic execution, and connectivity. They monetize via:

Transaction fees (competed down in liquid products)

Rebates/liquidity programs (often giving back most headline fees to win liquidity)

Market data, connectivity/colocation

Listings and index licensing

Robinhood’s routing shows the stack clearly: The broker owns the user (Robinhood Securities) and routes orders to third-party market centers, with routing economics shared across the chain. Distribution is the high-margin layer: It controls acquisition and monetization surfaces around execution (payment for order flow, margin, securities lending, subscriptions).

Nasdaq is the thin-margin layer. Its product is commoditized execution and queue access, and pricing power is mechanically capped because venues pay out headline fees as maker rebates to win liquidity, regulated access-fee caps limit what can be charged, and routing is hyper-elastic.

On Nasdaq’s disclosures, this shows up as thousandths of a dollar per share implied net cash equity capture.

The strategic consequence of these low margins is also evident in Nasdaq’s revenue mix. Market Services was $1,020M of $4,649M in 2024 (22%), down from 39.4% in 2014 and 35% in 2019, consistent with a pivot away from market-sensitive execution toward more recurring software/data businesses.

Hyperliquid’s 4 bps effective take rate is consistent with an intentional market-layer posture. It is building an onchain Nasdaq analog: a high-throughput matching, margining, and clearing stack (HyperCore) with maker/taker pricing and maker rebates, optimized for execution quality and shared liquidity rather than retail monetization.

That shows up in two TradFi-like separations that most crypto venues do not implement:

A) Permissionless broker/distribution layer (builder codes)Builder codes let third-party interfaces sit above the core venue and charge their own economics. Builder fees are capped at 0.1% (10 bps) on perps and 1% on spot, and can be set at the order level, creating a competitive marketplace for distribution rather than a single app monopoly.

B) Permissionless listing/product layer (HIP-3)

In TradFi, exchanges control listings and product creation. HIP-3 externalizes that function: Builders can deploy perps that inherit the HyperCore stack and API, while the deployer defines and operates the market. Economically, HIP-3 formalizes venue vs. product revenue sharing: Spot and HIP-3 perp deployers can keep up to 50% of trading fees on their deployed assets.

Builder codes have already been a distribution win; by mid-December, roughly a third of users were trading via third-party frontends rather than the native UI.

The problem is that the same structure that grows distribution predictably pressures the venue take:

Pricing compression: multiple frontends selling the same backend liquidity pushes competition toward lowest all-in cost; builder fees can be tuned per order, pushing pricing toward the floor.

Lost monetization surface: frontends own onboarding, bundling, subscriptions, and workflow; they capture broker-layer margin while Hyperliquid keeps the thinner venue-layer take.

Strategic routing risk: if frontends become true routers across venues, Hyperliquid gets forced into a wholesale execution race, defending flow by cutting fees or increasing rebates.

Hyperliquid is deliberately choosing the thin-margin market layer (Via Hip-3 and Buildercodes) while allowing a thick-margin broker layer to emerge above it. If builder frontends keep scaling, they will increasingly set user-facing economics, own retention surfaces and gain routing leverage, structurally pressuring Hyperliquid’s take rate over time.

The obvious risk is commoditization. If third-party frontends can consistently undercut the native UI and eventually route across venues, Hyperliquid gets pushed toward wholesale execution economics.

Recent design choices suggest Hyperliquid is trying to prevent that outcome while broadening where revenue can come from.

Distribution defense: Keep the native UI economically competitive

A proposed staking discount would have let builders earn up to a 40% discount by staking HYPE, creating a credible path for third-party frontends to be structurally cheaper than Hyperliquid’s own interface. Walking that back removes a direct subsidy for external distribution to price below the native UI. In parallel, HIP-3 markets were initially positioned as builder-distributed rather than surfaced on the main frontend, but they are now being listed on Hyperliquid’s native frontend under the strict list. The message is consistent: Hyperliquid is still permissionless at the builder layer, but it is not willing to compromise primary distribution.

USDH: shift from trade monetization to float monetization

USDH is a move to recapture stablecoin reserve yield that would otherwise accrue externally. The public structure is a 50/50 split of reserve yield, with 50% directed to Hyperliquid and 50% to USDH ecosystem growth. Trading fee discounts for USDH markets further reinforce the point: Hyperliquid is willing to compress per-trade economics in exchange for a larger, stickier profit pool tied to balances. In effect, it is adding an annuity-like revenue stream that can scale with the monetary base, not just with notional traded.

Portfolio margin: add prime-style financing economics

Portfolio margin unifies spot and perps margin, so exposures offset, and it introduces a native borrow/lend loop. Hyperliquid retains 10% of borrower interest paid, which makes protocol economics increasingly a function of leverage utilization and rates. That is closer to broker/prime economics than pure exchange economics.

Hyperliquid has already reached major-venue scale on throughput, but it still monetizes like the market layer: very large notional volume paired with a single-digit bps effective take rate. The gap vs. Coinbase and Robinhood is structural. Retail platforms sit at the broker layer, own the user relationship and balances, and monetize multiple profit pools (financing, idle cash, subscriptions). Pure venues sell execution, and execution is commoditized because liquidity and routing competition compress net capture. Nasdaq is the TradFi reference point for this constraint.

Hyperliquid initially leaned hard into the venue archetype. By separating distribution (builder codes) and product creation (HIP-3), it accelerated ecosystem growth and market coverage. The trade-off is that the same architecture can push economics outward: if third-party frontends set the all-in price and can route across venues, Hyperliquid risks becoming the wholesale rail that clears flow at thin margins.

However, recent moves read as a deliberate pivot to defend distribution and widen the revenue mix beyond per-trade fees. The protocol has become less willing to subsidize external frontends being structurally cheaper than the native UI, it is surfacing HIP-3 more natively, and it is adding balance-sheet style profit pools. USDH is an example of pulling reserve yield into the ecosystem (including a 50/50 split and fee discounts in USDH markets), while portfolio margin introduces financing economics through a 10% skim on borrower interest.

Hyperliquid is converging on a hybrid model: execution rails as the base, with distribution defense and balance-driven profit pools layered on top. That reduces the risk of being trapped as a wholesale, low-bps venue and moves it closer to a broker-style revenue mix without abandoning the core advantage of unified execution and clearing.

Going into 2026, the open question is whether Hyperliquid can move toward broker-style economics without breaking its outsourcing-friendly model. USDH is the clearest test: At roughly $100M supply, it suggests outsourced issuance scales slowly when the protocol does not control distribution. The obvious alternative would have been a UI-level default, for example auto-converting the roughly $4B USDC base into a native stablecoin (analogous to Binance’s BUSD auto-conversion). If Hyperliquid wants broker profit pools, it likely needs broker behaviors: more control, tighter native integration of house products, and clearer boundaries with ecosystem teams competing for the same distribution and balances.

DLNews, DefiLlama and DLResearch find that DeFi in 2025 transitioned from a reflexive speculative cycle into a more specialized and institutional shaped financial system. Stablecoins emerged as the monetary base layer, anchoring payments, trading collateral and treasury operations. Trading primitives converged into a single continuous stack spanning issuance, spot derivatives and event markets, while execution quality improved through solver-based routing and private channels at the cost of greater concentration. Credit and yield matured toward stablecoin native fixed income structures with RWAs as core collateral. The key divider was durability as protocols with strong execution, risk controls and treasury capacity pulled away from the rest.

x402: Early Signs of Agentic Commerce?

Lucas and Jing talk about how early x402 activity looks less like true agentic commerce and more like human driven experimentation and speculation. Their onchain analysis shows most transactions today are tied to memes gaming or infrastructure testing rather than autonomous agents paying each other. Still they argue this phase is a feature not a flaw since crypto often bootstraps new standards through speculative use before real demand emerges. The core takeaway is that x402 already works best for frequent low value micropayments and is laying the groundwork for future agent driven economies once discovery trust and standards mature.

Cantor: All Aboard the HYPE Train; Initiating Coverage of HYPD and PURR at OW

Cantor initiates OW on two Hyperliquid treasury vehicles, HYPD ($4 PT) and PURR ($5 PT), positioning them as public-market ways to get HYPE exposure (often harder to access on major CEXs). The thesis is that Hyperliquid is gaining share in perps and expanding via spot plus HIP-3, while ~99% of protocol fees flow into the Assistance Fund to buy back/burn HYPE, making fees akin to cash flow returned to holders (they cite ~$874M YTD 2025 fees on ~$2.9T volume and model a path toward multi-$bn annual fees over time). PURR owns 12.6M HYPE plus ~$300M cash and trades at ~0.77x adjusted mNAV; HYPD owns 1.72M HYPE and trades at ~1.14x adjusted mNAV with extra upside levers from staking/validator and HIP-3 fee participation, with risks centered on competition, no-KYC/regulatory constraints, and centralization/validator concentration.
