/**
 * Per-turn cache of compute() results, keyed by conversation+turn.
 *
 * The provenance validator reads from this AFTER the agent's final text
 * is produced, so it can match prose numbers against values the agent
 * computed during the turn. Cleared at turn start to bound memory.
 *
 * Also tracks raw tool-result blobs from this turn — direct-source
 * numbers (e.g. "HYPE price $41.14 [coingecko]") match against those
 * without needing to go through compute().
 */

export interface ComputeRecord {
  name: string;
  value: number;
  valueStr: string;
  format: string;
  formula: string;
  params: Record<string, any>;
  sourceLabel: string;
  rowCount: number;
  rowsUsed: number;
  computedAt: string;
  fingerprint: string;
}

export interface ToolResultRecord {
  toolName: string;
  input: any;
  rawText: string;        // the JSON string returned to the agent
  numericTokens: number[]; // pre-extracted numbers from the blob, for fast matching
}

interface TurnState {
  computes: ComputeRecord[];
  toolResults: ToolResultRecord[];
  startedAt: number;
}

const cache = new Map<string, TurnState>();

/** Generate a unique turn ID. Caller passes this into compute() context
 *  and into the validator at the end of the turn. */
export function newTurnId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function startTurn(turnId: string): void {
  cache.set(turnId, {
    computes: [],
    toolResults: [],
    startedAt: Date.now(),
  });
  // Bound memory: drop turn states older than 30 minutes.
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of cache.entries()) {
    if (v.startedAt < cutoff) cache.delete(k);
  }
}

export function recordCompute(turnId: string, rec: ComputeRecord): void {
  const t = cache.get(turnId);
  if (!t) return;
  t.computes.push(rec);
}

export function recordToolResult(
  turnId: string,
  rec: { toolName: string; input: any; rawText: string },
): void {
  const t = cache.get(turnId);
  if (!t) return;
  t.toolResults.push({
    ...rec,
    numericTokens: extractNumbers(rec.rawText),
  });
}

export function getTurn(turnId: string): TurnState | null {
  return cache.get(turnId) || null;
}

export function endTurn(turnId: string): void {
  cache.delete(turnId);
}

/** Extract bare numeric tokens from a JSON/text blob — used to support
 *  matching prose numbers like "$1.70B" against tool outputs even when
 *  the agent didn't route through compute(). */
function extractNumbers(text: string): number[] {
  if (!text) return [];
  // Match plain numbers, with optional commas, decimals, scientific notation.
  const re = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
  // Two-pass dedup with prefer-head and prefer-tail sampling. Long Dune
  // results often have summary/aggregate fields at the END of the blob —
  // capping at "first N" would silently drop them and trigger
  // false-positive redactions on the prose that quotes those summaries.
  // Bumped 5k → 50k, and split the cap across head + tail.
  const HARD_CAP = 50000;
  const HALF = HARD_CAP / 2;
  const seen = new Set<number>();
  const head: number[] = [];
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    matches.push(match);
  }
  // Head pass.
  for (let i = 0; i < matches.length && head.length < HALF; i++) {
    const n = Number(matches[i][0].replace(/,/g, ""));
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    head.push(n);
  }
  // Tail pass — walk backwards picking up unique numbers we haven't seen.
  const tail: number[] = [];
  for (let i = matches.length - 1; i >= 0 && tail.length < HALF; i--) {
    const n = Number(matches[i][0].replace(/,/g, ""));
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    tail.push(n);
  }
  return head.concat(tail);
}
