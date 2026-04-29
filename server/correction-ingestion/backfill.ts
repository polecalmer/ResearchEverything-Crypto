// One-shot backfill: run the real extractor against an existing turn-triple
// already in the DB. Bypasses the CORRECTION_INGESTION_ENABLED flag — this
// script is the operator's way to verify the loop end-to-end against a known
// case. Same code path as the live detector+drain; only the trigger differs.
//
// Usage: tsx server/correction-ingestion/backfill.ts <prevAssistantId> <userMsgId> <correctedAssistantId>
//
// Example for the Maple/Syrup regression:
//   tsx server/correction-ingestion/backfill.ts 372 373 374

import { db } from "../db";
import { sql } from "drizzle-orm";
import { extractCorrections, summarizeArtifacts, type TurnPair } from "./extractor";
import { writeCorrections } from "./store";

async function main() {
  const [prevId, userMsgId, correctedId] = process.argv.slice(2).map((n) => Number(n));
  if (!prevId || !userMsgId || !correctedId) {
    console.error("Usage: tsx server/correction-ingestion/backfill.ts <prevAssistantId> <userMsgId> <correctedAssistantId>");
    process.exit(1);
  }

  console.log(`[Backfill] Loading messages ${prevId}, ${userMsgId}, ${correctedId}`);
  const rows = await db.execute(sql`
    SELECT m.id, m.role, m.content, m.artifacts, c.user_id
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id IN (${prevId}, ${userMsgId}, ${correctedId})
  `);
  const raw: any[] = (rows as any).rows ?? rows;
  const failed = raw.find((r) => Number(r.id) === prevId);
  const userCorrection = raw.find((r) => Number(r.id) === userMsgId);
  const corrected = raw.find((r) => Number(r.id) === correctedId);

  if (!failed || !userCorrection || !corrected) {
    console.error("Missing one or more messages.");
    process.exit(1);
  }
  if (failed.role !== "assistant" || userCorrection.role !== "user" || corrected.role !== "assistant") {
    console.error(
      `Bad roles. Got: failed=${failed.role}, userCorrection=${userCorrection.role}, corrected=${corrected.role}`,
    );
    process.exit(1);
  }

  const userId: string = corrected.user_id;
  console.log(`[Backfill] userId=${userId}`);

  const pair: TurnPair = {
    failedAssistantContent: failed.content || "",
    failedAssistantArtifactsSummary: summarizeArtifacts(failed.artifacts),
    userCorrectionContent: userCorrection.content || "",
    correctedAssistantContent: corrected.content || "",
    correctedAssistantArtifactsSummary: summarizeArtifacts(corrected.artifacts),
  };

  console.log(`[Backfill] Failed artifacts:\n  ${pair.failedAssistantArtifactsSummary.replace(/\n/g, "\n  ")}`);
  console.log(`[Backfill] Corrected artifacts:\n  ${pair.correctedAssistantArtifactsSummary.replace(/\n/g, "\n  ")}`);
  console.log(`[Backfill] User correction (truncated): ${pair.userCorrectionContent.slice(0, 200)}`);

  console.log("[Backfill] Calling extractor...");
  const { corrections, costUsd } = await extractCorrections(pair);
  console.log(`[Backfill] Extractor returned ${corrections.length} correction(s) — cost $${costUsd.toFixed(4)}`);
  for (const c of corrections) {
    console.log(`  - ${JSON.stringify(c)}`);
  }

  if (corrections.length === 0) {
    console.log("[Backfill] Nothing to write.");
    process.exit(0);
  }

  const result = await writeCorrections(userId, correctedId, corrections);
  console.log(
    `[Backfill] Wrote ${result.argOverridesWritten} arg-override(s) + ${result.brainFactsWritten} brain-fact(s).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[Backfill] Fatal:", err);
  process.exit(1);
});
