/**
 * StonksOnChain HTTP client.
 *
 * Specialist source for HIP-3 deployer analytics on Hyperliquid. Auth via
 * x-api-key header. Endpoints documented in
 * server/data-source-brain/seed/stonksonchain.ts.
 *
 * All series-returning methods produce a Map<isoDate, number> so they are
 * drop-in compatible with `fetchSourceData` consumers in derived-metrics.ts.
 */

const STONKS_BASE = "https://stonksonchain.net";
const API_KEY = process.env.STONKS_API_KEY?.trim() || "";

if (!API_KEY) {
  console.warn("[StonksOnChain] STONKS_API_KEY not set — stonksonchain fetches will fail with 401.");
}

async function stonksFetch(path: string, init?: RequestInit): Promise<any> {
  const url = `${STONKS_BASE}${path}`;
  const headers: Record<string, string> = {
    "x-api-key": API_KEY,
    "accept": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  const maxAttempts = 3;
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, { ...init, headers });
      if (resp.status === 429 || resp.status >= 500) {
        const wait = 250 * attempt * attempt;
        await new Promise((r) => setTimeout(r, wait));
        lastErr = new Error(`stonksonchain ${resp.status} ${resp.statusText}`);
        continue;
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`stonksonchain ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`);
      }
      return await resp.json();
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("stonksonchain request failed");
}

/** Coerce a row's date field (epoch s/ms or ISO string) to ISO yyyy-mm-dd. */
function rowDate(row: any): string | null {
  const raw = row.date ?? row.timestamp ?? row.ts ?? row.day ?? row.time;
  if (raw == null) return null;
  if (typeof raw === "number") {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof raw === "string") {
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      const ms = n < 1e12 ? n * 1000 : n;
      return new Date(ms).toISOString().slice(0, 10);
    }
    // ISO yyyy-mm-dd or full ISO timestamp.
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function rowNumber(row: any, ...candidates: string[]): number | null {
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

/**
 * Daily fees for a single HIP-3 deployer coin. Tries `?coin=<coin>&days=<n>`
 * first; if the response is aggregate-only, falls back to filtering rows by
 * `coin`/`symbol`/`deployer` fields. Returns date → fee USD.
 */
export async function getDeployerFeesHistory(
  coin: string,
  days: number = 365,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const target = coin.toLowerCase();
  const json = await stonksFetch(`/api/v1/fees/history?days=${days}&coin=${encodeURIComponent(coin)}`);
  const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.history) ? json.history : [];
  for (const r of rows) {
    const d = rowDate(r);
    if (!d) continue;
    const matchCoin = (r.coin ?? r.symbol ?? r.deployer ?? r.ticker);
    if (matchCoin && String(matchCoin).toLowerCase() !== target) continue;
    const fees = rowNumber(r, "fees", "fee", "feesUsd", "fees_usd", "value", "amount");
    if (fees == null || fees <= 0) continue;
    out.set(d, (out.get(d) ?? 0) + fees);
  }
  return out;
}

/**
 * Daily volume for a single HIP-3 deployer coin. Stonks returns volume on the
 * same fees/history payload for many endpoints; we extract the volume column
 * if present, otherwise fall back to the per-coin /api/market-quality endpoint
 * which exposes a notional-volume time series.
 */
export async function getDeployerVolumeHistory(
  coin: string,
  days: number = 365,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const target = coin.toLowerCase();
  // Try fees/history first — it often carries `notionalVolume` per row.
  try {
    const json = await stonksFetch(`/api/v1/fees/history?days=${days}&coin=${encodeURIComponent(coin)}`);
    const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.history) ? json.history : [];
    for (const r of rows) {
      const d = rowDate(r);
      if (!d) continue;
      const matchCoin = (r.coin ?? r.symbol ?? r.deployer ?? r.ticker);
      if (matchCoin && String(matchCoin).toLowerCase() !== target) continue;
      const vol = rowNumber(r, "volume", "notionalVolume", "notional_volume", "volumeUsd", "volume_usd");
      if (vol == null || vol <= 0) continue;
      out.set(d, (out.get(d) ?? 0) + vol);
    }
    if (out.size > 0) return out;
  } catch (e: any) {
    console.log(`[StonksOnChain] fees/history volume probe failed for ${coin}: ${e.message}`);
  }
  // Fallback: /api/market-quality/:coin (intraday — bucket to daily).
  try {
    const json = await stonksFetch(`/api/market-quality/${encodeURIComponent(coin)}`);
    const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    const daily = new Map<string, number>();
    for (const r of rows) {
      const d = rowDate(r);
      if (!d) continue;
      const vol = rowNumber(r, "volume", "notionalVolume", "notional_volume", "volumeUsd", "volume_usd");
      if (vol == null || vol <= 0) continue;
      daily.set(d, (daily.get(d) ?? 0) + vol);
    }
    return daily;
  } catch (e: any) {
    console.log(`[StonksOnChain] market-quality fallback failed for ${coin}: ${e.message}`);
    return out;
  }
}

/** Aggregate HIP-3 ecosystem daily fees across all deployers. */
export async function getHip3TotalFeesHistory(days: number = 365): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const json = await stonksFetch(`/api/v1/fees/history?days=${days}`);
  const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.history) ? json.history : [];
  for (const r of rows) {
    const d = rowDate(r);
    if (!d) continue;
    const fees = rowNumber(r, "fees", "fee", "feesUsd", "fees_usd", "totalFees", "total_fees", "value");
    if (fees == null || fees <= 0) continue;
    out.set(d, (out.get(d) ?? 0) + fees);
  }
  return out;
}

/** Aggregate HIP-3 ecosystem daily volume across all deployers. */
export async function getHip3TotalVolumeHistory(days: number = 365): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const json = await stonksFetch(`/api/v1/fees/history?days=${days}`);
  const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.history) ? json.history : [];
  for (const r of rows) {
    const d = rowDate(r);
    if (!d) continue;
    const vol = rowNumber(r, "volume", "notionalVolume", "notional_volume", "volumeUsd", "volume_usd", "totalVolume");
    if (vol == null || vol <= 0) continue;
    out.set(d, (out.get(d) ?? 0) + vol);
  }
  return out;
}
