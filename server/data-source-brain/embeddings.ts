/**
 * Embeddings provider — Voyage AI (Anthropic-recommended for Claude apps).
 *
 * Model: voyage-3.5 @ 1024 dimensions, normalized (cosine-ready).
 * Voyage supports input_type to specialise the embedding for the use case;
 * "document" for stored facts, "query" for retrieval. Using both improves
 * retrieval quality measurably.
 *
 * Swap path: replace the fetch URL/model below to move to a different
 * provider. The {dim, normalized} contract and the (text|texts, kind) API
 * are the only things callers depend on.
 */

export const EMBEDDING_DIM = 1024;
const MODEL = "voyage-3.5";
const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

export type EmbeddingKind = "document" | "query";

function getKey(): string {
  const k = process.env.VOYAGE_API_KEY;
  if (!k) throw new Error("VOYAGE_API_KEY is not set");
  return k;
}

async function callVoyage(input: string | string[], kind: EmbeddingKind): Promise<number[][]> {
  // Retry on 429 with exponential backoff. Voyage free tier is 3 RPM until a
  // payment method is added; production should add billing to remove this ceiling.
  const maxAttempts = 4;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${getKey()}`,
      },
      body: JSON.stringify({
        input,
        model: MODEL,
        input_type: kind,
        output_dimension: EMBEDDING_DIM,
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    }
    lastErr = await res.text().catch(() => "");
    if (res.status !== 429 || attempt === maxAttempts - 1) {
      throw new Error(`Voyage embeddings ${res.status}: ${lastErr.slice(0, 200)}`);
    }
    // 429 — back off: 1s, 4s, 12s
    const delay = [1000, 4000, 12000][attempt] ?? 12000;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Voyage embeddings retries exhausted: ${lastErr.slice(0, 200)}`);
}

export async function embed(text: string, kind: EmbeddingKind = "document"): Promise<number[]> {
  const [vec] = await callVoyage(text, kind);
  return vec;
}

export async function embedBatch(texts: string[], kind: EmbeddingKind = "document"): Promise<number[][]> {
  if (texts.length === 0) return [];
  return callVoyage(texts, kind);
}
