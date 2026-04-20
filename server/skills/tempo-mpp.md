---
name: tempo-mpp
description: Builder skill for Tempo blockchain and Machine Payments Protocol (MPP). Use whenever building agents that pay for services, APIs that charge agents, monetized MCP servers, pay-per-call endpoints, streamed payment flows, or any agentic commerce integration. Trigger on mentions of "MPP", "mppx", "Tempo payments", "HTTP 402", "payment sessions", "agent wallet", "TIP-20", "PathUSD", "pay-as-you-go API", or building anything where machines pay machines. Covers the mppx TypeScript/Python/Rust SDKs, server middleware (Next.js, Hono, Elysia, Express), client fetch polyfill, MCP transport for paid tool calls, session-based streaming payments, Stripe MPP integration, and Tempo Wallet CLI.
---

# Tempo + MPP Builder Skill

> **For latest docs, always reference**: `https://mpp.dev/llms-full.txt`
> **MCP server** (for coding agents): `https://mpp.dev/api/mcp`

---

## 1. Mental Model

MPP wraps **HTTP 402 Payment Required** into a real protocol. Every paid interaction follows one loop:

```
Client → GET /resource
Server → 402 + Challenge (amount, methods, constraints)
Client → fulfills payment off-band
Client → GET /resource + Authorization: Payment <credential>
Server → 200 + resource + Payment-Receipt header
```

Two **intents** exist:
- **charge**: One-shot payment per request (like buying something)
- **session**: Streaming pay-as-you-go via off-chain vouchers (like a metered tab)

Two **transports** exist:
- **HTTP**: Challenge in `WWW-Authenticate` header, credential in `Authorization` header
- **MCP/JSON-RPC**: Challenge as error code `-32042`, credential in `_meta.org.paymentauth/credential`

---

## 2. Decision Tree: What Am I Building?

```
Are you PAYING for a service, or CHARGING for one?

PAYING (Client/Agent)
├── Simple agent that calls paid APIs → Section 3
├── App with a wallet that pays on user's behalf → Section 4
├── Agent that streams paid content (LLM tokens, SSE) → Section 5
└── Agent that calls paid MCP tools → Section 6

CHARGING (Server/Service)
├── One-time charge per API call → Section 7
├── Pay-as-you-go / metered billing → Section 8
├── Streamed content (SSE) with per-token billing → Section 9
├── Monetized MCP server (paid tool calls) → Section 10
└── Accept both crypto + fiat (Stripe) → Section 11
```

---

## 3. Agent Paying for Services (Simplest Path)

### Option A: Tempo Wallet CLI (recommended for agents)

```bash
# Create a funded testnet account
npx mppx account create

# Make a paid request
npx mppx https://mpp.dev/api/ping/paid
```

The **Tempo Wallet** (`wallet.tempo.xyz`) is the managed MPP client with built-in spend controls and service discovery.

### Option B: mppx in code

```bash
npm install mppx viem
```

```typescript
import { Mppx, tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

const account = privateKeyToAccount('0x...')

// Polyfill global fetch — all 402s handled automatically
Mppx.create({
  methods: [tempo({ account })],
})

// Now just fetch. Payment happens transparently.
const res = await fetch('https://some-paid-api.com/resource')
const data = await res.json()
```

That's it. The polyfill intercepts any 402, fulfills the payment challenge, and retries with the credential.

**For session-based (pay-as-you-go) APIs**, add `maxDeposit` to the config — the polyfill then manages the full channel lifecycle automatically:

```typescript
Mppx.create({
  methods: [tempo({
    account,
    maxDeposit: '1', // Lock up to 1 pathUSD per channel
  })],
})
```

---

## 4. App Client (Non-Polyfill / Manual Control)

Use when you want UI confirmation before paying, custom retry logic, or per-request accounts.

```typescript
import { Mppx, tempo } from 'mppx/client'
import { Receipt } from 'mppx'
import { privateKeyToAccount } from 'viem/accounts'

const mppx = Mppx.create({
  polyfill: false,  // Don't touch global fetch
  methods: [tempo()],
})

// 1. Hit the endpoint
const response = await fetch('https://api.example.com/data')

if (response.status === 402) {
  // 2. Show user the cost, get confirmation, then pay
  const credential = await mppx.createCredential(response, {
    account: privateKeyToAccount('0x...'),
  })

  // 3. Retry with payment proof
  const paidResponse = await fetch('https://api.example.com/data', {
    headers: { Authorization: credential },
  })

  // 4. Extract receipt
  const receipt = Receipt.fromResponse(paidResponse)
  console.log(receipt.status)     // 'success'
  console.log(receipt.reference)  // '0xtx789abc...'
}
```

### Per-request accounts

```typescript
const response = await mppx.fetch('https://api.example.com/data', {
  context: {
    account: privateKeyToAccount('0xDIFFERENT_KEY'),
  }
})
```

### Wagmi connector (browser wallets)

```typescript
import { createConfig, getConnectorClient } from 'wagmi'
import { tempoModerato } from 'viem/chains'

const config = createConfig({
  connectors,
  chains: [tempoModerato],
  transports: { [tempoModerato.id]: http() },
})

Mppx.create({
  methods: [tempo({
    getClient: (params) => getConnectorClient(config, params),
  })],
})
```

---

## 5. Streaming Payments (Client — SSE)

For consuming pay-per-token LLM APIs or any SSE endpoint:

```typescript
import { tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

const session = tempo.session({
  account: privateKeyToAccount('0x...'),
  maxDeposit: '1', // Lock up to 1 pathUSD per channel
})

// .sse() returns an async iterable of SSE data payloads
const stream = await session.sse('http://localhost:3000/api/sessions/poem')

for await (const word of stream) {
  process.stdout.write(word + ' ')
}

// Settle on-chain and reclaim unspent deposit
const receipt = await session.close()
```

Key mechanics:
- `tempo.session()` creates a session manager handling the full channel lifecycle: open, voucher signing, close.
- `.sse()` connects to the SSE endpoint. Automatically sends new vouchers when the server emits `payment-need-voucher` events.
- `maxDeposit: '1'` = locks up to 1 pathUSD. At $0.001/word, covers ~1,000 words.
- If balance depletes mid-stream, client auto-signs a new voucher — stream continues without interruption.
- Voucher verification is pure signature checks (~microseconds, no RPC calls).

---

## 6. Paid MCP Tool Calls (Client)

When your agent calls tools on a paid MCP server, the payment flow maps to JSON-RPC:

| HTTP Concept | MCP Encoding |
|---|---|
| 402 Challenge | JSON-RPC error `-32042` |
| Authorization header | `_meta.org.paymentauth/credential` |
| Payment-Receipt header | `_meta.org.paymentauth/receipt` |

```json
// 1. Agent calls tool
{
  "jsonrpc": "2.0", "id": 1,
  "method": "tools/call",
  "params": { "name": "web-search", "arguments": {"query": "MCP payments"} }
}

// 2. Server returns payment challenge
{
  "jsonrpc": "2.0", "id": 1,
  "error": {
    "code": -32042,
    "message": "Payment Required",
    "data": {
      "challenges": [{
        "id": "ch_abc123",
        "method": "tempo",
        "intent": "charge",
        "request": { "amount": "10", "currency": "usd", "recipient": "0xa726..." }
      }]
    }
  }
}

// 3. Agent retries with credential
{
  "jsonrpc": "2.0", "id": 2,
  "method": "tools/call",
  "params": {
    "name": "web-search",
    "arguments": {"query": "MCP payments"},
    "_meta": {
      "org.paymentauth/credential": {
        "challenge": { "..." : "..." },
        "source": "0x1234...",
        "payload": { "signature": "0xabc..." }
      }
    }
  }
}

// 4. Server returns result with receipt
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "content": [{"type": "text", "text": "Results..."}],
    "_meta": {
      "org.paymentauth/receipt": { "status": "success", "challengeId": "ch_abc123" }
    }
  }
}
```

---

## 7. Server: One-Time Charge per Request

### Framework middleware (recommended)

**Next.js:**
```typescript
import { Mppx, tempo } from 'mppx/nextjs'

const mppx = Mppx.create({
  methods: [tempo({
    currency: '0x20c0000000000000000000000000000000000000', // PathUSD
    recipient: '0xYOUR_ADDRESS',
  })],
})

export const GET =
  mppx.charge({ amount: '0.1' })
  (() => Response.json({ data: 'paid content' }))
```

**Hono, Elysia, Express**: Middleware also available via `mppx/hono`, `mppx/elysia`, and `mppx/express`. See `mpp.dev/quickstart/server` for framework-specific tab examples.

### Manual mode (Fetch API — works with any framework)

```typescript
import { Mppx, tempo } from 'mppx/server'

const mppx = Mppx.create({
  methods: [tempo({
    currency: '0x20c0000000000000000000000000000000000000',
    recipient: '0xYOUR_ADDRESS',
  })],
})

export async function handler(request: Request) {
  const response = await mppx.charge({ amount: '0.1' })(request)

  if (response.status === 402) return response.challenge
  return response.withReceipt(Response.json({ data: 'paid content' }))
}
```

### Node.js / Express (non-Fetch API)

```typescript
import { Mppx } from 'mppx/server'

export async function handler(req: IncomingMessage, res: ServerResponse) {
  const response = await Mppx.toNodeListener(
    mppx.charge({ amount: '0.1' })
  )(req, res)

  if (response.status === 402) return response.challenge
  return response.withReceipt(Response.json({ data: '...' }))
}
```

---

## 8. Server: Pay-As-You-Go Sessions

Sessions let clients open a payment channel once, then consume with off-chain vouchers. The server guide uses the same `mppx` patterns as one-time charges but with session intents.

**Server**: See the full framework-specific server setup at `https://mpp.dev/guides/pay-as-you-go`

**Client** (session via polyfill — simplest path):

```typescript
import { Mppx, tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

const mppx = Mppx.create({
  methods: [tempo({
    account: privateKeyToAccount('0x...'),
    maxDeposit: '1', // Lock up to 1 pathUSD per channel
  })],
})

// Each fetch automatically manages the session lifecycle:
// 1st request: opens channel on-chain, sends initial voucher
// 2nd+ requests: sends off-chain vouchers (no on-chain tx)
const res = await fetch('http://localhost:3000/api/sessions/photo')
```

**Client** (explicit channel management):

```typescript
import { tempo } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

const session = tempo.session({
  account: privateKeyToAccount('0x...'),
  maxDeposit: '1',
})

const res = await session.fetch('http://localhost:3000/api/sessions/photo')

// Settle on-chain and reclaim unspent deposit
const receipt = await session.close()
```

- `maxDeposit: '1'` locks up to 1 pathUSD. At $0.01/photo, covers up to 100 requests before the channel runs out.
- The client handles channel open, voucher signing, and retry after 402 automatically.
- Channels remain open for reuse — only close when done with the session entirely.

---

## 9. Server: Streamed Payments (SSE)

Charge per word/token as content streams. Server emits `payment-need-voucher` SSE events when channel balance runs low; client auto-signs new vouchers.

Full guide: `https://mpp.dev/guides/streamed-payments`

---

## 10. Monetized MCP Server

Same charge/session logic, but use JSON-RPC error `-32042` instead of HTTP 402 headers. The mppx SDK handles the transport mapping.

Full spec: `https://mpp.dev/protocol/transports/mcp`

---

## 11. Accept Crypto + Fiat (Stripe Integration)

Stripe users accept MPP payments via the PaymentIntents API:

```typescript
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-04.preview',  // Required
})

const paymentIntent = await stripe.paymentIntents.create({
  amount: 1,
  currency: 'usd',
  payment_method_types: ['crypto'],
  payment_method_data: { type: 'crypto' },
  payment_method_options: {
    crypto: {
      mode: 'deposit',
      deposit_options: { networks: ['tempo'] },
    },
  },
  confirm: true,
})
```

**Requirements:**
- Machine payments enabled on account (contact machine-payments@stripe.com)
- API version `2026-03-04.preview`
- US businesses only for stablecoin acceptance (customers pay from anywhere)
- Enable "Stablecoins and Crypto" in Dashboard → Payment methods

Stripe also supports fiat via **Shared Payment Tokens (SPTs)** — cards, wallets, BNPL.

Full docs: `https://docs.stripe.com/payments/machine/mpp`

---

## 12. Server Configuration Options

### Fee sponsorship (server pays gas for clients)

```typescript
tempo({
  currency: '0x20c0000000000000000000000000000000000000',
  recipient: '0xYOUR_ADDRESS',
  feePayer: privateKeyToAccount('0xSPONSOR_KEY'),
  // OR a relay service:
  // feePayer: 'https://sponsor.example.com',
})
```

### Optimistic verification (lower latency)

```typescript
tempo({
  ...,
  waitForConfirmation: false,  // Return after simulation, skip on-chain wait
})
```

⚠️ If the tx reverts on-chain after broadcast, the receipt won't reflect the failure.

### Push vs Pull mode

- **pull** (default): Client signs → server broadcasts (enables fee sponsorship)
- **push**: Client broadcasts → sends tx hash → server verifies

```typescript
tempo({ ..., mode: 'push' })
```

### Per-route overrides

```typescript
mppx.charge({
  amount: '0.5',
  currency: '0xDIFFERENT_TOKEN',
  recipient: '0xDIFFERENT_ADDRESS',
})
```

---

## 13. Testing

```bash
# Create a testnet account with funded tokens
npx mppx account create

# Hit your server
npx mppx http://localhost:3000/api/resource

# Debug: inspect the 402 challenge without paying
npx mppx --inspect http://localhost:3000/api/resource
```

**Stripe sandbox**: Sandbox PaymentIntents don't monitor crypto testnets. Use Stripe's test helper endpoint to simulate deposits.

**Tempo testnet**: See `docs.tempo.xyz` for RPC endpoints and faucet.

---

## 14. Key Constants

| Constant | Value |
|---|---|
| PathUSD address | `0x20c0000000000000000000000000000000000000` |
| TIP-20 transfer cost | < $0.001 |
| Block time | ~500ms |
| Finality | Deterministic (Simplex BFT) |
| MCP error code | `-32042` |
| Stripe API version | `2026-03-04.preview` |

---

## 15. SDKs

| Language | Package | Install |
|---|---|---|
| TypeScript | `mppx` | `npm install mppx viem` |
| Python | `pympp` | `pip install pympp` |
| Rust | `mpp-rs` | `cargo add mpp-rs` |

Framework middleware: `mppx/nextjs`, `mppx/hono`, `mppx/elysia`, `mppx/express`

---

## 16. LLM / Agent Integration Shortcuts

### Full docs in one URL (paste into any coding agent)
```
https://mpp.dev/llms-full.txt
```

### Install mppx skills for coding agents
```bash
npx skills install wevm/mppx -g
```

### Add MPP docs as MCP server to Claude Code
```bash
claude mcp add --transport http mpp https://mpp.dev/api/mcp
```

MCP tools available: `list_pages`, `read_page`, `search_docs`, `list_sources`, `list_source_files`, `read_source_file`, `get_file_tree`, `search_source`

### Copy-paste prompt templates

**Client setup:**
```
Reference https://mpp.dev/quickstart/client.md
Add mppx to my app as a client.
Polyfill the global fetch to automatically handle 402 Payment Required responses using the Tempo payment method.
Make a request to https://mpp.dev/api/ping/paid to test.
```

**Server setup:**
```
Reference https://mpp.dev/quickstart/server.md
Add mppx to my server with a /api/test route that charges $0.01 per request using the Tempo payment method with USDC.
Use the mppx CLI to test your endpoint.
```

---

## 17. Links

| Resource | URL |
|---|---|
| MPP docs | mpp.dev |
| Full LLM docs | mpp.dev/llms-full.txt |
| MPP specs repo | github.com/tempoxyz/mpp-specs |
| IETF spec | paymentauth.org |
| Tempo docs | docs.tempo.xyz |
| Tempo repo | github.com/tempoxyz/tempo |
| Stripe MPP docs | docs.stripe.com/payments/machine/mpp |
| Cloudflare MPP | developers.cloudflare.com/agents/agentic-payments/mpp/ |
| Services directory | mpp.dev/services |
| Tempo Wallet | wallet.tempo.xyz |
