import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const ALLIUM_CLI_PATH = path.join(
  process.env.HOME || "/home/runner",
  "workspace/.local/share/../bin/allium"
);

const CLI_ENV = {
  ...process.env,
  PATH: `${path.dirname(ALLIUM_CLI_PATH)}:${process.env.HOME}/.local/bin:${process.env.PATH}`,
};

let alliumCliQueue: Promise<void> = Promise.resolve();

function serializeAlliumCall<T>(fn: () => Promise<T>): Promise<T> {
  const result = alliumCliQueue.then(fn, fn);
  alliumCliQueue = result.then(() => {}, () => {});
  return result;
}

async function runAlliumCliOnce(args: string[], timeoutMs: number): Promise<any> {
  const { stdout, stderr } = await execFileAsync(ALLIUM_CLI_PATH, args, {
    env: CLI_ENV,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const jsonStr = stdout.trim();
  if (!jsonStr) {
    throw new Error("Empty response from Allium CLI");
  }

  return JSON.parse(jsonStr);
}

async function runAlliumCli(args: string[], timeoutMs = 90000): Promise<any> {
  const maxRetries = 3;

  return serializeAlliumCall(async () => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await runAlliumCliOnce(args, timeoutMs);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          throw new Error("Allium CLI not installed. Run setup first.");
        }
        if (err.killed) {
          throw new Error("Allium query timed out");
        }
        const msg = err.stderr || err.message || "Unknown Allium CLI error";
        const isPaymentError = msg.includes("Payment settlement failed") || msg.includes("authorization header");

        if (isPaymentError && attempt < maxRetries) {
          console.warn(`[Allium] Payment settlement failed (attempt ${attempt}/${maxRetries}), retrying in ${attempt * 2}s...`);
          await new Promise(r => setTimeout(r, attempt * 2000));
          continue;
        }

        if (msg.includes("failed")) {
          throw new Error(`Allium query failed: ${msg}`);
        }
        throw new Error(`Allium CLI error: ${msg}`);
      }
    }
  });
}

export interface AlliumPricePoint {
  timestamp: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export async function fetchAlliumPriceHistory(
  chain: string,
  tokenAddress: string,
  startDate: string,
  endDate: string,
  granularity: string = "1d"
): Promise<AlliumPricePoint[]> {
  const result = await runAlliumCli([
    "realtime", "prices", "history",
    "--chain", chain.toLowerCase(),
    "--token-address", tokenAddress,
    "--start-timestamp", startDate,
    "--end-timestamp", endDate,
    "--time-granularity", granularity,
    "--format", "json",
  ]);

  if (!result?.items?.[0]?.prices) {
    return [];
  }

  return result.items[0].prices;
}

export async function fetchAlliumLatestPrice(
  chain: string,
  tokenAddress: string
): Promise<{ price: number; timestamp: string } | null> {
  const result = await runAlliumCli([
    "realtime", "prices", "latest",
    "--chain", chain.toLowerCase(),
    "--token-address", tokenAddress,
    "--format", "json",
  ]);

  if (!result?.items?.[0]) return null;

  const item = result.items[0];
  return { price: item.price, timestamp: item.timestamp };
}

export async function fetchAlliumPriceStats(
  chain: string,
  tokenAddress: string
): Promise<any> {
  const result = await runAlliumCli([
    "realtime", "prices", "stats",
    "--chain", chain.toLowerCase(),
    "--token-address", tokenAddress,
    "--format", "json",
  ]);

  return result?.items?.[0] || null;
}

export async function fetchAlliumWalletBalances(
  chain: string,
  walletAddress: string
): Promise<any[]> {
  const result = await runAlliumCli([
    "realtime", "balances", "latest",
    "--chain", chain.toLowerCase(),
    "--address", walletAddress,
    "--format", "json",
  ]);

  return result?.items || [];
}

export async function fetchAlliumTokenSearch(
  query: string,
  chain?: string,
  limit: number = 10
): Promise<any[]> {
  const args = [
    "realtime", "tokens", "search",
    "-q", query,
    "--limit", String(limit),
    "--format", "json",
  ];
  if (chain) {
    args.push("--chain", chain.toLowerCase());
  }

  const result = await runAlliumCli(args);
  return result?.items || [];
}

export interface AlliumSqlResult {
  sql: string;
  data: Record<string, any>[];
  meta: {
    columns: { name: string; data_type: string }[];
    row_count: number;
    run_id: string;
  };
  queried_at: string;
}

const ALLOWED_CHAINS = new Set([
  "ethereum", "hyperevm", "base", "arbitrum", "optimism", "polygon",
  "bsc", "avalanche", "solana", "scroll", "linea", "blast", "berachain",
  "unichain", "worldchain", "soneium", "ink", "core", "vana", "tron",
  "bitcoin", "sui", "b3", "plasma", "x_layer",
]);

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function validateChain(chain: string): string {
  const normalized = chain.toLowerCase().trim();
  if (!ALLOWED_CHAINS.has(normalized)) {
    throw new Error(`Invalid chain: ${chain}. Allowed: ${[...ALLOWED_CHAINS].join(", ")}`);
  }
  return normalized;
}

function validateTokenAddress(address: string, chain: string): string {
  const trimmed = address.trim();
  if (chain === "solana") {
    if (!SOLANA_ADDRESS_RE.test(trimmed)) {
      throw new Error(`Invalid Solana token address: ${trimmed}`);
    }
  } else {
    if (!EVM_ADDRESS_RE.test(trimmed)) {
      throw new Error(`Invalid EVM token address: ${trimmed}`);
    }
  }
  return trimmed.toLowerCase();
}

function sanitizeSql(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");

  if (/;\s*\S/.test(trimmed)) {
    throw new Error("Multiple SQL statements not allowed");
  }

  const upper = trimmed.toUpperCase();
  if (!upper.startsWith("SELECT")) {
    throw new Error("Only SELECT queries are allowed");
  }

  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i;
  if (forbidden.test(trimmed)) {
    throw new Error("Forbidden SQL operation detected");
  }

  return trimmed;
}

export async function runAlliumSql(
  sql: string,
  limit: number = 100
): Promise<AlliumSqlResult> {
  const safeSql = sanitizeSql(sql);
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 500);

  const result = await runAlliumCli([
    "explorer", "run-sql",
    "--limit", String(safeLimit),
    "--format", "json",
    safeSql,
  ], 120000);

  return result;
}

const CHAIN_TOKEN_MAP: Record<string, { chain: string; address: string }> = {
  eth: { chain: "ethereum", address: "0x0000000000000000000000000000000000000000" },
  weth: { chain: "ethereum", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  usdc: { chain: "ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  sol: { chain: "solana", address: "So11111111111111111111111111111111111111112" },
  hype: { chain: "hyperevm", address: "0x5555555555555555555555555555555555555555" },
  btc: { chain: "ethereum", address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" },
};

export function resolveTokenForAllium(
  ticker: string,
  chain?: string,
  contractAddress?: string
): { chain: string; address: string } | null {
  if (chain && contractAddress) {
    return { chain: chain.toLowerCase(), address: contractAddress };
  }

  const known = CHAIN_TOKEN_MAP[ticker.toLowerCase()];
  if (known) return known;

  return null;
}

export function buildHolderDistributionSql(
  chain: string,
  tokenAddress: string,
  minBalance?: number,
  limit: number = 50
): string {
  const safeChain = validateChain(chain);
  const safeAddr = validateTokenAddress(tokenAddress, safeChain);
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 500);
  const safeBal = minBalance != null ? Math.max(0, Number(minBalance)) : null;
  const balanceFilter = safeBal != null ? `AND balance >= ${safeBal}` : "AND balance > 0";
  return `SELECT address, balance FROM ${safeChain}.assets.fungible_balances_latest WHERE token_address = '${safeAddr}' ${balanceFilter} ORDER BY balance DESC LIMIT ${safeLimit}`;
}

export function buildHolderCountSql(
  chain: string,
  tokenAddress: string,
  thresholds: number[] = [0, 100, 1000, 10000, 100000]
): string {
  const safeChain = validateChain(chain);
  const safeAddr = validateTokenAddress(tokenAddress, safeChain);
  const safeThresholds = thresholds.map(t => Math.max(0, Math.floor(Number(t)))).slice(0, 10);

  const cases = safeThresholds.map((t, i) => {
    const next = safeThresholds[i + 1];
    if (!next) return `COUNT(CASE WHEN balance >= ${t} THEN 1 END) as holders_gte_${t}`;
    return `COUNT(CASE WHEN balance >= ${t} AND balance < ${next} THEN 1 END) as holders_${t}_to_${next}`;
  }).join(",\n  ");

  return `SELECT
  COUNT(*) as total_holders,
  ${cases}
FROM ${safeChain}.assets.fungible_balances_latest
WHERE token_address = '${safeAddr}'
AND balance > 0`;
}

export function buildDailyHolderTrendSql(
  chain: string,
  tokenAddress: string,
  daysBack: number = 30
): string {
  const safeChain = validateChain(chain);
  const safeAddr = validateTokenAddress(tokenAddress, safeChain);
  const safeDays = Math.min(Math.max(1, Math.floor(daysBack)), 365);
  return `SELECT
  date,
  COUNT(DISTINCT CASE WHEN balance > 0 THEN address END) as holder_count
FROM ${safeChain}.assets.fungible_balances_daily
WHERE token_address = '${safeAddr}'
AND date >= DATEADD(day, -${safeDays}, CURRENT_DATE())
GROUP BY date
ORDER BY date`;
}

export async function isAlliumConfigured(): Promise<boolean> {
  try {
    await execFileAsync(ALLIUM_CLI_PATH, ["auth", "list"], {
      env: CLI_ENV,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}
