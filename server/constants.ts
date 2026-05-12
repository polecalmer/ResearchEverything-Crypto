export const WALLETS = {
  OWNER: "0x342fFFBcEbb761bC2c7B512333AF5E397b4cB72d",
  ESCROW: "0x33b901018174DDabE4841042ab76ba85D4e24f25",
  SERVER: "0x8518b315b3DFC4415Be7E75b2571Df635b27552a",
} as const;

export const TOKENS = {
  USDC: "0x20c000000000000000000000b9537d11c60e8b50",
  PATH_USD: "0x20c0000000000000000000000000000000000000",
} as const;

export const MODELS = {
  OPUS: "claude-opus-4-7",
  // Sonnet-tier work routes to Opus 4.6 — quality bump for the medium-tier
  // calls (agent main loop, chart extraction, chart shaper, reflection
  // intermediate rounds). Costs ~5× more than Sonnet per token; deliberate.
  // Revert to "claude-sonnet-4-6" if costs need to come back down.
  SONNET: "claude-opus-4-6",
  HAIKU: "claude-haiku-4-5",
} as const;

export const ADMIN_EMAILS = ["allmysubscriptions10@proton.me"] as const;
export const ADMIN_USERNAMES = ["polecalmer"] as const;

export const MPP_FLAT_FEE = "0.50";

export const EXTERNAL_URLS = {
  ANTHROPIC_MPP: "https://anthropic.mpp.tempo.xyz/v1/messages",
  OPENROUTER_MPP: "https://openrouter.mpp.tempo.xyz/v1/chat/completions",
  DUNE_MCP: "https://api.dune.com/mcp/v1",
  VOYAGE_EMBEDDINGS: "https://api.voyageai.com/v1/embeddings",
  TEMPO_RPC: "https://rpc.mainnet.tempo.xyz",
  TEMPO_EXPLORER: "https://explore.mainnet.tempo.xyz",
} as const;

// Direct OpenRouter endpoint (not via MPP). Used when LLM_PROVIDER=openrouter
// — see server/openrouter-client.ts. OpenRouter speaks OpenAI-compatible chat
// completions; the openrouter-client wrapper translates to/from Anthropic
// shape so call sites don't change.
export const OPENROUTER_DIRECT_URL = "https://openrouter.ai/api/v1/chat/completions";
