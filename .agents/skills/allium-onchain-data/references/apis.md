# Allium API Reference

**Base URL:** `https://api.allium.so`
**Rate limit:** 1/second. No batching workaround — respect it or get 429s.

---

## Supported Chains Discovery

**Call once per session** before any `/developer/` endpoint. Returns all endpoints and their chains in one response — cache it, don't re-call. Not needed for Explorer SQL or Docs endpoints.

```bash
curl "https://api.allium.so/api/v1/supported-chains/realtime-apis/simple"
```

**Response:** Map of endpoint path → array of supported chain names.

```json
{
  "/api/v1/developer/prices": ["arbitrum", "avalanche", "bsc", "base", "ethereum", "solana", ...],
  "/api/v1/developer/wallet/balances": ["arbitrum", "base", "bitcoin", "ethereum", "solana", ...],
  "/api/v1/developer/wallet/transactions": ["abstract", "arbitrum", "ethereum", "solana", ...],
  "/api/v1/developer/wallet/pnl": ["bitcoin", "ethereum", "solana"]
}
```

Use this to validate chain support before making data calls. Chain coverage varies per endpoint — e.g. `pnl` only supports 3 chains while `transactions` supports 20+.

---

## Token Prices

### Current Price

```bash
curl -X POST "https://api.allium.so/api/v1/developer/prices" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '[{"token_address": "0x...", "chain": "ethereum"}]'
```

**Response:**

```json
[
	{
		"chain": "ethereum",
		"address": "0x...",
		"price": 72154.48,
		"decimals": 8,
		"info": { "name": "Token Name", "symbol": "TKN" },
		"attributes": {
			"price_diff_1d": -3840.06,
			"price_diff_pct_1d": -5.05,
			"volume_usd_1d": 432014155.32
		}
	}
]
```

---

### Historical Prices (OHLCV)

**Different format than current price.** Don't copy-paste and change the endpoint — it will 422.

```bash
curl -X POST "https://api.allium.so/api/v1/developer/prices/history" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '{
    "addresses": [{"token_address": "0x...", "chain": "ethereum"}],
    "start_timestamp": 1706572800,
    "end_timestamp": 1707177600,
    "time_granularity": "1d"
  }'
```

| Field              | Required | Notes                                     |
| ------------------ | -------- | ----------------------------------------- |
| `addresses`        | Yes      | Array of `{token_address, chain}` objects |
| `start_timestamp`  | Yes      | Unix seconds                              |
| `end_timestamp`    | Yes      | Unix seconds                              |
| `time_granularity` | Yes      | `1m`, `5m`, `15m`, `1h`, `4h`, `1d`       |

**Response:**

```json
{
	"items": [
		{
			"mint": "0x...",
			"chain": "ethereum",
			"prices": [
				{
					"timestamp": "2024-01-30T00:00:00Z",
					"open": 83977.26,
					"high": 84504.82,
					"low": 74370.21,
					"close": 83889.4,
					"price": 83925.23
				}
			]
		}
	]
}
```

---

### Price at Timestamp

```bash
curl -X POST "https://api.allium.so/api/v1/developer/prices/at-timestamp" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '{"token_address": "0x...", "chain": "ethereum", "timestamp": 1706572800}'
```

---

### Price Stats

```bash
curl -X POST "https://api.allium.so/api/v1/developer/prices/stats" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '[{"token_address": "0x...", "chain": "ethereum"}]'
```

---

## Token Lookup

### Token Info by Address

```bash
curl -X POST "https://api.allium.so/api/v1/developer/tokens/chain-address" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '[{"token_address": "0x...", "chain": "ethereum"}]'
```

### List Tokens

```bash
curl -X GET "https://api.allium.so/api/v1/developer/tokens" \
  -H "X-API-KEY: $API_KEY"
```

### Token Search

Don't know the address? Search first:

```bash
curl "https://api.allium.so/api/v1/developer/tokens/search?q=bitcoin" \
  -H "X-API-KEY: $API_KEY"
```

Returns array of matches with addresses and chains.

---

## Wallet Data

All wallet endpoints take the same format:

```bash
curl -X POST "https://api.allium.so/api/v1/developer/wallet/{endpoint}" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '[{"chain": "ethereum", "address": "0xWALLET..."}]'
```

| Endpoint            | Returns                        |
| ------------------- | ------------------------------ |
| `/balances`         | Token holdings with USD values |
| `/balances/history` | Balance snapshots over time    |
| `/transactions`     | Transaction history            |
| `/pnl`              | Profit/loss by token           |

---

## Explorer API (SQL)

For custom analytics. Uses `query_id` from registration — not just `api_key`.

### Create Query (Existing Users Without query_id)

Existing API key holders need to create a query first to get a `query_id`:

```bash
curl -X POST "https://api.allium.so/api/v1/explorer/queries" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '{
    "title": "Custom SQL Query",
    "config": {
      "sql": "{{ sql_query }}",
      "limit": 10000
    }
  }'
# Returns: {"query_id": "..."}
# Store it — needed for all run-async calls.
```

`{{ sql_query }}` is a placeholder substituted at runtime via `parameters.sql_query`.

---

### Start Query

```bash
curl -X POST "https://api.allium.so/api/v1/explorer/queries/${QUERY_ID}/run-async" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: $API_KEY" \
  -d '{"parameters": {"sql_query": "SELECT * FROM ethereum.raw.blocks LIMIT 10"}}'
# Returns: {"run_id": "..."}
```

### Poll for Results

Queries are async. Poll until `status: success`:

```bash
# Check status
curl "https://api.allium.so/api/v1/explorer/query-runs/${RUN_ID}/status" \
  -H "X-API-KEY: $API_KEY"

# Get results (only when status=success)
curl "https://api.allium.so/api/v1/explorer/query-runs/${RUN_ID}/results?f=json" \
  -H "X-API-KEY: $API_KEY"
```

**Status progression:** `created` → `queued` → `running` → `success` | `failed`

### Browse Schema

Don't guess table names:

```bash
# List databases
curl "https://api.allium.so/api/v1/docs/schemas/browse?path=" -H "X-API-KEY: $API_KEY"

# List tables
curl "https://api.allium.so/api/v1/docs/schemas/browse?path=ethereum.raw" -H "X-API-KEY: $API_KEY"

# Semantic search for table names
curl "https://api.allium.so/api/v1/docs/schemas/search?q=nft+transfers" -H "X-API-KEY: $API_KEY"
```

---

## Errors

| Status | Meaning           | Fix                                             |
| ------ | ----------------- | ----------------------------------------------- |
| 400    | Bad request       | Check JSON syntax                               |
| 401    | Unauthorized      | Check API key                                   |
| 422    | Validation failed | **Check request format** — common with /history |
| 429    | Rate limited      | Wait 1 second                                   |
| 500    | Server error      | Retry with backoff                              |

---

## Documentation & Schema Discovery

Three endpoints for finding docs and table schemas. Use these before guessing.

| Endpoint                      | Method | Purpose                                |
| ----------------------------- | ------ | -------------------------------------- |
| `/api/v1/docs/docs/browse`    | GET    | Browse doc hierarchy like a filesystem |
| `/api/v1/docs/schemas/browse` | GET    | Browse databases → schemas → tables    |
| `/api/v1/docs/schemas/search` | GET    | Semantic search for table names        |

### Browse Docs

```bash
# List root directories
curl "https://api.allium.so/api/v1/docs/docs/browse?path=" -H "X-API-KEY: $API_KEY"

# List files in a directory
curl "https://api.allium.so/api/v1/docs/docs/browse?path=api/developer" -H "X-API-KEY: $API_KEY"

# Get file content (truncated to 5000 chars)
curl "https://api.allium.so/api/v1/docs/docs/browse?path=api/overview.mdx" -H "X-API-KEY: $API_KEY"
```

### Browse Schemas

Don't guess table names — browse them:

```bash
# List all databases
curl "https://api.allium.so/api/v1/docs/schemas/browse?path=" -H "X-API-KEY: $API_KEY"

# List tables in a schema
curl "https://api.allium.so/api/v1/docs/schemas/browse?path=ethereum.raw" -H "X-API-KEY: $API_KEY"

# Get full table details (columns, types)
curl "https://api.allium.so/api/v1/docs/schemas/browse?path=ethereum.raw.blocks" -H "X-API-KEY: $API_KEY"
```

### Search Schemas

Find tables by meaning, not exact name:

```bash
curl "https://api.allium.so/api/v1/docs/schemas/search?q=DEX+trades+swaps" -H "X-API-KEY: $API_KEY"
```

Returns table name matches. Feed these into Browse Schemas for column details.
