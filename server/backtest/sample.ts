/** Stride-sample an array down to roughly maxPoints, always keeping the last
 *  point. Identical to the helper in session-research-agent.ts — extracted
 *  here so the backtest plugin doesn't need to import from the agent loop. */
export function sampleData<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < data.length; i += step) out.push(data[i]);
  if (out[out.length - 1] !== data[data.length - 1]) out.push(data[data.length - 1]);
  return out;
}
