/**
 * Pricing & unit-economics calculator.
 *
 * Tweak the INPUTS block at the top, then run:
 *   npx tsx script/pricing-model.ts
 *
 * Outputs:
 *   - Per-user blended cost (LLM + AWS + external APIs)
 *   - Gross margin at each price tier you pass in
 *   - Break-even user count for each price tier (when MRR covers all costs)
 *
 * The point: see how your assumptions about session mix + model choice
 * + scale change the picture. Don't lock in a price without playing
 * with the numbers here first.
 */

interface SessionType {
  pct: number;       // share of sessions
  costPerSession: number;
}

interface Inputs {
  users: number;
  sessionsPerUserPerDay: number;
  daysPerMonth: number;

  // Session-mix and current cost per session for each. Override these
  // when you change the model tier (e.g. Sonnet on medium tier ~halves
  // the deep/focused costs).
  mix: {
    deep: SessionType;
    focused: SessionType;
    quick: SessionType;
  };

  // Fixed costs that DON'T scale with users in this range
  awsFixedPerMonth: number;
  externalApisPerMonth: number; // DefiLlama Pro + Dune + CoinGecko
  miscPerMonth: number;          // Sentry, OpenRouter floor, etc.

  // Tiers to evaluate
  priceTiers: Array<{ name: string; pricePerMonth: number; sessionCap?: number }>;
}

const INPUTS: Inputs = {
  users: 20,
  sessionsPerUserPerDay: 5,
  daysPerMonth: 30,

  // Current state (May 12) — Opus 4.6 on Sonnet tier, Opus 4.7 on Opus tier.
  // Comment line shows what "Sonnet 4.6 on medium tier" would look like.
  mix: {
    deep:    { pct: 0.20, costPerSession: 4.00 /* sonnet-mid: 2.20 */ },
    focused: { pct: 0.50, costPerSession: 1.50 /* sonnet-mid: 0.80 */ },
    quick:   { pct: 0.30, costPerSession: 0.20 /* sonnet-mid: 0.15 */ },
  },

  awsFixedPerMonth: 130,
  externalApisPerMonth: 820, // 300 + 390 + 130
  miscPerMonth: 30,

  priceTiers: [
    { name: "Free", pricePerMonth: 0 },
    { name: "Trial $99", pricePerMonth: 99, sessionCap: 20 },
    { name: "Analyst $249", pricePerMonth: 249, sessionCap: 60 },
    { name: "Pro $499", pricePerMonth: 499, sessionCap: 150 },
    { name: "Pro $799", pricePerMonth: 799, sessionCap: 200 },
    { name: "Fund $2000", pricePerMonth: 2000, sessionCap: undefined },
  ],
};

/* ─────────────────────────── math ─────────────────────────── */

function computeCosts(input: Inputs) {
  const sessionsPerUserPerMonth = input.sessionsPerUserPerDay * input.daysPerMonth;
  const totalSessions = input.users * sessionsPerUserPerMonth;

  // Blended cost per session
  const blendedCostPerSession =
    input.mix.deep.pct * input.mix.deep.costPerSession +
    input.mix.focused.pct * input.mix.focused.costPerSession +
    input.mix.quick.pct * input.mix.quick.costPerSession;

  // Total variable (LLM) cost
  const totalLlmCost = totalSessions * blendedCostPerSession;

  // Per-user share of fixed
  const fixedTotal = input.awsFixedPerMonth + input.externalApisPerMonth + input.miscPerMonth;
  const fixedPerUser = fixedTotal / input.users;
  const llmPerUser = sessionsPerUserPerMonth * blendedCostPerSession;
  const costPerUser = llmPerUser + fixedPerUser;

  return {
    sessionsPerUserPerMonth,
    totalSessions,
    blendedCostPerSession,
    totalLlmCost,
    fixedTotal,
    fixedPerUser,
    llmPerUser,
    costPerUser,
  };
}

function evaluateTier(
  tier: { name: string; pricePerMonth: number; sessionCap?: number },
  rawSessionsPerUser: number,
  blendedCostPerSession: number,
  fixedPerUser: number,
) {
  // Effective sessions = lesser of demand and cap. A heavy power user who
  // "wants" 150 sessions/mo at the $249 Analyst tier is BILLED for 60 and
  // costs you for 60 — the cap is the contract. Margin reflects that.
  const effectiveSessions =
    tier.sessionCap != null ? Math.min(rawSessionsPerUser, tier.sessionCap) : rawSessionsPerUser;

  const llmCostPerUser = effectiveSessions * blendedCostPerSession;
  const totalCostPerUser = llmCostPerUser + fixedPerUser;
  const revenuePerUser = tier.pricePerMonth;
  const grossProfitPerUser = revenuePerUser - totalCostPerUser;
  const grossMarginPct =
    revenuePerUser > 0 ? (grossProfitPerUser / revenuePerUser) * 100 : 0;

  // Break-even users: how many at this price covers all fixed + variable cost?
  // revenuePerUser * N = fixed + N * llmCostPerUser
  // N = fixed / (revenuePerUser - llmCostPerUser)
  const contributionPerUser = revenuePerUser - llmCostPerUser;
  const baselineFixed = fixedPerUser * 20; // total fixed costs at the baseline user count
  const breakEvenUsers =
    contributionPerUser > 0
      ? Math.ceil(baselineFixed / contributionPerUser)
      : Infinity;

  return {
    name: tier.name,
    price: revenuePerUser,
    cap: tier.sessionCap,
    effectiveSessions,
    llmCostPerUser,
    totalCostPerUser,
    grossProfitPerUser,
    grossMarginPct,
    breakEvenUsers,
  };
}

/* ─────────────────────────── output ─────────────────────────── */

const c = computeCosts(INPUTS);

console.log("═══ Assumptions ═══");
console.log(`  ${INPUTS.users} users × ${INPUTS.sessionsPerUserPerDay} sessions/day × ${INPUTS.daysPerMonth} days = ${c.totalSessions.toLocaleString()} sessions/mo`);
console.log(`  Session mix: ${(INPUTS.mix.deep.pct * 100).toFixed(0)}% deep / ${(INPUTS.mix.focused.pct * 100).toFixed(0)}% focused / ${(INPUTS.mix.quick.pct * 100).toFixed(0)}% quick`);
console.log(`  Per-session costs: deep $${INPUTS.mix.deep.costPerSession.toFixed(2)} / focused $${INPUTS.mix.focused.costPerSession.toFixed(2)} / quick $${INPUTS.mix.quick.costPerSession.toFixed(2)}`);
console.log("");

console.log("═══ Cost structure ═══");
console.log(`  Blended cost per session: $${c.blendedCostPerSession.toFixed(2)}`);
console.log(`  LLM cost per user/mo:     $${c.llmPerUser.toFixed(2)}`);
console.log(`  Fixed cost per user/mo:   $${c.fixedPerUser.toFixed(2)}  (AWS $${INPUTS.awsFixedPerMonth} + APIs $${INPUTS.externalApisPerMonth} + misc $${INPUTS.miscPerMonth})`);
console.log(`  Total cost per user/mo:   $${c.costPerUser.toFixed(2)}`);
console.log(`  Total cost ALL users/mo:  $${(c.costPerUser * INPUTS.users).toFixed(2)}  (${c.totalSessions} sessions × $${c.blendedCostPerSession.toFixed(2)} + $${c.fixedTotal} fixed)`);
console.log("");

console.log("═══ Pricing tier evaluation ═══");
console.log("  (gross margin = (price − total_cost_per_user) / price)");
console.log("  (break-even users = users needed to cover all fixed costs at this tier)");
console.log("");
const tierResults = INPUTS.priceTiers.map((t) =>
  evaluateTier(t, c.sessionsPerUserPerMonth, c.blendedCostPerSession, c.fixedPerUser),
);

const colName = "Tier".padEnd(18);
const colPrice = "Price".padStart(8);
const colCap = "Cap".padStart(6);
const colSess = "Eff.sess".padStart(9);
const colLlm = "LLM cost".padStart(10);
const colMargin = "Margin/user".padStart(13);
const colMarginPct = "GM%".padStart(7);
const colBreakeven = "BE users".padStart(10);
console.log(`  ${colName} ${colPrice} ${colCap} ${colSess} ${colLlm} ${colMargin} ${colMarginPct} ${colBreakeven}`);
console.log(`  ${"─".repeat(18)} ${"─".repeat(8)} ${"─".repeat(6)} ${"─".repeat(9)} ${"─".repeat(10)} ${"─".repeat(13)} ${"─".repeat(7)} ${"─".repeat(10)}`);
for (const r of tierResults) {
  const capStr = (r.cap ?? "∞").toString().padStart(6);
  const profitStr = (r.grossProfitPerUser >= 0 ? "+" : "") + r.grossProfitPerUser.toFixed(2);
  const beStr = r.breakEvenUsers === Infinity ? "n/a" : r.breakEvenUsers.toString();
  console.log(
    `  ${r.name.padEnd(18)} ${("$" + r.price.toFixed(0)).padStart(8)} ${capStr} ${r.effectiveSessions.toString().padStart(9)} ${("$" + r.llmCostPerUser.toFixed(0)).padStart(10)} ${("$" + profitStr).padStart(13)} ${(r.grossMarginPct.toFixed(0) + "%").padStart(7)} ${beStr.padStart(10)}`,
  );
}
console.log("");

console.log("═══ Notes ═══");
console.log("  - 'Margin/user' assumes the user is at the SESSION CAP (heavy usage).");
console.log("    Light users have higher margin; users who hit the cap have lower.");
console.log("  - Reverting MODELS.SONNET to claude-sonnet-4-6 (from claude-opus-4-6)");
console.log("    cuts per-session LLM cost roughly in half. Edit the mix block above to model it.");
console.log("  - Fixed costs are amortised across the current user count.");
console.log("    Per-user fixed shrinks fast as you grow: at 100 users it's ~$10/mo.");
