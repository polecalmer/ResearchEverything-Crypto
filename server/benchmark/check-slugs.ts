/**
 * One-off script to check DeFiLlama data availability for failing protocols.
 * Run: npx tsx --require dotenv/config server/benchmark/check-slugs.ts
 */

const slugsToCheck: [string, string, string][] = [
  // [protocol, slug, 'fees'|'revenue']
  ["WBTC", "wbtc", "fees"], ["WBTC", "wbtc", "revenue"],
  ["Tether Gold", "tether-gold", "fees"], ["Tether Gold", "tether-gold", "revenue"],
  ["Lombard LBTC", "lombard", "fees"], ["Lombard LBTC", "lombard", "revenue"],
  ["Spark Liquidity Layer", "spark-liquidity-layer", "fees"], ["Spark Liquidity Layer", "spark-liquidity-layer", "revenue"],
  ["Spark Liquidity Layer", "spark", "fees"], ["Spark Liquidity Layer", "spark", "revenue"],
  ["Paxos Gold", "paxos-gold", "revenue"], ["Paxos Gold", "paxg", "revenue"],
  ["Jito Liquid Staking", "jito", "revenue"], ["Jito Liquid Staking", "jito-liquid-staking", "revenue"],
  ["Concrete", "concrete", "revenue"],
  ["Falcon Finance", "falcon-finance", "revenue"], ["Falcon Finance", "falcon", "revenue"],
  ["Compound V3", "compound-v3", "revenue"], ["Compound V3", "compound", "revenue"],
  ["Rocket Pool", "rocket-pool", "revenue"], ["Rocket Pool", "rocketpool", "revenue"],
  ["Uniswap V4", "uniswap-v4", "revenue"], ["Uniswap V4", "uniswap", "revenue"],
  ["Coinbase Bridge", "coinbase-bridge", "fees"], ["Coinbase Bridge", "base-bridge", "fees"],
  ["Coinbase Bridge", "coinbase-bridge", "revenue"], ["Coinbase Bridge", "base-bridge", "revenue"],
  ["Symbiotic", "symbiotic", "revenue"],
  ["EigenCloud", "eigencloud", "revenue"], ["EigenCloud", "eigen-cloud", "revenue"],
  ["Morpho V1", "morpho-v1", "revenue"], ["Morpho V1", "morpho", "revenue"],
  ["Portal", "portal", "revenue"], ["Portal", "wormhole", "revenue"],
  ["Morpho", "morpho", "revenue"], ["Morpho", "morpho-blue", "revenue"],
  // Jupiter Perpetual volume
  ["Jupiter Perpetual", "jupiter-perpetual", "volume"],
];

async function main() {
  for (const [proto, slug, metric] of slugsToCheck) {
    try {
      let url: string;
      if (metric === "volume") {
        url = `https://api.llama.fi/summary/derivatives/${slug}`;
      } else {
        const dataType = metric === "fees" ? "dailyFees" : "dailyRevenue";
        url = `https://api.llama.fi/summary/fees/${slug}?dataType=${dataType}`;
      }

      const resp = await fetch(url);
      if (!resp.ok) {
        console.log(`✗ ${proto} | ${slug} | ${metric} | HTTP ${resp.status}`);
        continue;
      }
      const data: any = await resp.json();
      const chart = data.totalDataChart || [];
      const latest = data.total24h;
      // Check if data is all zeros
      const nonZero = chart.filter((p: any) => p[1] > 0).length;
      console.log(`✓ ${proto} | ${slug} | ${metric} | ${chart.length} points | nonZero=${nonZero} | 24h=${latest}`);
    } catch (e: any) {
      console.log(`✗ ${proto} | ${slug} | ${metric} | ${e.message?.substring(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  process.exit(0);
}

main();
