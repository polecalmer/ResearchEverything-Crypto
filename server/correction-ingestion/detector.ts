import { db } from "../db";
import { sql } from "drizzle-orm";
import { extractCorrections, summarizeArtifacts, type TurnPair } from "./extractor";
import { writeCorrections } from "./store";

const FLAG_ENABLED = () => process.env.CORRECTION_INGESTION_ENABLED === "1";

// Corrective-language detector. Conservative on purpose — false positives
// cost a Haiku call (~$0.001), false negatives cost a missed lesson. We
// err toward false positives. The extractor is the second line of defense:
// it will return [] for genuinely non-corrective turns.
const CORRECTIVE_RE =
  /\b(no\b|wrong|incorrect|actually|i think you|that's not|that isn't|try (this|using|with)|you (analysed|missed|got|forgot|used|picked)|use slug|the (real|right|correct)|rebrand|brand change|you should have|instead of|not (the|that))/i;

export interface QueuedRow {
  id: string;
  conversationId: number;
  prevAssistantMsgId: number;
  userMsgId: number;
}

/** Called after a user message lands. Detects corrective language against
 *  the immediately preceding assistant turn (which must have artifacts).
 *  Inserts a row into correction_queue if so. Best-effort, never throws. */
export async function maybeQueueCorrection(
  conversationId: number,
  userMsgId: number,
  userContent: string,
): Promise<void> {
  if (!FLAG_ENABLED()) return;
  if (!CORRECTIVE_RE.test(userContent || "")) return;
  try {
    const rows = await db.execute(sql`
      SELECT id, role, artifacts
      FROM messages
      WHERE conversation_id = ${conversationId}
        AND id < ${userMsgId}
      ORDER BY id DESC
      LIMIT 1
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    const prev = raw[0];
    if (!prev || prev.role !== "assistant") return;
    if (!prev.artifacts || (Array.isArray(prev.artifacts) && prev.artifacts.length === 0)) return;
    await db.execute(sql`
      INSERT INTO correction_queue
        (conversation_id, prev_assistant_msg_id, user_msg_id, status)
      VALUES (${conversationId}, ${prev.id}, ${userMsgId}, 'awaiting_corrected_turn')
    `);
    console.log(
      `[CorrectionIngestion] Queued correction candidate: conv=${conversationId} prev=${prev.id} user=${userMsgId}`,
    );
  } catch (err: any) {
    console.warn(`[CorrectionIngestion] queue failed: ${err.message}`);
  }
}

/** Called after an assistant message with artifacts lands. Drains any
 *  pending correction-queue rows for this conversation by extracting
 *  structured corrections from the (failed, user-correction, corrected)
 *  triple and writing them to the brain. Best-effort, never throws. */
export async function drainQueuedCorrections(
  conversationId: number,
  correctedAssistantMsgId: number,
  correctedAssistantContent: string,
  correctedAssistantArtifacts: any,
  userId: string,
): Promise<{ processed: number; corrections: number; costUsd: number }> {
  if (!FLAG_ENABLED()) return { processed: 0, corrections: 0, costUsd: 0 };
  let processed = 0;
  let corrections = 0;
  let costUsd = 0;
  try {
    const rows = await db.execute(sql`
      SELECT id, prev_assistant_msg_id, user_msg_id
      FROM correction_queue
      WHERE conversation_id = ${conversationId}
        AND status = 'awaiting_corrected_turn'
      ORDER BY id ASC
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    for (const row of raw) {
      processed++;
      const result = await processQueueRow(
        row.id,
        row.prev_assistant_msg_id,
        row.user_msg_id,
        correctedAssistantMsgId,
        correctedAssistantContent,
        correctedAssistantArtifacts,
        userId,
      );
      corrections += result.corrections;
      costUsd += result.costUsd;
    }
  } catch (err: any) {
    console.warn(`[CorrectionIngestion] drain failed: ${err.message}`);
  }
  return { processed, corrections, costUsd };
}

async function processQueueRow(
  queueRowId: string,
  prevAssistantMsgId: number,
  userMsgId: number,
  correctedAssistantMsgId: number,
  correctedAssistantContent: string,
  correctedAssistantArtifacts: any,
  userId: string,
): Promise<{ corrections: number; costUsd: number }> {
  try {
    const rows = await db.execute(sql`
      SELECT id, content, artifacts FROM messages
      WHERE id IN (${prevAssistantMsgId}, ${userMsgId})
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    const failed = raw.find((r: any) => Number(r.id) === Number(prevAssistantMsgId));
    const userCorrection = raw.find((r: any) => Number(r.id) === Number(userMsgId));
    if (!failed || !userCorrection) {
      await markFailed(queueRowId, "missing_messages");
      return { corrections: 0, costUsd: 0 };
    }

    const pair: TurnPair = {
      failedAssistantContent: failed.content || "",
      failedAssistantArtifactsSummary: summarizeArtifacts(failed.artifacts),
      userCorrectionContent: userCorrection.content || "",
      correctedAssistantContent: correctedAssistantContent || "",
      correctedAssistantArtifactsSummary: summarizeArtifacts(correctedAssistantArtifacts),
    };

    const { corrections, costUsd } = await extractCorrections(pair);
    if (corrections.length > 0) {
      const writeResult = await writeCorrections(userId, correctedAssistantMsgId, corrections);
      console.log(
        `[CorrectionIngestion] Wrote ${writeResult.argOverridesWritten} arg-overrides + ${writeResult.brainFactsWritten} brain-facts (cost=$${costUsd.toFixed(4)}) from queue=${queueRowId}`,
      );
    } else {
      console.log(
        `[CorrectionIngestion] Extractor returned 0 corrections for queue=${queueRowId} (cost=$${costUsd.toFixed(4)})`,
      );
    }

    await db.execute(sql`
      UPDATE correction_queue
      SET status = 'processed',
          corrected_assistant_msg_id = ${correctedAssistantMsgId},
          processed_at = now()
      WHERE id = ${queueRowId}
    `);
    return { corrections: corrections.length, costUsd };
  } catch (err: any) {
    await markFailed(queueRowId, err.message);
    return { corrections: 0, costUsd: 0 };
  }
}

async function markFailed(queueRowId: string, errorMessage: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE correction_queue
      SET status = 'failed',
          processed_at = now(),
          error_message = ${errorMessage}
      WHERE id = ${queueRowId}
    `);
  } catch {}
}
