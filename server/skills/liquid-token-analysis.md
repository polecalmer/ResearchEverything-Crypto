---
name: liquid-token-analysis
description: >
  Comprehensive framework for analyzing liquid crypto tokens across valuation, classification,
  liquidity, on-chain behavior, and protocol-specific modeling. Use this skill whenever the user
  asks to value a token, classify tokens, assess liquidity risk, build a Dune dashboard for a
  protocol, calculate adjusted market cap, model buybacks/burns, estimate staking yields, compare
  token fundamentals, write an investment memo for a liquid token, or do any form of crypto token
  due diligence. Also trigger when the user mentions: P/E ratios for tokens, FDV vs market cap,
  token overhang, float analysis, liquidity discount, value accrual, fee revenue, buyback mechanisms,
  deflation thresholds, or protocol financial modeling. This skill encodes a battle-tested analytical
  stack built from months of applied token research.
---

# Liquid Token Analysis Framework

A full-stack analytical framework for evaluating liquid crypto tokens. This is not a generic primer — it encodes specific methodologies, formulas, classification criteria, and modeling patterns developed through extensive applied research across DeFi protocols, perpetual futures platforms, lending markets, and infrastructure tokens.

---

## Table of Contents

1. [Token Classification System](#1-token-classification-system)
2. [Supply & Adjusted Market Cap](#2-supply--adjusted-market-cap)
3. [Valuation Models](#3-valuation-models)
4. [Liquidity Analysis & Discount Model](#4-liquidity-analysis--discount-model)
5. [Value Accrual Mechanisms](#5-value-accrual-mechanisms)
6. [On-Chain Behavioral Analysis](#6-on-chain-behavioral-analysis)
7. [Protocol-Specific Model Templates](#7-protocol-specific-model-templates)
8. [Dune SQL Patterns](#8-dune-sql-patterns)
9. [Output Formats & Deliverables](#9-output-formats--deliverables)
10. [Critical Thinking Checklist](#10-critical-thinking-checklist)

---

## 1. Token Classification System

Every token under analysis must first be classified into one of four tiers. Classification determines which valuation methodology applies and what level of due diligence is warranted.

### Tier Definitions

**Tier 0 — Monetary Premium**

- No intrinsic value from protocol cash flows
- Trade on belief, narrative, lindyness, or moneyness
- Function as leading indicators of market risk appetite and liquidity conditions
- Crypto-native slot machines in primitive form, OR assets that have achieved monetary premium status
- Examples: BTC, DOGE, ETH (partially), ZEC, SOL (partially)
- Valuation approach: Do NOT apply cash flow models. Assess via network effects, holder distribution, liquidity depth, and relative momentum. Narrative durability matters more than fundamentals.

**Tier 1 — Great Tokens**

- Product behind the token has strong product-market fit (PMF)
- PMF drives fees that are high in absolute terms (not just percentage)
- Fees drive token value accrual either directly (staking/distribution) or indirectly (buybacks/burns)
- Token distribution is good — initial float ideally 25% to 45%
- Mimic traditional blue-chip equity
- Examples: HYPE
- Valuation approach: Full fundamental analysis — P/E, DCF, revenue multiples, comparable company analysis. Treat like a growth equity position.

**Tier 2 — Average Tokens**

- Product has some PMF, but scaling path is unclear
- Fees exist but notional amount is low relative to valuation
- Value accrual mechanism exists (direct or indirect)
- Token distribution needs to be good, initial float 25% to 45%
- Akin to small/mid-cap stocks with a path to success, though the path may be unclear
- Examples: PUMP, AERO, AAVE, SKY, ENA, SYRUP, META, MORPHO, JTO, HNT
- Valuation approach: Revenue multiples with scenario analysis. Heavier weight on growth trajectory and TAM capture probability. Monitor for upgrade to Tier 1 or downgrade to Tier 3.

**Tier 3 — Bad Tokens**

- No PMF, predatory tokenomics, low float with poor token engineering
- Bundled supply, malicious cap table, no revenues, no value accrual
- Everything else in crypto that doesn't fit Tiers 0-2
- Examples: MOVE, OM, MIRA
- Valuation approach: Do NOT waste time modeling. Flag and avoid. If encountered in portfolio, recommend exit.

### Classification Decision Tree

When classifying a token, evaluate in this order:

1. **Does the protocol generate meaningful recurring revenue?** No → Tier 0 or Tier 3
2. **If no revenue: does the token trade on monetary premium, lindyness, or deep network effects?** Yes → Tier 0. No → Tier 3.
3. **If revenue exists: is it high in absolute terms AND growing?** Yes → candidate for Tier 1. No → Tier 2.
4. **Is the token distribution fair (25-45% initial float, no malicious cap table)?** No → downgrade one tier or flag as Tier 3 regardless of revenue.
5. **Is there a clear value accrual mechanism linking fees to token holders?** No → downgrade one tier.

---

## 2. Supply & Adjusted Market Cap

### The Core Problem

FDV is too inclusive. Float-based market cap is too restrictive. Neither gives an accurate picture for investment sizing or relative comparison. Use Adjusted Market Cap as the primary valuation denominator.

### Arca Framework (Adopted Standard)

```
Float Market Cap     = Circulating Supply × Price
Adjusted Market Cap  = Outstanding Supply × Price
FDV                  = Max Supply × Price

Relationship: Float ≤ Adjusted MCAP ≤ FDV
```

### What Counts as "Outstanding Supply"

| Token Category | Float | Adj MCAP | FDV |
|---|---|---|---|
| Tokens in circulation | ✓ | ✓ | ✓ |
| Locked investor/VC tokens (set vesting) | ✗ | ✓ | ✓ |
| Team/advisor tokens (locked or not) | ✗ | ✓ | ✓ |
| Known scheduled unlocks with dates | ✗ | ✓ | ✓ |
| Unallocated treasury | ✗ | ✗ | ✓ |
| Vague future airdrops/grants | ✗ | ✗ | ✓ |
| Burned tokens | ✗ | ✗ | ✗ |

### Key Rule

If an airdrop or distribution is loosely promised but has no set date, it is NOT part of Adjusted MCAP. Once a set date and mechanism are established (removing subjectivity), it IS part of Adjusted MCAP.

### Supply Adjustment for Buybacks

Tokens bought back and burned reduce Outstanding Supply permanently. Tokens bought back and held in treasury are excluded from Outstanding Supply (treasury exclusion). Track both — the distinction matters for supply trajectory modeling.

### Building the Adjusted Supply Table

For each token in coverage, maintain a table with:

- Max/Total Supply
- Circulating Supply
- Adjusted Supply (with inclusion/exclusion rationale for each bucket)
- Adj Supply as % of Max
- Notes on upcoming unlock events, burn mechanisms, inflationary schedules

---

## 3. Valuation Models

### 3A. Cashflow Yield Model

The primary model for Tier 1 and Tier 2 tokens. Assumes 100% of protocol cashflows are distributed to stakers (theoretical baseline).

```
Base Yield           = Total Protocol Revenue (TPR) / Circulating Token Supply (CTS)
Actual Staking Yield = TPR / (CTS × Staking Participation Rate)
Token Fair Value     = TPR / (Required Yield × CTS)
```

**Example:**
- Protocol generates $10M annual revenue
- 100M circulating tokens
- You require 15% yield
- Base Yield = 10% (if everyone stakes)
- If 50% stake: Actual Yield = 20%
- Fair Value per token = $10M / (0.15 × 100M) = $0.67

**Key considerations:**
- Revenue sustainability and growth rate
- Revenue source quality (trading fees vs. one-time events vs. incentivized activity)
- Distribution mechanism (stablecoins > native token > inflationary emissions)
- Lock-up requirements affecting effective yield
- Risk adjustments: smart contract risk, regulatory, competition

### 3B. P/E and Revenue Multiples

For quick relative comparison across the token universe.

```
P/E (FDV basis)     = FDV / Annualized Net Revenue
P/E (Adj MCAP)      = Adjusted Market Cap / Annualized Net Revenue
P/S (Revenue mult)   = Market Cap / Annual Revenue
Yield Multiple       = Market Cap / Annual Revenue (lower = better value)
```

**Always calculate P/E on BOTH FDV and Adj MCAP basis.** The gap between the two reveals dilution risk. A token with 10x P/E on Adj MCAP but 30x on FDV has significant overhang.

### 3C. DCF Model

For deep-dive Tier 1 analysis. Use 3-year forward projections with three scenarios:

- **Bull Case**: Aggressive TAM capture, expanding margins, fee switch activation
- **Base Case**: Moderate growth consistent with current trajectory
- **Bear Case**: Revenue stagnation, competitive pressure, regulatory headwinds

**DCF structure:**
1. Project annual revenue for Years 1-3 under each scenario
2. Apply probability weights to scenarios
3. Apply terminal multiple on Year 3 earnings (15x-35x depending on growth)
4. Discount back to present at 20-40% (crypto risk premium)
5. Divide by Adjusted Supply for per-token fair value

### 3D. Comparable Analysis

When comparing tokens to TradFi peers (exchanges, fintech):

| Comparable | Typical P/E | Use For |
|---|---|---|
| CME Group | 20-25x | Derivatives exchanges |
| Nasdaq/ICE | 25-35x | Exchange infrastructure |
| Coinbase | 15-25x | Crypto exchanges |
| Tradeweb | 40-50x | Electronic trading |
| High-growth fintech | 30-50x | Revenue-accelerating protocols |

**Crypto discount factors to apply:**
- Token unlock overhang: -10% to -30% depending on schedule
- Regulatory uncertainty: -10% to -20%
- Smart contract risk: -5% to -15%
- Concentration risk (single revenue stream): -5% to -15%
- No legal claim on cash flows: -10% to -20%

---

## 4. Liquidity Analysis & Discount Model

### Why This Matters

A $500M market cap means nothing if you cannot sell 1% without moving the price significantly. Valuations must be marked down based on available liquidity.

### Core Metrics to Collect

For each token, gather:

- **Average Daily Volume (ADV)**: Use "real" volume only — filter wash trading. CoinGecko Pro or Kaiko preferred.
- **Order book depth**: Sum of bids at -2%, -5%, -10% from spot price
- **Bid-ask spread**: Wider spread = higher friction
- **Position size**: What you are actually trying to value/exit

### Participation Rate Exit Model

```
Days to Liquidate = Position Size / (ADV × Participation Rate)
```

Conservative participation rates (% of ADV you can trade without material impact):
- 5-10% for small caps
- 10-20% for mid caps
- 20-30% for majors (BTC, ETH, SOL)

### Liquidity Discount Tiers

| Days to Exit | Suggested Discount |
|---|---|
| < 5 days | 0-5% |
| 5-15 days | 5-15% |
| 15-30 days | 15-25% |
| 30-60 days | 25-40% |
| 60+ days | 40%+ |

### Price Impact (Slippage) Model

```
Slippage ≈ k × (Trade Size / Order Book Depth)^α
```

Where α is typically 0.5-1.0 (square root impact model from market microstructure literature).

```
Liquidity-Adjusted Value = Nominal Value × (1 - Expected Slippage)
```

### Secondary Market Liquidity Test

For tokens with withdrawal windows (e.g., syrupUSDC 30-day window), test whether secondary market swap cost is less than the opportunity cost of waiting:

```
Swap cost      = Slippage + Pool fee (e.g., 0.08%)
Opportunity cost = (Window days / 365) × Current yield
Breakeven slippage = Opportunity cost - Pool fee
```

If swap cost < opportunity cost, the withdrawal window is a soft constraint, not a hard one.

### Data Sources (Ranked by Accuracy)

1. **Kaiko** (institutional grade, paid): Best for CEX order book depth, slippage estimates, real volume
2. **CoinGecko Pro** (paid): `cost_to_move_up_usd`, `cost_to_move_down_usd` (±2% depth), bid-ask spread, DEX pool data via GeckoTerminal
3. **Dune Analytics** (free/paid): On-chain DEX volume, pool reserves, swap event analysis
4. **DefiLlama** (free): Protocol-level volume aggregation, TVL data

---

## 5. Value Accrual Mechanisms

### Mechanism Types (Ranked by Strength)

**Direct distribution (strongest):**
- Protocol revenue paid directly to stakers in stablecoins or ETH
- Example: Fee-sharing to staked token holders
- Valuation: Treat as dividend yield

**Buyback and burn (strong):**
- Protocol uses revenue to buy tokens on open market and burn them
- Reduces Outstanding Supply permanently → deflationary pressure
- Example: HYPE — 97% of fees used for continuous TWAP buyback when AF balance > 10,000 USDC
- Valuation: Model as EPS accretion via supply reduction

**Buyback and hold (moderate):**
- Protocol buys tokens but holds in treasury (not burned)
- Creates buy pressure but does not reduce supply
- Valuation: Price support floor, but less structural than burn

**Indirect accrual (weaker):**
- Fees go to protocol treasury, governance decides allocation
- Token holders have theoretical claim but no guaranteed distribution
- Valuation: Apply governance discount (tokens ≠ equity, no legal claim)

**No accrual (none):**
- Fees exist but do not flow to token holders in any mechanism
- Token value derives entirely from speculation or governance utility
- Valuation: Tier 3 candidate unless other compelling factors exist

### Deflation Threshold (P*) — For Burn Mechanisms

For protocols where usage burns tokens against ongoing emissions (e.g., Helium):

```
P* = Total Revenue (USD) / Total Token Emissions

If market price > P*  → Network is deflationary
If market price < P*  → Network is inflationary
If market price = P*  → Break-even
```

P* is the unit economics price floor — below P*, the protocol dilutes holders faster than usage burns supply. Track P* over time as a key health metric.

---

## 6. On-Chain Behavioral Analysis

### What On-Chain Data Adds

Market microstructure data (price, volume, order books) tells you what IS happening. On-chain data tells you WHO is doing it and WHY. The two layers together produce higher-conviction analysis.

### Key On-Chain Analyses

**Wallet concentration and distribution:**
- Track top holder percentages over time
- Monitor large wallet movements (whale tracking)
- Flag abnormal concentration (>30% in <10 wallets excluding protocol contracts)

**Unlock and vesting tracking:**
- Monitor upcoming token unlocks with specific dates
- Track whether unlocked tokens are being sold, staked, or held
- Build unlock calendar and overlay with price action

**Buyback verification:**
- Verify that claimed buybacks are actually happening on-chain
- Track buyback wallet addresses and TWAP patterns
- Compare claimed buyback amounts to actual on-chain flows
- Watch for new buyback wallets being rotated in (e.g., PUMP rotated wallets ~Aug 2025)

**DEX behavior post-event:**
- After ICOs, airdrops, or unlocks: track whether recipients sell immediately on DEX or hold
- Measure "overbidder" behavior (users who bid more than they receive, signaling conviction)
- Track DEX rebuy patterns (users who sold then bought back)

**Treasury flows:**
- Monitor protocol treasury balances over time
- Track inflows (revenue) vs. outflows (expenses, grants, buybacks)
- Use Gnosis Safe multisig tracking where applicable (track ERC-20 transfers to/from known treasury addresses)

### Dune Query Patterns for Behavioral Analysis

See Section 8 for reusable SQL templates.

---

## 7. Protocol-Specific Model Templates

### 7A. Perpetual Futures DEX (e.g., Hyperliquid)

**Revenue drivers:**
- Daily trading volume × take rate (fees in bps)
- Open interest as capacity indicator
- Liquidation revenue (supplementary)

**Key metrics:**
- P/E on Adj MCAP basis
- Revenue per employee (efficiency metric)
- Market share of perp DEX volume
- OI-to-Volume ratio (capital efficiency signal)

**TAM expansion modeling:**
- Current crypto perp TAM
- Equity/index perps TAM capture scenarios (rate × capture %)
- Sensitivity matrix: capture rate × take rate → implied revenue

**Model structure (5 sheets):**
1. Assumptions (blue cells = inputs)
2. Revenue Scenarios (capture rate matrix)
3. Valuation (P/E at FDV and Adj MCAP, implied prices at various multiples)
4. Sensitivity (two-way tables)
5. Summary (executive dashboard)

### 7B. Lending Protocol (e.g., Maple/SYRUP)

**Revenue drivers:**
- Total loans outstanding × weighted average interest rate
- Origination fees
- Net interest margin

**Key metrics:**
- Book value vs. market cap
- Loan default rate
- Utilization rate
- Secondary market liquidity for yield-bearing tokens (e.g., syrupUSDC)

**Special analysis:**
- Withdrawal window vs. secondary market swap cost (Section 4)
- Pool TVL trajectory and depositor concentration

### 7C. Burn/Emission Protocol (e.g., Helium/HNT)

**Revenue drivers:**
- Data credit consumption (DC burn)
- Network growth driving usage

**Key metrics:**
- P* deflation threshold price
- Monthly emissions vs. monthly burns (net inflation/deflation)
- DC burn rate growth

**Critical distinction:**
- Track when HNT is burned to MINT DCs (actual supply destruction), not when DCs are consumed (usage metric). The burn happens at mint time, not consumption time.

### 7D. DEX / AMM (e.g., Aerodrome/AERO)

**Revenue drivers:**
- Trading volume × fee tier
- Bribe revenue (for ve-model DEXes)
- LP incentive efficiency

**Key metrics:**
- TVL and volume/TVL ratio
- Fee revenue to veToken holders
- Emissions schedule and dilution trajectory

### 7E. Revenue Aggregator (e.g., PUMP)

**Revenue drivers:**
- Platform fees from token launches and trading
- Protocol fee split between treasury, buybacks, and operations

**Key metrics:**
- Daily revenue from each product line (e.g., PumpFun launches + PumpSwap DEX fees)
- Buyback execution rate (target vs. actual, e.g., 25% of revenue)
- Rolling 7-day and 30-day averages
- Buyback T+1 timing (buybacks execute day after revenue collection)

---

## 8. Dune SQL Patterns

### Revenue Tracking (Daily/Weekly/Monthly with Growth)

```sql
WITH daily_revenue AS (
    SELECT
        DATE_TRUNC('day', block_time) AS day,
        SUM(fee_amount_usd) AS revenue
    FROM protocol_specific_table
    WHERE block_time >= CURRENT_DATE - INTERVAL '180' DAY
    GROUP BY 1
),
weekly AS (
    SELECT
        DATE_TRUNC('week', day) AS week,
        SUM(revenue) AS weekly_revenue,
        LAG(SUM(revenue)) OVER (ORDER BY DATE_TRUNC('week', day)) AS prev_week_revenue
    FROM daily_revenue
    GROUP BY 1
)
SELECT
    week,
    weekly_revenue,
    prev_week_revenue,
    (weekly_revenue - prev_week_revenue) / NULLIF(prev_week_revenue, 0) * 100 AS wow_growth_pct
FROM weekly
ORDER BY week DESC
```

### Token Balance Tracking (Treasury/Reserve Fund)

```sql
WITH flows AS (
    SELECT
        DATE_TRUNC('month', block_date) AS month,
        SUM(CASE
            WHEN "to" = {{treasury_address}} THEN CAST(amount_usd AS DOUBLE)
            WHEN "from" = {{treasury_address}} THEN -CAST(amount_usd AS DOUBLE)
        END) AS net_flow_usd
    FROM tokens_{{chain}}.transfers
    WHERE ("to" = {{treasury_address}} OR "from" = {{treasury_address}})
        AND block_date >= CURRENT_DATE - INTERVAL '12' MONTH
    GROUP BY 1
)
SELECT
    month,
    net_flow_usd,
    SUM(net_flow_usd) OVER (ORDER BY month) AS cumulative_balance_usd
FROM flows
ORDER BY month
```

### Buyback Verification

```sql
WITH buybacks AS (
    SELECT
        DATE_TRUNC('day', block_time) AS day,
        SUM(token_bought_amount) AS tokens_bought,
        SUM(token_bought_amount_usd) AS usd_spent
    FROM dex.trades
    WHERE taker IN ({{buyback_wallet_1}}, {{buyback_wallet_2}})
        AND token_bought_address = {{protocol_token_address}}
    GROUP BY 1
)
SELECT * FROM buybacks ORDER BY day DESC
```

### Wallet Distribution / Concentration

```sql
WITH balances AS (
    SELECT
        wallet,
        SUM(net_amount) AS balance
    FROM (
        SELECT "to" AS wallet, CAST(value AS DOUBLE)/1e{{decimals}} AS net_amount
        FROM erc20_{{chain}}.evt_Transfer
        WHERE contract_address = {{token_address}}
        UNION ALL
        SELECT "from" AS wallet, -CAST(value AS DOUBLE)/1e{{decimals}} AS net_amount
        FROM erc20_{{chain}}.evt_Transfer
        WHERE contract_address = {{token_address}}
    )
    GROUP BY 1
    HAVING SUM(net_amount) > 0
)
SELECT
    CASE
        WHEN balance >= 1000000 THEN 'Whale (>1M)'
        WHEN balance >= 100000 THEN 'Large (100K-1M)'
        WHEN balance >= 10000 THEN 'Medium (10K-100K)'
        ELSE 'Small (<10K)'
    END AS tier,
    COUNT(*) AS wallets,
    SUM(balance) AS total_tokens,
    SUM(balance) / (SELECT SUM(balance) FROM balances) * 100 AS pct_supply
FROM balances
GROUP BY 1
ORDER BY total_tokens DESC
```

### Net Emissions (Inflation/Deflation Tracking)

```sql
WITH monthly AS (
    SELECT
        DATE_TRUNC('month', day) AS month,
        SUM(emissions_tokens) AS total_emissions,
        SUM(burns_usd) AS total_burn_usd,
        SUM(emissions_tokens) AS total_emission_tokens
    FROM protocol_emission_data
    GROUP BY 1
)
SELECT
    month,
    total_emissions,
    total_burn_usd,
    total_burn_usd / NULLIF(total_emission_tokens, 0) AS p_star_threshold,
    total_burn_usd - (total_emission_tokens * {{current_price}}) AS net_inflation_usd
FROM monthly
ORDER BY month DESC
```

---

## 9. Output Formats & Deliverables

### Investment Memo (Tier 1/2 tokens)

Structure:
1. Executive Summary (classification tier, thesis in 2-3 sentences)
2. Protocol Overview (what it does, revenue model)
3. Token Mechanics (supply schedule, value accrual, adjusted supply table)
4. Financial Analysis (revenue trajectory, P/E, yield model, DCF if Tier 1)
5. Liquidity Assessment (days to exit, discount, depth analysis)
6. On-Chain Signals (holder distribution, buyback verification, whale activity)
7. Risk Matrix (regulatory, smart contract, competition, concentration, unlock schedule)
8. Monitoring Framework (key metrics to track, thresholds for thesis invalidation)

### Excel Financial Model

Standard structure:
- **Assumptions tab**: All inputs in blue cells, formula-driven
- **Revenue Projections**: Bear/Base/Bull scenarios with CAGR
- **Valuation Outputs**: P/E, P/S, DCF, implied price at various multiples
- **Sensitivity Tables**: Two-way tables (growth rate × multiple, capture rate × take rate)
- **Summary Dashboard**: Executive-level key metrics

### Dune Dashboard

Standard panels:
- Daily/weekly/monthly revenue with WoW/MoM growth
- Cumulative revenue since inception
- Buyback tracking (if applicable)
- Treasury/reserve balance over time
- P/E ratio overlay (requires price feed)
- Net emissions / deflation tracker (if applicable)

### Quick Comparison Table

For portfolio-level analysis across multiple tokens:

| Token | Tier | Adj MCAP | Ann Rev | P/E (Adj) | Yield | Days to Exit ($1M) | Liq Discount | Accrual Type |
|---|---|---|---|---|---|---|---|---|

---

## 10. Critical Thinking Checklist

Apply these checks to every token analysis. These are failure modes observed in real crypto research:

1. **Survivorship bias**: Showing top-11 protocol revenues doesn't tell you the base rate of success. What % of tokens with revenue at launch still have meaningful revenue 2 years later?

2. **Equity-token false equivalence**: Tokens have no legal claim on revenues, no governance rights that matter in practice, and protocols can change fee switches or tokenomics arbitrarily. Do not assume equity-like protections exist.

3. **Unfalsifiable frameworks**: If your thesis explains both price going up AND price going down, it has no predictive power. Every claim should have a clear invalidation condition.

4. **Liquid venture contradiction**: Criticizing "liquid venture" while simultaneously advocating buying tokens of revenue-generating protocols at "cheap" multiples IS liquid venture. Be honest about what you are doing.

5. **Narrative vs. mechanism**: "Buybacks are bullish" is narrative. "97% of $X revenue executes as TWAP buy, reducing float by Y% annually" is mechanism. Always ground claims in mechanism.

6. **Overhang math**: $3-6B in locked supply hits the market monthly across crypto. Early investors up 10-1000x have every incentive to sell. Factor this into every analysis — it is the single most common source of structural downward pressure.

7. **Revenue quality**: Is revenue organic or incentivized? Revenue from liquidity mining or points programs is not the same as revenue from genuine user demand. Adjust accordingly.

8. **Cyclicality masquerading as decline**: Strong protocols see tokens drop 50% simply because BTC is down, despite growing revenues. Separate cyclical drawdowns from fundamental deterioration.

9. **Data source integrity**: Volume data in crypto is notoriously dirty. Always question whether volume figures are real. Prefer Kaiko or CoinGecko Pro over exchange-reported numbers. For on-chain data, verify contract addresses and understand the difference between raw event tables and curated datasets.

10. **The $0 terminal value test**: If the protocol shut down tomorrow, what would token holders receive? For most tokens, the answer is nothing. This is the fundamental difference from equity and should be reflected in your required return / discount rate.

---

## Design Preferences

When producing visual outputs (charts, dashboards, presentations) for this framework:

- **Chart style**: 1kx-inspired — dark background (#1C1C1C), 3-5 colors (navy/teal/purple), minimal grids, clean sans-serif typography, left-aligned titles, generous whitespace, no chart frames
- **Presentation style**: Robinhood-inspired — dark bg, neon lime (#C8FF00) accents, flat design, zero decorative shapes
- **Tables**: Clean, no heavy borders, alternating row shading, right-aligned numbers, left-aligned labels
- **Excel models**: Blue cells for inputs, black for formulas, green for outputs. All formula-driven with zero hardcoded intermediary values.
