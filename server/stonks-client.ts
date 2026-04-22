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

/**
 * Stonks /api/v1/fees/history caps `days` at 90. Any larger value returns
 * HTTP 500 with a Zod "too_big" error. Cap silently — callers asking for
 * 365d will still get the most recent 90d window, which is the best we can
 * serve until the API exposes pagination.
 */
const STONKS_MAX_DAYS = 90;
function capDays(days: number): number {
  return Math.max(1, Math.min(STONKS_MAX_DAYS, Math.floor(days)));
}

/**
 * Map common protocol slugs (as used in DeFiLlama / Hyperliquid) to the
 * deployer "name" field returned in stonksonchain rows. The stonks API uses
 * short tickers (xyz, cash, flx) while the rest of our system uses verbose
 * slugs (tradexyz, hyperliquid-cash). Extend this map as new deployers are
 * onboarded — falls back to the input slug on a miss.
 */
const DEPLOYER_SLUG_ALIASES: Record<string, string> = {
  tradexyz: "xyz",
  trade_xyz: "xyz",
  "trade-xyz": "xyz",
};
function deployerName(slug: string): string {
  const lc = slug.toLowerCase();
  return DEPLOYER_SLUG_ALIASES[lc] ?? lc;
}

/**
 * Extract a numeric field from a stonks deployer row. Tolerates both the
 * canonical names (volume / fees) and variant casings observed in the wild.
 */
function deployerNumber(row: any, ...candidates: string[]): number | null {
  for (const k of candidates) {
    const v = row?.[k];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  }
  return null;
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
 * Fetch the raw fees/history payload (capped at STONKS_MAX_DAYS). Returns
 * the array of daily rows. Each row exposes both ecosystem aggregates
 * (totalVolume, totalFees, hlContribution, etc.) and a nested
 * `deployers: [{name, volume, fees, deployerRevenue, hlContribution, ...}]`
 * array carrying the per-deployer breakdown.
 *
 * The `?coin=` query param is accepted by the API but DOES NOT filter the
 * response — the server always returns ecosystem-wide rows. Per-deployer
 * extraction must happen client-side via the nested `deployers` array.
 */
async function fetchFeesHistoryRows(days: number): Promise<any[]> {
  const capped = capDays(days);
  const json = await stonksFetch(`/api/v1/fees/history?days=${capped}`);
  return Array.isArray(json) ? json : Array.isArray(json?.history) ? json.history : Array.isArray(json?.data) ? json.data : [];
}

/**
 * Daily fees for a single HIP-3 deployer coin. Reads the nested
 * `deployers[]` array on each daily row, aliasing common slugs
 * (e.g. `tradexyz` → `xyz`) to the short ticker stonksonchain uses.
 * Returns date → fee USD. Empty Map if the deployer is not found.
 */
export async function getDeployerFeesHistory(
  coin: string,
  days: number = 90,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const target = deployerName(coin);
  const rows = await fetchFeesHistoryRows(days);
  for (const r of rows) {
    const d = rowDate(r);
    if (!d) continue;
    const deployers: any[] = Array.isArray(r.deployers) ? r.deployers : [];
    for (const dp of deployers) {
      const name = String(dp?.name ?? dp?.deployer ?? "").toLowerCase();
      if (name !== target) continue;
      const fees = deployerNumber(dp, "fees", "feesUsd", "fees_usd");
      if (fees == null || fees <= 0) continue;
      out.set(d, (out.get(d) ?? 0) + fees);
    }
  }
  return out;
}

/**
 * Daily notional volume for a single HIP-3 deployer coin. Same shape and
 * aliasing rules as getDeployerFeesHistory.
 */
export async function getDeployerVolumeHistory(
  coin: string,
  days: number = 90,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const target = deployerName(coin);
  const rows = await fetchFeesHistoryRows(days);
  for (const r of rows) {
    const d = rowDate(r);
    if (!d) continue;
    const deployers: any[] = Array.isArray(r.deployers) ? r.deployers : [];
    for (const dp of deployers) {
      const name = String(dp?.name ?? dp?.deployer ?? "").toLowerCase();
      if (name !== target) continue;
      const vol = deployerNumber(dp, "volume", "notionalVolume", "notional_volume", "volumeUsd", "volume_usd");
      if (vol == null || vol <= 0) continue;
      out.set(d, (out.get(d) ?? 0) + vol);
    }
  }
  return out;
}

/** Aggregate HIP-3 ecosystem daily fees across all deployers. */
export async function getHip3TotalFeesHistory(days: number = 90): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await fetchFeesHistoryRows(days);
  for (const r of rows) {
    const d = rowDate(r);
    if (!d) continue;
    const fees = rowNumber(r, "totalFees", "total_fees", "fees", "feesUsd", "fees_usd", "value");
    if (fees == null || fees <= 0) continue;
    out.set(d, (out.get(d) ?? 0) + fees);
  }
  return out;
}

/** Aggregate HIP-3 ecosystem daily volume across all deployers. */
export async function getHip3TotalVolumeHistory(days: number = 90): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await fetchFeesHistoryRows(days);
  for (const r of rows) {
    const d = rowDate(r);
    if (!d) continue;
    const vol = rowNumber(r, "totalVolume", "total_volume", "volume", "notionalVolume", "notional_volume", "volumeUsd", "volume_usd");
    if (vol == null || vol <= 0) continue;
    out.set(d, (out.get(d) ?? 0) + vol);
  }
  return out;
}
