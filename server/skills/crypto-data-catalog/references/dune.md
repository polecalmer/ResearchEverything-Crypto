# Dune Analytics API Reference

## Overview

Dune provides SQL access to decoded on-chain data. Best for bespoke analysis that
pre-built APIs don't cover: holder distributions, wallet behavior, contract-level events,
custom cohort analysis, and anything requiring joins across on-chain tables.

**Base URL:** `https://api.dune.com/api/v1`
**Auth:** `x-dune-api-key` header

---

## API Workflow

Dune's API has two main patterns:

### Pattern 1: Execute a Query (write your own SQL)

```
1. POST /query/{query_id}/execute         -> Triggers execution, returns execution_id
2. GET  /execution/{execution_id}/status   -> Poll until state = "QUERY_STATE_COMPLETED"
3. GET  /execution/{execution_id}/results  -> Fetch results (paginated)
```

Or use the convenience endpoint:
```
POST /query/{query_id}/execute/result     -> Blocks until complete, returns results directly
```

**To create/save a query:** Use the Dune UI to create and save a query, get the `query_id` from the URL.
**Parameterized queries:** Pass params in the execute body:
```json
{
  "query_parameters": {
    "protocol_name": "aave",
    "start_date": "2025-01-01"
  }
}
```

### Pattern 2: Use Pre-built Queries

Many community queries already exist. Search `dune.com/browse/queries` for what you need.
Use their `query_id` directly via the API to avoid writing SQL from scratch.

---

## Key Tables & Schemas

### Ethereum Core

| Table | Description | Key Columns |
|---|---|---|
| `ethereum.transactions` | All transactions | `hash`, `from`, `to`, `value`, `gas_price`, `block_time` |
| `ethereum.traces` | Internal transactions | `from`, `to`, `value`, `type`, `call_type` |
| `ethereum.logs` | Raw event logs | `contract_address`, `topic0..3`, `data` |
| `ethereum.blocks` | Block metadata | `number`, `time`, `base_fee_per_gas`, `gas_used` |
| `ethereum.contracts` | Deployed contracts | `address`, `name`, `namespace` |

### Decoded Tables (Protocol-Specific)

Decoded tables follow the pattern: `{protocol}_{chain}.{contract}_{event/call}`

Examples:
- `uniswap_v3_ethereum.Pair_evt_Swap` -- Uniswap V3 swap events
- `aave_v3_ethereum.Pool_evt_Supply` -- Aave V3 deposit events
- `lido_ethereum.stETH_evt_Transfer` -- stETH transfer events

**Finding decoded tables:**
1. Search Dune's table explorer: `dune.com/data`
2. Pattern: `{namespace}_{chain}.{ContractName}_evt_{EventName}`
3. `_evt_` = events, `_call_` = function calls

### Spellbook (Curated Abstractions)

Spellbook tables are community-maintained, pre-joined, clean tables.

| Table | Description |
|---|---|
| `dex.trades` | Normalized DEX trades across all DEXes and chains |
| `nft.trades` | Normalized NFT trades |
| `tokens.erc20` | ERC20 token metadata (symbol, decimals, address) |
| `tokens.transfers` | ERC20 transfer events, enriched |
| `prices.usd` | Token prices (minute granularity, major tokens) |
| `balances.erc20_daily` | Daily token balances per address |
| `labels.all` | Address labels (exchanges, protocols, whales, etc.) |

**`prices.usd` is critical** -- use it to convert on-chain amounts to USD:
```sql
SELECT
  t.block_time,
  t.amount_raw / pow(10, tk.decimals) * p.price AS amount_usd
FROM transfers t
JOIN tokens.erc20 tk ON t.token_address = tk.contract_address
JOIN prices.usd p ON p.contract_address = t.token_address
  AND p.minute = date_trunc('minute', t.block_time)
```

### Multi-Chain

Same table structures exist for other chains:
- `arbitrum.transactions`, `optimism.transactions`, `polygon.transactions`, `base.transactions`
- `solana.transactions` (different schema -- account-based)
- Decoded tables: `uniswap_v3_arbitrum.Pair_evt_Swap`, etc.

---

## Common Query Patterns

### Holder Distribution
```sql
WITH balances AS (
  SELECT
    "to" AS address,
    SUM(CAST(value AS DOUBLE)) / 1e18 AS received
  FROM erc20_ethereum.evt_Transfer
  WHERE contract_address = 0x...
  GROUP BY 1
),
sent AS (
  SELECT
    "from" AS address,
    SUM(CAST(value AS DOUBLE)) / 1e18 AS sent_amount
  FROM erc20_ethereum.evt_Transfer
  WHERE contract_address = 0x...
  GROUP BY 1
)
SELECT
  b.address,
  COALESCE(b.received, 0) - COALESCE(s.sent_amount, 0) AS balance
FROM balances b
LEFT JOIN sent s ON b.address = s.address
ORDER BY balance DESC
LIMIT 100
```

### Protocol Daily Users
```sql
SELECT
  date_trunc('day', block_time) AS day,
  COUNT(DISTINCT "from") AS unique_users
FROM {protocol}_{chain}.{Contract}_evt_{Event}
WHERE block_time >= NOW() - INTERVAL '30' DAY
GROUP BY 1
ORDER BY 1
```

### DEX Volume (using Spellbook)
```sql
SELECT
  date_trunc('day', block_time) AS day,
  project,
  SUM(amount_usd) AS volume
FROM dex.trades
WHERE blockchain = 'ethereum'
  AND block_time >= NOW() - INTERVAL '7' DAY
GROUP BY 1, 2
ORDER BY 1, 3 DESC
```

---

## Credit Optimization

Free tier = 2,500 credits/month. Credits are consumed per query execution.

**Strategies:**
1. **Use existing query IDs** -- executing someone else's saved query costs credits but saves writing time
2. **Filter early** -- Push WHERE clauses as deep as possible, especially `block_time` ranges
3. **Limit result sets** -- Use LIMIT, don't pull 1M rows if you need 100
4. **Cache results** -- API results include `execution_id`; re-fetch results without re-executing
5. **Use materialized views** -- Some Spellbook tables are pre-computed, much cheaper
6. **Batch analysis** -- One complex query is cheaper than 10 simple ones

**Execution time tips:**
- Add `block_time` filters -- Dune partitions by time, this drastically speeds queries
- Avoid `SELECT *` on raw tables
- Use `LIMIT` during development, remove for production
- Cross-chain joins are expensive -- query per chain if possible

---

## API Response Format

```json
{
  "execution_id": "...",
  "state": "QUERY_STATE_COMPLETED",
  "result": {
    "rows": [
      { "column1": "value1", "column2": 123 }
    ],
    "metadata": {
      "column_names": ["column1", "column2"],
      "result_set_bytes": 1234,
      "total_row_count": 100
    }
  }
}
```

Pagination: use `?limit=1000&offset=0` on results endpoint.

---

## Known Limitations

- Cold query execution: 30-120s typical, can be longer for complex queries
- Decoded tables lag for new/small protocols (may not exist)
- `prices.usd` doesn't cover all tokens -- small/new tokens may be missing
- Solana table schemas differ significantly from EVM chains
- Free tier: 2,500 credits, 10 concurrent executions, limited API calls
- Query results expire after some time -- re-execute if stale
- No real-time streaming -- polling-based execution model
