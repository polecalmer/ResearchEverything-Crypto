// Verbose per-round / per-request narration is gated behind RESEARCH_DEBUG=1
// so a tail of the server log shows only mode decisions, errors, and channel
// lifecycle by default. Set RESEARCH_DEBUG=1 to see brain stats, tool args,
// per-request cost, and compression/recovery notices.
const enabled = process.env.RESEARCH_DEBUG === "1";

export function dlog(...args: any[]): void {
  if (enabled) console.log(...args);
}
