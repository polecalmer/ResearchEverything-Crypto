# Allium API Reference

## Overview

Allium provides indexed blockchain data with full SQL access. Its key differentiator is
breadth of chain coverage, including non-EVM chains (Solana, Cosmos, Sui, Aptos) with
decoded tables -- something Dune's coverage is weaker on.

**Base URL:** `https://api.allium.so`
**Auth:** API key required (paid product, reach out for access)

---

## When to Use Allium Over Dune

| Scenario | Use Allium | Use Dune |
|---|---|---|
| Solana decoded IDL data | Better coverage | Limited |
| Cosmos / IBC msg types | Native support | Not available |
| Sui / Aptos analysis | Indexed | Not available |
| EVM decoded contracts | Either works | Larger community |
| Community dashboards | No equivalent | Dune dashboards |
| Spellbook abstractions | No equivalent | dex.trades, etc. |
| Cross-chain EVM + Solana | Unified schema | Separate schemas |
| Real-time / low latency | Generally faster | Cold start latency |

**Rule of thumb:** If it's EVM-only and Dune's Spellbook covers it, use Dune. If it involves
non-EVM chains or you need lower latency on raw data, use Allium.

---

## Chain Coverage

### EVM Chains
Ethereum, Arbitrum, Optimism, Base, Polygon, BNB Chain, Avalanche, Fantom,
zkSync Era, Linea, Scroll, Mantle, Blast, Mode, Celo, Gnosis, and more.

### Non-EVM Chains
- **Solana** -- Full transaction + instruction decoding, IDL-based table generation
- **Cosmos** -- IBC messages, staking, governance across Cosmos Hub, Osmosis, etc.
- **Sui** -- Move-based transaction decoding
- **Aptos** -- Move-based transaction decoding
- **Bitcoin** -- UTXO model, Ordinals, BRC-20

---

## Schema Patterns

### EVM Standard Tables

Similar to Dune's structure:

| Table Pattern | Description |
|---|---|
| `{chain}.raw_transactions` | All transactions |
| `{chain}.raw_logs` | Event logs |
| `{chain}.raw_traces` | Internal transactions |
| `{chain}.raw_blocks` | Block metadata |
| `{chain}.decoded_events` | Decoded event logs (ABI-based) |
| `{chain}.decoded_calls` | Decoded function calls |
| `{chain}.erc20_transfers` | Pre-extracted ERC20 transfers |
| `{chain}.erc721_transfers` | Pre-extracted NFT transfers |
| `{chain}.token_balances` | Computed token balances |

### Solana Tables

| Table | Description |
|---|---|
| `solana.raw_transactions` | Full transaction data |
| `solana.raw_instructions` | Program instructions (inner + outer) |
| `solana.decoded_instructions` | IDL-decoded instruction data |
| `solana.token_transfers` | SPL token transfer events |
| `solana.token_balances` | Account token balances |

**Solana-specific notes:**
- Instructions are the unit of work (vs. events on EVM)
- `program_id` is the Solana equivalent of `contract_address`
- IDL decoding maps instruction data to named fields (like Dune's ABI decoding)
- Account model: track balances via `token_balances`, not cumulative transfers

### Cosmos Tables

| Table | Description |
|---|---|
| `{cosmos_chain}.raw_transactions` | Transactions with msg array |
| `{cosmos_chain}.raw_messages` | Individual messages (decoded) |
| `{cosmos_chain}.ibc_transfers` | IBC transfer messages |
| `{cosmos_chain}.staking_events` | Delegate/undelegate/redelegate |

---

## Query Execution

Allium supports SQL queries via API:

```
POST /v1/query
{
  "sql": "SELECT * FROM ethereum.raw_transactions WHERE block_number > 19000000 LIMIT 10",
  "parameters": {}
}
```

Response is typically synchronous for fast queries, async with polling for heavy ones.

**Key differences from Dune:**
- Generally lower latency (no cold start queue)
- Results delivered as JSON or Parquet
- No concept of saved community queries -- you write SQL directly
- No Spellbook equivalent -- you work with raw/decoded tables and build your own abstractions

---

## Common Patterns

### Cross-Chain Token Flow (EVM + Solana)
```sql
SELECT 'ethereum' AS chain, from_address, to_address, value / 1e6 AS amount
FROM ethereum.erc20_transfers
WHERE token_address = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  AND block_timestamp >= '2025-01-01'

UNION ALL

SELECT 'solana' AS chain, source_owner, destination_owner, amount / 1e6 AS amount
FROM solana.token_transfers
WHERE mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  AND block_timestamp >= '2025-01-01'
```

### Solana Program Usage
```sql
SELECT
  DATE_TRUNC('day', block_timestamp) AS day,
  COUNT(*) AS instruction_count,
  COUNT(DISTINCT signer) AS unique_signers
FROM solana.decoded_instructions
WHERE program_id = '...'
  AND block_timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1
```

### IBC Transfer Volume (Cosmos)
```sql
SELECT
  DATE_TRUNC('day', block_timestamp) AS day,
  source_chain,
  destination_chain,
  SUM(amount) AS total_transferred
FROM osmosis.ibc_transfers
WHERE block_timestamp >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 1, 2, 3
ORDER BY 4 DESC
```

---

## Strengths vs. Weaknesses

**Strengths:**
- Widest chain coverage, especially non-EVM
- Lower query latency than Dune for most queries
- Unified schema across chains where possible
- Good for institutional/programmatic use cases
- Parquet export for large datasets

**Weaknesses:**
- No community dashboard layer (can't browse/fork other people's work)
- No Spellbook-style pre-built abstractions
- Paid only -- no free tier for casual use
- Smaller community = fewer examples/tutorials
- Documentation can be sparse for newer chain additions

---

## Best Practices

1. **Start with Dune if EVM-only** -- community queries and Spellbook save time
2. **Use Allium for cross-chain** -- unified SQL across EVM + Solana + Cosmos is powerful
3. **Use Allium for Solana IDL decoding** -- significantly better coverage than Dune
4. **Export to Parquet** for large analytical workloads instead of paginating JSON
5. **Check schema docs** for each chain -- column names vary between EVM and non-EVM
