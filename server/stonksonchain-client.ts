const STONKS_BASE = "https://stonksonchain.net/api/v1/fees";

function getApiKey(): string {
  const key = process.env.STONKS_API_KEY;
  if (!key) throw new Error("STONKS_API_KEY not configured");
  return key;
}

async function stonksFetch(endpoint: string): Promise<any> {
  const url = `${STONKS_BASE}/${endpoint}`;
  const res = await fetch(url, {
    headers: { "X-API-Key": getApiKey() },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`StonksOnChain ${endpoint} failed (${res.status}): ${body}`);
  }
  return res.json();
}

export function isStonksConfigured(): boolean {
  return !!process.env.STONKS_API_KEY;
}

export interface StonksSummary {
  timestamp: string;
  volume: { current24h: number; avg7d: number; avg14d: number };
  totalFees: {
    withGrowthMode: { estimated24h: number; estimated7dAvg: number; estimated14dAvg: number; avgFeeBps: number };
    withoutGrowthMode: { estimated24h: number; estimated7dAvg: number; estimated14dAvg: number; avgFeeBps: number };
  };
  deployerRevenue: {
    withGrowthMode: { estimated24h: number; estimated7dAvg: number; avgFeeBps: number };
    withoutGrowthMode: { estimated24h: number; estimated7dAvg: number; avgFeeBps: number };
  };
  hlContribution: {
    withGrowthMode: { total24h: number; haf24h: number; hlp24h: number; estimated7dAvg: number; avgFeeBps: number };
    withoutGrowthMode: { total24h: number; haf24h: number; hlp24h: number; estimated7dAvg: number; avgFeeBps: number };
  };
  growthModeImpact: { feeReductionPct: number; dailySavings: number; deployerRevenueLost: number; hlContributionLost: number };
  assets: { total: number; growthMode: number; nonGrowthMode: number };
  deployers: { name: string; revenueBps: { withGrowthMode: number; withoutGrowthMode: number }; hlContributionBps: { withGrowthMode: number; withoutGrowthMode: number } }[];
}

export interface DeployerRevenue {
  timestamp: string;
  totals: { volume24h: number; withGrowthMode: number; withoutGrowthMode: number };
  deployers: {
    name: string;
    fullName: string;
    feeScale: number;
    deployerSharePct: number;
    assetCount: number;
    growthModeAssets: number;
    volume24h: number;
    revenue: { withGrowthMode: number; withoutGrowthMode: number; effectiveFeeBps: { withGrowthMode: number; withoutGrowthMode: number } };
  }[];
}

export interface DeployerHlContribution {
  timestamp: string;
  totals: {
    volume24h: number;
    withGrowthMode: { total: number; haf: number; hlp: number };
    withoutGrowthMode: { total: number; haf: number; hlp: number };
  };
  deployers: {
    name: string;
    fullName: string;
    feeScale: number;
    assetCount: number;
    growthModeAssets: number;
    volume24h: number;
    hlContribution: {
      withGrowthMode: { total: number; haf: number; hlp: number };
      withoutGrowthMode: { total: number; haf: number; hlp: number };
      effectiveFeeBps: { withGrowthMode: number; withoutGrowthMode: number };
    };
  }[];
}

export interface AssetRevenue {
  timestamp: string;
  totalAssets: number;
  assets: {
    symbol: string;
    displayName: string;
    deployer: string;
    deployerFullName: string;
    feeScale: number;
    growthMode: boolean;
    volume24h: number;
    revenue: { withGrowthMode: number; withoutGrowthMode: number };
    effectiveFeeBps: { withGrowthMode: number; withoutGrowthMode: number };
  }[];
}

export interface AssetHlContribution {
  timestamp: string;
  totalAssets: number;
  assets: {
    symbol: string;
    displayName: string;
    deployer: string;
    deployerFullName: string;
    feeScale: number;
    growthMode: boolean;
    volume24h: number;
    hlContribution: {
      withGrowthMode: { total: number; haf: number; hlp: number };
      withoutGrowthMode: { total: number; haf: number; hlp: number };
    };
    effectiveFeeBps: { withGrowthMode: number; withoutGrowthMode: number };
  }[];
}

export async function getSummary(): Promise<StonksSummary> {
  return stonksFetch("summary");
}

export async function getDeployerRevenue(): Promise<DeployerRevenue> {
  return stonksFetch("deployer-revenue");
}

export async function getDeployerHlContribution(): Promise<DeployerHlContribution> {
  return stonksFetch("deployer-hl-contribution");
}

export async function getAssetRevenue(): Promise<AssetRevenue> {
  return stonksFetch("asset-revenue");
}

export async function getAssetHlContribution(): Promise<AssetHlContribution> {
  return stonksFetch("asset-hl-contribution");
}
