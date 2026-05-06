import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { db } from "../db";
import { dlog } from "../debug-log";
import { sql } from "drizzle-orm";
import {
  MAX_GLOBAL_RESEARCH,
  MAX_PER_USER_RESEARCH,
  tryAcquireResearchSlot,
  releaseResearchSlot,
  getResearchInflight,
} from "../research-slots";
import {
  isBulkExtractionRequest,
  BULK_EXTRACTION_REFUSAL,
} from "../bulk-extraction-policy";
import {
  detectPromptInjection,
  PROMPT_INJECTION_REFUSAL,
} from "../prompt-injection-policy";
import { Sentry, sentryEnabled } from "../sentry";
import { logger } from "../logger";

/**
 * Bend refreshed rows back into the shape the original chart was rendered
 * with. Refreshes hit two reproducible mismatches:
 *
 *   1. Scale: DefiLlama returns `tvl: 14_197_275_351` (raw dollars), but
 *      the agent emitted `tvl: 10.9` with the unit carried in the yAxis
 *      label ("TVL ($B)"). Renderer applies the label to whatever number
 *      it sees → "14B BILLIONS". We detect the embedded scale and divide.
 *
 *   2. Column names: Dune-SQL returns `weekly_revenue`, `week_start`,
 *      `avg_price`; the chart's yAxes configured `dataKey: "Weekly Revenue"`
 *      and xAxis `dataKey: "week"`. Zero overlap → blank chart. We slug-
 *      match each chart dataKey against actual SQL column names and
 *      rename so the renderer finds the data.
 *
 * Both are handled here. If either inference fails, we leave the row
 * alone — better a slightly-off chart than a corrupt rename. Apply a
 * scaled-down narrative so the audit trail in the validator log still
 * makes sense after the fact.
 */
function normalizeRefreshOutput(
  result: { data: any[]; chartConfig: any },
  chart: { chartConfig: string },
): { data: any[]; chartConfig: any } {
  const rows = Array.isArray(result.data) ? result.data : [];
  if (rows.length === 0) return result;
  const existingConfig =
    typeof chart.chartConfig === "string" ? JSON.parse(chart.chartConfig || "{}") : chart.chartConfig;
  const yAxes: Array<{ dataKey?: string; label?: string }> = existingConfig?.yAxes || [];
  const xAxisKey: string = existingConfig?.xAxis?.dataKey || "date";
  // Tables carry their column list in `columns` instead of `yAxes`. When
  // the chart is actually a table (chartType === "table" or columns
  // present without yAxes), build the expected-keys list from `columns`.
  // The rest of the rename + scale logic works identically — same
  // problem (re-fetched data has native column names; chart was
  // rendered with display names), same fix.
  const tableColumns: string[] = Array.isArray(existingConfig?.columns) ? existingConfig.columns : [];
  if (yAxes.length === 0 && tableColumns.length === 0) return result;

  // ── Pass 1: dataKey remap (slug match SQL columns to chart dataKeys) ──
  const sample = rows[0];
  const sampleKeys = sample && typeof sample === "object" ? Object.keys(sample) : [];
  const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const sampleKeysSlug = new Map<string, string>();
  for (const k of sampleKeys) sampleKeysSlug.set(slugify(k), k);

  const renameMap = new Map<string, string>();
  const claimed = new Set<string>(); // SQL columns already paired
  // Build expectedKeys from yAxes (chart) OR columns (table). For tables
  // the xAxis isn't a separate concept; columns are the full set.
  const expectedKeys: string[] =
    yAxes.length > 0
      ? [xAxisKey, ...yAxes.map((y) => y?.dataKey).filter(Boolean) as string[]]
      : tableColumns;
  // Pass A: strict slug match (e.g. "Weekly Revenue" ↔ "weekly_revenue")
  for (const expected of expectedKeys) {
    if (sampleKeys.includes(expected)) { claimed.add(expected); continue; }
    const slug = slugify(expected);
    if (sampleKeysSlug.has(slug)) {
      const k = sampleKeysSlug.get(slug)!;
      renameMap.set(k, expected);
      claimed.add(k);
      continue;
    }
  }
  // Pass B: prefix match (chart's "week" picks SQL "week_start", or vice
  // versa). Bias toward the more specific (longer) name on either side.
  for (const expected of expectedKeys) {
    if (sampleKeys.includes(expected)) continue;
    if ([...renameMap.values()].includes(expected)) continue;
    const slug = slugify(expected);
    const candidates = sampleKeys.filter((k) => {
      if (claimed.has(k)) return false;
      const ks = slugify(k);
      return ks.startsWith(slug + "_") || slug.startsWith(ks + "_");
    });
    if (candidates.length === 1) {
      renameMap.set(candidates[0], expected);
      claimed.add(candidates[0]);
    }
  }
  // Pass C: token-overlap fallback. The agent often renames columns in
  // its emitted artifact ("avg_price" → "HYPE Price") for display while
  // the SQL keeps native column names. Strict slug/prefix match misses
  // these, but the tokens almost always share at least one (here:
  // "price"). For each still-unmatched expected key, pick the unmatched
  // SQL column with the most token overlap (≥1). Tie-broken by column
  // ordinal so deterministic. Numeric-only filter for non-xAxis keys to
  // avoid pairing labels like "HYPE Price" with a string column.
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  for (const expected of expectedKeys) {
    if (sampleKeys.includes(expected)) continue;
    if ([...renameMap.values()].includes(expected)) continue;
    const wantTokens = tokenize(expected);
    if (wantTokens.size === 0) continue;
    const isXAxis = expected === xAxisKey;
    let best: { key: string; overlap: number; idx: number } | null = null;
    sampleKeys.forEach((k, idx) => {
      if (claimed.has(k)) return;
      // For yAxis (numeric) candidates, require numeric value in sample.
      if (!isXAxis) {
        const v = sample[k];
        if (typeof v !== "number" || !Number.isFinite(v)) return;
      }
      const have = tokenize(k);
      let overlap = 0;
      for (const t of Array.from(wantTokens)) if (have.has(t)) overlap++;
      if (overlap === 0) return;
      if (!best || overlap > best.overlap || (overlap === best.overlap && idx < best.idx)) {
        best = { key: k, overlap, idx };
      }
    });
    if (best !== null) {
      const winner = best as { key: string; overlap: number; idx: number };
      renameMap.set(winner.key, expected);
      claimed.add(winner.key);
    }
  }

  let mapped = rows;
  if (renameMap.size > 0) {
    console.log(`[RefreshChart] Renaming columns: ${[...renameMap.entries()].map(([f, t]) => `${f}→${t}`).join(", ")}`);
    mapped = rows.map((row) => {
      const out: Record<string, any> = { ...row };
      for (const [from, to] of renameMap.entries()) {
        if (from in out) {
          out[to] = out[from];
          if (from !== to) delete out[from];
        }
      }
      return out;
    });
  }

  // ── Pass 2: scale-down for unit-embedded yAxis labels ──
  const scaleByKey = new Map<string, number>();
  for (const y of yAxes) {
    if (!y?.dataKey) continue;
    const scale = inferYAxisScaleFromLabel(y.label || y.dataKey);
    if (scale > 1) scaleByKey.set(y.dataKey, scale);
  }
  if (scaleByKey.size > 0) {
    console.log(`[RefreshChart] Scaling down by yAxis units: ${[...scaleByKey.entries()].map(([k, s]) => `${k}÷${s}`).join(", ")}`);
    mapped = mapped.map((row) => {
      const out: Record<string, any> = { ...row };
      for (const [k, scale] of scaleByKey.entries()) {
        const v = out[k];
        if (typeof v === "number" && Number.isFinite(v)) {
          // Only scale down if the value looks raw — i.e., its magnitude is
          // dramatically larger than what the original chart had. Heuristic:
          // if the value is > 1e5, apply scaling. (A chart already in $B
          // wouldn't have a value > 1e5; one in raw dollars routinely will.)
          if (Math.abs(v) >= 1e5) out[k] = v / scale;
        }
      }
      return out;
    });
  }

  return { data: mapped, chartConfig: existingConfig };
}

/** Mirror of chart-validator.ts:inferYAxisUnitScale — kept local here to
 *  avoid pulling the validator module into the routes file. Update both
 *  if you teach one new patterns. */
function inferYAxisScaleFromLabel(label: string): number {
  if (!label) return 1;
  if (/\(\s*\$?\s*b\s*\)|\$b\b|\bbn\b|\bbillion(s)?\b/i.test(label)) return 1e9;
  if (/\(\s*\$?\s*m\s*\)|\$m\b|\bmm\b|\bmillion(s)?\b/i.test(label)) return 1e6;
  if (/\(\s*\$?\s*k\s*\)|\$k\b|\bthousand(s)?\b/i.test(label)) return 1e3;
  return 1;
}

export function registerResearchRoutes(app: Express) {
  app.get("/api/research/sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getConversations(req.user!.id, "research");
      res.json(sessions);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/saved-models", requireAuth, async (req, res) => {
    try {
      const models = await storage.getSavedModelsByUser(req.user!.id);
      res.json(models);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  let aggregateBrainCache: { data: any; expires: number } | null = null;
  app.get("/api/brain/aggregate", async (_req, res) => {
    try {
      if (aggregateBrainCache && aggregateBrainCache.expires > Date.now()) {
        return res.json(aggregateBrainCache.data);
      }
      const brains = await storage.getAllResearchBrains();

      const entityAgg: Record<string, { type: string; count: number; users: number }> = {};
      const edgeAgg: Record<string, { from: string; to: string; type: string; weight: number }> = {};

      for (const brain of brains) {
        const entities = (brain.entities || {}) as Record<string, any>;
        for (const [name, data] of Object.entries(entities)) {
          if (!name || typeof name !== "string") continue;
          const e = data as any;
          const type = e?.type || "concept";
          const count = Number(e?.researchCount) || 1;
          if (!entityAgg[name]) entityAgg[name] = { type, count: 0, users: 0 };
          entityAgg[name].count += count;
          entityAgg[name].users += 1;
        }
        const rels = (brain.relationships || []) as any[];
        for (const r of rels) {
          if (!r?.from || !r?.to) continue;
          const a = String(r.from);
          const b = String(r.to);
          const key = a < b ? `${a}|${b}|${r.type || "rel"}` : `${b}|${a}|${r.type || "rel"}`;
          if (!edgeAgg[key]) edgeAgg[key] = { from: a, to: b, type: r.type || "related_to", weight: 0 };
          edgeAgg[key].weight += 1;
        }
      }

      const topEntities = Object.entries(entityAgg)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 180);
      const allowed = new Set(topEntities.map(([n]) => n));
      const nodes = topEntities.map(([name, info]) => ({
        id: name,
        type: info.type,
        count: info.count,
        users: info.users,
      }));
      const edges = Object.values(edgeAgg)
        .filter(e => allowed.has(e.from) && allowed.has(e.to))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 400);

      const totalEntities = Object.keys(entityAgg).length;
      const totalRelationships = Object.keys(edgeAgg).length;
      const data = {
        nodes,
        edges,
        stats: {
          totalEntities,
          totalRelationships,
          totalResearchers: brains.length,
          shownEntities: nodes.length,
          shownRelationships: edges.length,
        },
      };
      aggregateBrainCache = { data, expires: Date.now() + 5 * 60 * 1000 };
      res.json(data);
    } catch (e: any) {
      console.error("[BrainAggregate] Error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/brain/graph", requireAuth, async (req, res) => {
    try {
      const brainRecord = await storage.getResearchBrain(req.user!.id);
      if (!brainRecord) {
        return res.json({
          entities: {},
          relationships: [],
          knowledge: [],
          contradictions: [],
          preferences: {},
          meta: { totalSessions: 0, lastActive: null, topEntities: [] },
        });
      }
      res.json({
        entities: brainRecord.entities || {},
        relationships: brainRecord.relationships || [],
        knowledge: brainRecord.knowledge || [],
        contradictions: brainRecord.contradictions || [],
        preferences: brainRecord.preferences || {},
        meta: brainRecord.meta || { totalSessions: 0, lastActive: null, topEntities: [] },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // One-shot backfill: synthesizes data-source-brain facts from the calling
  // user's existing research_brain.preferences. Idempotent — re-runs are
  // no-ops via observe()'s dedupe key. Used to seed user prefs for users
  // whose preferences predate the synthesis pass.
  app.post("/api/brain/synthesize", requireAuth, async (req, res) => {
    try {
      const brainRecord = await storage.getResearchBrain(req.user!.id);
      const prefs = (brainRecord?.preferences as Record<string, any>) || {};
      const { synthesizeUserPreferenceFacts } = await import("../brain-synthesis");
      const result = await synthesizeUserPreferenceFacts(req.user!.id, prefs);
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[BrainSynthesize] Error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/brain/preferences", requireAuth, async (req, res) => {
    try {
      const { preferences } = req.body;
      if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return res.status(400).json({ message: "preferences must be an object" });
      }

      const validKeys = new Set(["data_sources", "research_style", "analysis_lens", "custom_instructions"]);
      const cleaned: Record<string, string[]> = {};

      for (const [key, val] of Object.entries(preferences)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        if (!validKeys.has(key)) continue;
        if (!Array.isArray(val)) continue;
        const items = (val as any[])
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map(v => v.trim().slice(0, 1000))
          .slice(0, 50);
        if (items.length > 0) cleaned[key] = items;
      }

      await storage.upsertResearchBrain(req.user!.id, { preferences: cleaned });

      // Fire-and-forget synthesis: promote any source mentions to data-brain.
      (async () => {
        try {
          const { synthesizeUserPreferenceFacts } = await import("../brain-synthesis");
          await synthesizeUserPreferenceFacts(req.user!.id, cleaned);
        } catch (err: any) {
          console.warn(`[BrainPreferences] synthesis after PUT failed:`, err.message);
        }
      })();

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/sessions", requireAuth, async (req, res) => {
    try {
      // parentSessionId fingerprints a sub-session (Build Chart, Double
      // Click) back to the master session that spawned it. spawnSource
      // labels the trigger so the UI can badge it. Both nullable —
      // top-level sessions started directly by the user have neither.
      // We validate parentSessionId belongs to the same user when set
      // (don't let one user's session reference another's).
      let parentSessionId: number | undefined;
      let spawnSource: string | undefined;
      if (typeof req.body.parentSessionId === "number") {
        const parent = await storage.getConversation(req.body.parentSessionId);
        if (parent && parent.userId === req.user!.id) {
          parentSessionId = parent.id;
        }
      }
      if (typeof req.body.spawnSource === "string" && req.body.spawnSource.length < 40) {
        spawnSource = req.body.spawnSource;
      }
      const session = await storage.createConversation({
        userId: req.user!.id,
        title: req.body.title || "New Session",
        type: "research",
        parentSessionId,
        spawnSource,
      });
      res.json(session);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/sessions/:id/messages", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      const msgs = await storage.getMessages(session.id);
      res.json(msgs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Spawned sessions (Build Chart, Double Click) carry parent_session_id.
  // The user's first turn in the spawned session is just the highlighted
  // snippet — without parent context the agent can't tell which entity/
  // protocol it's about and falls back to whatever the brain weighs most
  // heavily (which has produced wrong-protocol responses, e.g. an AERO
  // double-click coming back about HYPE). Inject parent context into the
  // FIRST turn only — subsequent turns have local history of their own.
  async function buildParentContextBlock(
    parentSessionId: number,
    spawnedMessage: string,
  ): Promise<string | null> {
    const parent = await storage.getConversation(parentSessionId);
    if (!parent) return null;
    const parentMsgs = await storage.getMessages(parentSessionId);
    if (parentMsgs.length === 0) return null;

    const parentTitle = parent.title || "(untitled)";
    const firstUser = parentMsgs.find((m) => m.role === "user");
    const firstUserPrompt = (firstUser?.content || "").slice(0, 600);

    // Pinpoint the assistant message the highlight came from. Both
    // spawn shapes embed the highlight as the FIRST quoted string —
    // Double Click sends `> "highlight"`, Build Chart sends
    // `Build a chart for: "highlight" ...`. Extract that and
    // substring-match against parent assistant messages. Fall back to
    // the most recent assistant message when match fails.
    const quoteMatch = /"([\s\S]+?)"/.exec(spawnedMessage);
    const highlight = quoteMatch ? quoteMatch[1] : null;
    let sourceAssistant = "";
    if (highlight) {
      const found = parentMsgs.find(
        (m) => m.role === "assistant" && m.content?.includes(highlight),
      );
      if (found?.content) sourceAssistant = found.content;
    }
    if (!sourceAssistant) {
      const last = [...parentMsgs].reverse().find((m) => m.role === "assistant");
      sourceAssistant = last?.content || "";
    }
    // Token budget: keep the slice around the highlight when possible,
    // hard-cap the rest.
    const MAX = 4000;
    if (sourceAssistant.length > MAX) {
      if (highlight) {
        const idx = sourceAssistant.indexOf(highlight);
        if (idx >= 0) {
          const start = Math.max(0, idx - 1500);
          const end = Math.min(sourceAssistant.length, idx + highlight.length + 1500);
          sourceAssistant =
            (start > 0 ? "…" : "") +
            sourceAssistant.slice(start, end) +
            (end < sourceAssistant.length ? "…" : "");
        } else {
          sourceAssistant = sourceAssistant.slice(0, MAX) + "…";
        }
      } else {
        sourceAssistant = sourceAssistant.slice(0, MAX) + "…";
      }
    }

    return [
      `[CONTEXT FROM PARENT SESSION — "${parentTitle}"]`,
      `The user is following up on a thread from a prior research session. Their original framing question was:`,
      `> ${firstUserPrompt}`,
      ``,
      `They highlighted text from THIS assistant response:`,
      `--- begin parent assistant message ---`,
      sourceAssistant,
      `--- end parent assistant message ---`,
      `[END PARENT CONTEXT]`,
      ``,
      `The follow-up below asks you to go deeper on the highlighted slice. Stay grounded in the SAME entity/protocol the parent was about — do NOT silently switch topics. If the highlight is ambiguous, resolve it against the parent's framing question above.`,
    ].join("\n");
  }

  app.post("/api/research/sessions/:id/messages", requireAuth, async (req, res) => {
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let slotAcquired = false;
    const userId = req.user!.id;
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== userId) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { message, forceMode, refreshBrain, sessionMode } = req.body;
      const isDataMode = sessionMode === "data";
      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }
      const validModes = ["quick", "focused", "deep", "chart"];
      const mode: "quick" | "focused" | "deep" | "chart" | undefined = validModes.includes(forceMode) ? forceMode : undefined;

      // Prompt-injection policy: deterministic short-circuit for
      // prompt-extraction / instruction-override / jailbreak attempts.
      // Replaces the OPERATIONAL SECURITY meta-refusal block deleted
      // from BASE_PROMPT — same protective intent, zero prompt cost,
      // logged + Sentry-captured for attack-pattern monitoring.
      const injection = detectPromptInjection(message);
      if (injection.matched) {
        logger.warn(
          { tag: injection.tag, sessionId: session.id, userId },
          "prompt-injection.detected",
        );
        if (sentryEnabled) {
          Sentry.captureMessage(`Prompt-injection attempt: ${injection.tag}`, {
            level: "warning",
            tags: {
              policy: "prompt-injection",
              detection_tag: injection.tag || "unknown",
            },
          });
        }
        await storage.createMessage({
          conversationId: session.id,
          role: "user",
          content: message,
        });
        const assistantMsg = await storage.createMessage({
          conversationId: session.id,
          role: "assistant",
          content: PROMPT_INJECTION_REFUSAL,
        });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        res.write(
          `event: done\ndata: ${JSON.stringify({
            message: assistantMsg,
            artifacts: [],
            mppCost: 0,
            toolCalls: [],
            needsContinuation: false,
          })}\n\n`,
        );
        res.end();
        return;
      }

      // Bulk-extraction policy: deterministic short-circuit before slot
      // acquisition + agent invocation. Equivalent prompt block was
      // removed from BASE_PROMPT — this is the replacement, cheaper +
      // can't be talked around by the model.
      if (isBulkExtractionRequest(message)) {
        await storage.createMessage({
          conversationId: session.id,
          role: "user",
          content: message,
        });
        const assistantMsg = await storage.createMessage({
          conversationId: session.id,
          role: "assistant",
          content: BULK_EXTRACTION_REFUSAL,
        });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        res.write(
          `event: done\ndata: ${JSON.stringify({
            message: assistantMsg,
            artifacts: [],
            mppCost: 0,
            toolCalls: [],
            needsContinuation: false,
          })}\n\n`,
        );
        res.end();
        console.log(
          `[SessionResearch] Refused bulk-extraction request (session ${session.id})`,
        );
        return;
      }

      if (!tryAcquireResearchSlot(userId)) {
        res.setHeader("Retry-After", "10");
        return res.status(429).json({
          message: (() => {
            const inflight = getResearchInflight();
            return `Research concurrency limit reached (${inflight.global}/${MAX_GLOBAL_RESEARCH} global, ${inflight.perUser[userId] || 0}/${MAX_PER_USER_RESEARCH} per user). Wait for an in-flight request to finish.`;
          })(),
        });
      }
      slotAcquired = true;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      // Track this SSE for graceful shutdown — deregister on any close
      // path (client disconnect, error, normal completion).
      const { registerInFlightSse } = await import("../shutdown");
      const deregisterSse = registerInFlightSse(res);

      // Cancellation: abort propagates through AsyncLocalStorage to every
      // tool client (Dune polling, DefiLlama fetches) so a closed SSE
      // doesn't leave us holding a 180s Dune poll for a response no one
      // is waiting for.
      const abortController = new AbortController();

      let clientClosed = false;
      const stopKeepalive = () => { if (keepalive) { clearInterval(keepalive); keepalive = null; } };
      req.on("close", () => {
        clientClosed = true;
        stopKeepalive();
        deregisterSse();
        abortController.abort();
        console.log(`[SessionResearch] Client disconnected mid-stream (session ${session.id})`);
      });

      const safeWrite = (chunk: string) => {
        if (clientClosed || res.writableEnded) return;
        try { res.write(chunk); } catch { /* socket gone */ }
      };

      keepalive = setInterval(() => {
        safeWrite(": keepalive\n\n");
      }, 15000);

      const sendEvent = (event: string, data: any) => {
        safeWrite(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Capture this BEFORE storing the new message — we need to know
      // if the spawned-session's first turn is happening so we can inject
      // parent-session context for the agent.
      const priorMessages = await storage.getMessages(session.id);
      const isFirstTurn = priorMessages.length === 0;

      const userMsg = await storage.createMessage({
        conversationId: session.id,
        role: "user",
        content: message,
      });

      // Build the message variant the AGENT sees. The user's stored
      // message stays clean (just `> "highlight"`) for the UI; the agent
      // gets parent context prepended on the first turn of a spawned
      // session. Without this, the agent has no idea which entity the
      // highlight came from and falls back to whatever the brain weighs
      // most heavily — root cause of the "AERO double-click → HYPE memo"
      // bug.
      let messageForAgent = message;
      if (isFirstTurn && session.parentSessionId != null) {
        try {
          const parentCtx = await buildParentContextBlock(session.parentSessionId, message);
          if (parentCtx) {
            messageForAgent = `${parentCtx}\n\n${message}`;
            console.log(
              `[SessionResearch] Injected parent context from session ${session.parentSessionId} (${parentCtx.length} chars, spawnSource=${session.spawnSource || "unknown"})`,
            );
          }
        } catch (err: any) {
          console.warn(
            `[SessionResearch] buildParentContextBlock failed for parent ${session.parentSessionId}: ${err?.message}`,
          );
        }
      }

      const history = await storage.getMessages(session.id);
      const historyForAgent = history.map(m => ({ role: m.role, content: m.content }));

      const brainRecord = await storage.getResearchBrain(req.user!.id);
      const brain = brainRecord ? {
        entities: (brainRecord.entities || {}) as Record<string, any>,
        knowledge: (brainRecord.knowledge || []) as any[],
        preferences: (brainRecord.preferences || {}) as Record<string, any>,
        relationships: (brainRecord.relationships || []) as any[],
        contradictions: (brainRecord.contradictions || []) as any[],
        meta: (brainRecord.meta || { totalSessions: 0, lastActive: new Date().toISOString().slice(0, 10), topEntities: [] }) as any,
      } : null;

      const { runSessionResearchAgent, parseArtifacts } = await import("../session-research-agent");

      let result: any;

      // Chart toggle (sessionMode === "data") routes to the unified research
      // agent with forceMode="chart" — the data-agent.ts path is deprecated
      // (focused mode of the research agent already produces better charts;
      // chart mode is a tightened variant of focused).
      let brainForAgent = brain;
      if (refreshBrain && brain) {
        const LIVE = /\b(price|tvl|mcap|market cap|fdv|fee|fees|revenue|volume|apy|apr|yield|supply|circulating|inflation|holders|active users|dau|wau)\b/i;
        const filtered = (brain.knowledge || []).filter((f: any) => {
          const text = `${f.topic || ""} ${f.fact || ""}`;
          return !LIVE.test(text);
        });
        brainForAgent = { ...brain, knowledge: filtered };
        console.log(`[SessionResearch] refreshBrain=true → dropped ${(brain.knowledge || []).length - filtered.length} live-metric facts from context`);
      }

      // Auto-route financial-statement prompts to chart mode (chart's
      // artifact-emission contract is a tighter forcing function for
      // numeric grounding than free-form research mode). Explicit user
      // forceMode and isDataMode toggle still win.
      const { resolveEffectiveMode } = await import("../numeric-provenance/fs-router");
      const routed = resolveEffectiveMode(message, mode, isDataMode);
      const effectiveMode: "quick" | "focused" | "deep" | "chart" | undefined = routed.mode;
      if (isDataMode) {
        console.log(`[SessionResearch] Chart toggle → forceMode=chart on unified agent`);
      } else if (routed.routedToChart) {
        console.log(`[SessionResearch] Auto-routed to chart mode: ${routed.reason}`);
      }

      const { withRequestContext } = await import("../request-context");
      result = await withRequestContext(
        {
          signal: abortController.signal,
          requestId: (req as any).id,
          userId: req.user!.id,
        },
        () => runSessionResearchAgent(
          messageForAgent,
          historyForAgent.slice(0, -1),
          brainForAgent,
          (step) => sendEvent("step", step),
          effectiveMode,
          async (plan) => {
            try {
              await storage.updateMessagePlan(userMsg.id, plan);
              sendEvent("plan", plan);
            } catch (err: any) {
              console.error("[SessionResearch] Failed to persist plan:", err.message);
            }
          },
          req.user!.id,
          isDataMode,
        ),
      );
      sendEvent("mode", { mode: result.mode, reason: result.modeReason });

      // Prefer artifacts from the agent (already enriched with inferred
      // refreshRecipe and any other server-side annotations). Fall back to
      // re-parsing the content if the agent didn't return any — older paths
      // or error cases. Re-parsing throws away refreshRecipe inferences
      // since those live on the artifact object, not in the JSON text.
      const artifacts = (result.artifacts && result.artifacts.length > 0)
        ? result.artifacts
        : parseArtifacts(result.content);
      const continuationTag = result.needsContinuation ? "<!-- needs_continuation -->\n" : "";
      const contentWithMode = `<!-- mode:${result.mode} -->\n${continuationTag}${result.content}`;
      const assistantMsg = await storage.createMessage({
        conversationId: session.id,
        role: "assistant",
        content: contentWithMode,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        kind: result.mode === "deep" ? "deep_model" : undefined,
      });

      // Drain any queued correction extractions for this conversation. Fires
      // only when there's a pending row (set by the storage detector when the
      // user's prior message contained corrective language). Best-effort.
      if (artifacts.length > 0) {
        import("../correction-ingestion/detector")
          .then((m) =>
            m.drainQueuedCorrections(
              session.id,
              assistantMsg.id,
              contentWithMode,
              artifacts,
              req.user!.id,
            ),
          )
          .catch((err) =>
            console.warn(`[CorrectionIngestion] drain hook failed: ${err?.message}`),
          );
      }

      if (history.length <= 2) {
        const titleSnippet = message.slice(0, 60) + (message.length > 60 ? "..." : "");
        await storage.updateConversationTitle(session.id, titleSnippet);
      }

      if (result.brainUpdates) {
        try {
          const existing = brainRecord || { entities: {}, knowledge: [], preferences: {}, relationships: [], contradictions: [], meta: { totalSessions: 0, lastActive: "", topEntities: [] } };
          const today = new Date().toISOString().slice(0, 10);
          const nowISO = new Date().toISOString();

          const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf"]);
          const mergedEntities = { ...(existing.entities as any || {}) };
          for (const [name, data] of Object.entries(result.brainUpdates.entities || {})) {
            if (FORBIDDEN_KEYS.has(name) || typeof name !== "string" || name.length > 100) continue;
            const prev = mergedEntities[name];
            if (prev) {
              mergedEntities[name] = {
                ...prev,
                ...data,
                researchCount: (prev.researchCount || 0) + 1,
                lastResearched: today,
                tags: [...new Set([...(prev.tags || []), ...(data.tags || [])])],
                competitors: [...new Set([...(prev.competitors || []), ...(data.competitors || [])])],
                chains: [...new Set([...(prev.chains || []), ...(data.chains || [])])],
              };
            } else {
              mergedEntities[name] = { ...data, researchCount: 1, lastResearched: today };
            }
          }

          const existingFacts = (existing.knowledge as any[] || []);
          const newContradictions = [...(existing.contradictions as any[] || [])];

          const newFacts = (result.brainUpdates.facts || []).reduce((acc: any[], f: any) => {
            const exactDupe = existingFacts.find((ef: any) =>
              ef.topic === f.topic && ef.fact === f.fact
            );
            if (exactDupe) return acc;

            const id = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const existingFact = existingFacts.find((ef: any) =>
              ef.topic === f.topic && ef.entities?.some((e: string) => f.entities?.includes(e)) && ef.confidence !== "stale"
            );
            if (existingFact && existingFact.fact !== f.fact) {
              newContradictions.push({
                factIdOld: existingFact.id,
                factIdNew: id,
                summary: `${f.topic}: was "${existingFact.fact}" → now "${f.fact}"`,
                date: today,
              });
              existingFact.confidence = "stale";
              existingFact.supersedes = id;
            }
            acc.push({ ...f, id, date: nowISO });
            return acc;
          }, []);

          const LIVE_METRIC_RE = /\b(price|tvl|mcap|market cap|fdv|fee|fees|revenue|volume|apy|apr|yield|supply|circulating|inflation|holders|active users|dau|wau)\b/i;
          const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
          const nowMs = Date.now();
          const combined = [...existingFacts, ...newFacts];
          const pruned = combined.filter((f: any) => {
            const text = `${f.topic || ""} ${f.fact || ""}`;
            if (!LIVE_METRIC_RE.test(text)) return true;
            if (!f.date) return true;
            const factTs = new Date(f.date).getTime();
            if (isNaN(factTs)) return true;
            return (nowMs - factTs) < SEVEN_DAYS_MS;
          });
          const droppedCount = combined.length - pruned.length;
          if (droppedCount > 0) {
            console.log(`[SessionResearch] Pruned ${droppedCount} stale live-metric facts (>7d old)`);
          }
          const mergedKnowledge = pruned.slice(-200);

          const existingRels = (existing.relationships as any[] || []);
          const newRels = (result.brainUpdates.relationships || []).filter((nr: any) =>
            !existingRels.some((er: any) => er.from === nr.from && er.to === nr.to && er.type === nr.type)
          ).map((r: any) => ({ ...r, date: today }));
          const mergedRelationships = [...existingRels, ...newRels].slice(-100);

          const entityCounts = Object.entries(mergedEntities)
            .map(([name, e]: [string, any]) => ({ name, count: e.researchCount || 0 }))
            .sort((a, b) => b.count - a.count);
          const topEntities = entityCounts.slice(0, 5).map(e => e.name);

          const mergedMeta = {
            totalSessions: ((existing.meta as any)?.totalSessions || 0) + 1,
            lastActive: today,
            topEntities,
          };

          await storage.upsertResearchBrain(req.user!.id, {
            entities: mergedEntities,
            knowledge: mergedKnowledge,
            preferences: { ...(existing.preferences as any || {}), ...(result.brainUpdates.preferences || {}) },
            relationships: mergedRelationships,
            contradictions: newContradictions.slice(-50),
            meta: mergedMeta,
          });
          dlog(`[SessionResearch] Brain merged: ${Object.keys(mergedEntities).length} entities, ${mergedKnowledge.length} facts, ${mergedRelationships.length} rels, ${newContradictions.length} contradictions`);

          // Fire-and-forget: promote any data-source mentions in preferences
          // into per-user data-source-brain coverage facts so the resolver
          // can route future chart requests to the user's preferred sources.
          // Wrapped in retryWithBackoff (logs each attempt + Sentry-reports
          // exhaustion) so transient Voyage / DB blips don't silently lose
          // the synthesis.
          (async () => {
            try {
              const { retryWithBackoff } = await import("../retry");
              await retryWithBackoff("brain-synthesis-after-merge", async () => {
                const { synthesizeUserPreferenceFacts } = await import("../brain-synthesis");
                const mergedPrefs = { ...(existing.preferences as any || {}), ...(result.brainUpdates.preferences || {}) };
                await synthesizeUserPreferenceFacts(req.user!.id, mergedPrefs);
              });
            } catch {
              // Already logged + Sentry-captured by retryWithBackoff.
              // Swallow so this fire-and-forget IIFE doesn't surface as
              // an unhandledRejection.
            }
          })();

          try {
            const { retryWithBackoff } = await import("../retry");
            await retryWithBackoff("brain-embedding-sync", async () => {
              const { syncBrainFacts, syncBrainEntities } = await import("../brain-embedding-sync");
              const factsToSync = newFacts.map((f: any) => ({
                id: f.id,
                topic: f.topic || "",
                fact: f.fact || "",
                entities: f.entities || [],
                source: f.source || "",
                date: f.date,
                confidence: f.confidence || "verified",
              }));
              const newEntityEntries: Record<string, any> = {};
              for (const [name, data] of Object.entries(result.brainUpdates.entities || {})) {
                newEntityEntries[name] = mergedEntities[name] || data;
              }
              const [fSynced, eSynced] = await Promise.all([
                syncBrainFacts(req.user!.id, factsToSync),
                syncBrainEntities(req.user!.id, newEntityEntries),
              ]);
              console.log(`[BrainSync] Embedded ${fSynced} facts, ${eSynced} entities`);
            });
          } catch {
            // Already logged + Sentry-captured by retryWithBackoff. The
            // user's response continues — brain may be out of sync until
            // the next research session re-syncs the same facts.
          }
        } catch (brainErr: any) {
          console.warn("[SessionResearch] Brain update failed:", brainErr.message);
        }
      }

      await storage.logTransaction({
        userId: req.user!.id,
        type: "session_research",
        description: `Research: "${message.slice(0, 80)}"`,
        amount: result.mppCost.toFixed(4),
        apiCost: result.mppCost.toFixed(4),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costBasis: result.costBasis,
      });

      clearInterval(keepalive);

      sendEvent("done", {
        message: assistantMsg,
        artifacts,
        mppCost: result.mppCost,
        toolCalls: result.toolCalls,
        needsContinuation: result.needsContinuation || false,
      });

      res.end();
    } catch (e: any) {
      if (keepalive) clearInterval(keepalive);
      console.error("[SessionResearch] Error:", e.message);
      if (!res.headersSent) {
        res.status(500).json({ message: e.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
        res.end();
      }
    } finally {
      if (slotAcquired) releaseResearchSlot(userId);
    }
  });

  app.post("/api/research/sessions/:id/share", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      if (session.shareToken) {
        return res.json({ shareToken: session.shareToken });
      }
      const token = crypto.randomBytes(16).toString("hex");
      await storage.setConversationShareToken(id, token);
      res.json({ shareToken: token });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/sessions/:id/share", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      await storage.setConversationShareToken(id, null);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shared/research/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const session = await storage.getConversationByShareToken(token);
      if (!session) return res.status(404).json({ message: "Shared session not found" });
      const msgs = await storage.getMessages(session.id);
      const user = session.userId ? await storage.getUser(session.userId) : null;
      res.json({
        title: session.title,
        createdAt: session.createdAt,
        author: user?.username || "Anonymous",
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          artifacts: m.artifacts,
          createdAt: m.createdAt,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/sessions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      await storage.deleteConversation(session.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/messages/:msgId/save-to-report", requireAuth, async (req, res) => {
    try {
      const msgId = parseInt(req.params.msgId);
      if (isNaN(msgId)) return res.status(400).json({ message: "Invalid message ID" });
      const userId = req.user!.id;

      const msg = await storage.getMessage(msgId);
      if (!msg) return res.status(404).json({ message: "Message not found" });

      const conversation = await storage.getConversation(msg.conversationId);
      if (!conversation || conversation.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const content = msg.content.replace(/^<!--\s*mode:\w+\s*-->\s*\n?/, "");
      const { extractMemoMetadata } = await import("@shared/memo-metadata");
      const { title, description } = extractMemoMetadata(content, conversation.title);

      const { researchReports } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const [report] = await dbImport.insert(researchReports).values({
        userId,
        title,
        description,
        content,
        sourceConversationId: conversation.id,
        sourceMessageId: msg.id,
      }).returning();

      res.json({ id: report.id, title: report.title });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/messages/:msgId/save-as-model", requireAuth, async (req, res) => {
    try {
      const msgId = parseInt(req.params.msgId);
      if (isNaN(msgId)) return res.status(400).json({ message: "Invalid message ID" });
      const userId = req.user!.id;

      const msg = await storage.getMessage(msgId);
      if (!msg) return res.status(404).json({ message: "Message not found" });

      const conversation = await storage.getConversation(msg.conversationId);
      if (!conversation || conversation.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const content = msg.content.replace(/^<!--\s*mode:\w+\s*-->\s*\n?/, "");
      const allArtifacts: any[] = Array.isArray(msg.artifacts) ? msg.artifacts : [];

      const artifactIndex = typeof req.body.artifactIndex === "number" ? req.body.artifactIndex : null;
      const artifacts = artifactIndex !== null && artifactIndex >= 0 && artifactIndex < allArtifacts.length
        ? [allArtifacts[artifactIndex]]
        : allArtifacts;

      const singleArtifact = artifactIndex !== null ? artifacts[0] : null;
      const defaultTitle = singleArtifact?.title || content.split("\n").find((l: string) => l.trim())?.replace(/^#+\s*/, "").slice(0, 100) || "Financial Model";
      const title = req.body.title || defaultTitle;

      const sections: any[] = [];
      const assumptions: any[] = [];
      const sources: any[] = [];

      for (const artifact of artifacts) {
        if (artifact.type === "table") {
          sections.push({
            type: "table",
            title: artifact.title || "Data",
            columns: artifact.columns || [],
            data: artifact.data || [],
          });
        } else if (artifact.type === "metric_cards") {
          sections.push({
            type: "metrics",
            title: artifact.title || "Key Metrics",
            data: artifact.data || [],
          });
        } else if (artifact.type === "chart") {
          sections.push({
            type: "chart",
            title: artifact.title || "Chart",
            subtitle: artifact.subtitle,
            source: artifact.source,
            chartConfig: artifact.chartConfig || {},
            data: artifact.data || [],
          });
        } else if (artifact.type === "comparison") {
          sections.push({
            type: "comparison",
            title: artifact.title || "Comparison",
            left: artifact.left,
            right: artifact.right,
          });
        } else if (artifact.type === "callout") {
          if (artifact.variant === "insight" || artifact.variant === "catch") {
            assumptions.push({ text: artifact.text, title: artifact.title, variant: artifact.variant });
          } else {
            sections.push({ type: "callout", title: artifact.title, text: artifact.text, variant: artifact.variant });
          }
        }
      }

      const urlRegex = /\bhttps?:\/\/[^\s\)]+/g;
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
      const seenUrls = new Set<string>();
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        if (!seenUrls.has(match[2])) {
          sources.push({ label: match[1], url: match[2] });
          seenUrls.add(match[2]);
        }
      }
      while ((match = urlRegex.exec(content)) !== null) {
        if (!seenUrls.has(match[0])) {
          sources.push({ label: match[0], url: match[0] });
          seenUrls.add(match[0]);
        }
      }

      const assumptionPatterns = [
        /(?:assum|key assumption|we assume|our assumption|baseline assumption)[:\s]+([^\n]+)/gi,
        /(?:bear case|base case|bull case)[:\s]+([^\n]+)/gi,
      ];
      for (const pattern of assumptionPatterns) {
        let aMatch;
        while ((aMatch = pattern.exec(content)) !== null) {
          const text = aMatch[1].trim();
          if (text.length > 10 && text.length < 500) {
            const existing = assumptions.find(a => a.text === text);
            if (!existing) assumptions.push({ text, title: "Assumption", variant: "assumption" });
          }
        }
      }

      const scenarioRegex = /###?\s*(bear|base|bull)\s*(case|scenario)/gi;
      const scenarioMatches: { type: string; startIdx: number; headerLen: number }[] = [];
      let sMatch;
      while ((sMatch = scenarioRegex.exec(content)) !== null) {
        scenarioMatches.push({ type: sMatch[1].toLowerCase(), startIdx: sMatch.index, headerLen: sMatch[0].length });
      }
      if (scenarioMatches.length > 0) {
        const scenarioSection = { type: "scenarios" as const, title: "Scenario Analysis", scenarios: [] as any[] };
        for (let si = 0; si < scenarioMatches.length; si++) {
          const sm = scenarioMatches[si];
          const bodyStart = sm.startIdx + sm.headerLen;
          const bodyEnd = si + 1 < scenarioMatches.length ? scenarioMatches[si + 1].startIdx : Math.min(bodyStart + 1000, content.length);
          const nextHeaderInSlice = content.slice(bodyStart, bodyEnd).match(/^###?\s/m);
          const actualEnd = nextHeaderInSlice && nextHeaderInSlice.index !== undefined ? bodyStart + nextHeaderInSlice.index : bodyEnd;
          const scenarioContent = content.slice(bodyStart, actualEnd).trim().split("\n").filter(l => l.trim()).slice(0, 10);
          scenarioSection.scenarios.push({ type: sm.type, lines: scenarioContent });
        }
        if (scenarioSection.scenarios.length > 0) sections.push(scenarioSection);
      }

      const model = await storage.createFinancialModel({
        userId,
        title,
        subtitle: conversation.title || undefined,
        sourceMessageId: msgId,
        sourceConversationId: msg.conversationId,
        sections,
        assumptions,
        sources,
      });

      res.json({ id: model.id, title: model.title });
    } catch (e: any) {
      console.error("[save-as-model] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/charts/save", requireAuth, async (req, res) => {
    try {
      const { title, chartType, chartConfig, data, description, refreshRecipe } = req.body;
      if (!title || !data) {
        return res.status(400).json({ message: "Title and data are required" });
      }

      let resolvedDataSource = "session";
      let dsConfig: any = { source: "session_research" };

      if (refreshRecipe) {
        dsConfig.refreshRecipe = refreshRecipe;
        if (refreshRecipe.dataSource === "dune" && refreshRecipe.queryId) {
          resolvedDataSource = "dune";
          dsConfig.queryId = refreshRecipe.queryId;
          dsConfig.params = refreshRecipe.params || {};
        } else if (refreshRecipe.dataSource === "defillama" || refreshRecipe.dataSource === "defi-llama") {
          resolvedDataSource = "defillama";
          dsConfig.endpoint = refreshRecipe.metric || refreshRecipe.endpoint;
          dsConfig.slug = refreshRecipe.slug;
        } else if (refreshRecipe.dataSource) {
          resolvedDataSource = refreshRecipe.dataSource;
        }
      }

      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const [chart] = await dbImport.insert(dashboardCharts).values({
        userId: req.user!.id,
        title,
        description: description || null,
        chartType: chartType || "line",
        dataSource: resolvedDataSource,
        dataSourceConfig: JSON.stringify(dsConfig),
        chartConfig: JSON.stringify(chartConfig || {}),
        data: JSON.stringify(data),
        status: "complete",
      }).returning();

      res.json({ id: chart.id, title: chart.title });
    } catch (e: any) {
      console.error("[save-chart] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/charts/saved", requireAuth, async (req, res) => {
    try {
      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, desc } = await import("drizzle-orm");
      const charts = await dbImport.select({
        id: dashboardCharts.id,
        title: dashboardCharts.title,
        chartType: dashboardCharts.chartType,
        dataSource: dashboardCharts.dataSource,
        dataSourceConfig: dashboardCharts.dataSourceConfig,
        chartConfig: dashboardCharts.chartConfig,
        data: dashboardCharts.data,
        description: dashboardCharts.description,
        createdAt: dashboardCharts.createdAt,
        updatedAt: dashboardCharts.updatedAt,
      }).from(dashboardCharts)
        .where(eq(dashboardCharts.userId, req.user!.id))
        .orderBy(desc(dashboardCharts.createdAt))
        .limit(100);
      res.json(charts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/charts/:id", requireAuth, async (req, res) => {
    try {
      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      const [chart] = await dbImport.select().from(dashboardCharts)
        .where(and(eq(dashboardCharts.id, req.params.id), eq(dashboardCharts.userId, req.user!.id)));
      if (!chart) return res.status(404).json({ message: "Chart not found" });
      res.json(chart);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/charts/:id/refresh", requireAuth, async (req, res) => {
    try {
      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      const [chart] = await dbImport.select().from(dashboardCharts)
        .where(and(eq(dashboardCharts.id, req.params.id), eq(dashboardCharts.userId, req.user!.id)));
      if (!chart) return res.status(404).json({ message: "Chart not found" });

      const dsConfig = JSON.parse(chart.dataSourceConfig || "{}");
      let recipe = dsConfig.refreshRecipe;

      if (!recipe && chart.dataSource === "dune" && dsConfig.queryId) {
        recipe = { dataSource: "dune", queryId: dsConfig.queryId, params: dsConfig.params || {} };
      } else if (!recipe && chart.dataSource === "defillama" && dsConfig.endpoint) {
        recipe = { dataSource: "defillama", metric: dsConfig.endpoint, slug: dsConfig.slug, protocol: dsConfig.slug };
      } else if (!recipe && chart.dataSource === "stonks") {
        recipe = { dataSource: "stonks", endpoint: dsConfig.endpoint || "summary" };
      }

      if (!recipe) return res.status(400).json({ message: "This chart does not have a refresh recipe" });

      const { executeRefreshRecipe } = await import("../session-research-agent");
      console.log(`[RefreshChart] Refreshing chart ${chart.id}:`, JSON.stringify(recipe).slice(0, 100));
      const startTime = Date.now();

      let result: { data: any[]; chartConfig: any };
      if (recipe.dataSource === "dune" && recipe.queryId) {
        const { getLatestDuneResults, executeDuneQuery } = await import("../dune-client");
        let rawData;
        try {
          rawData = await getLatestDuneResults(recipe.queryId);
        } catch {
          rawData = await executeDuneQuery(recipe.queryId, recipe.params || {});
        }
        const rows = rawData?.rows || [];
        const existingConfig = JSON.parse(chart.chartConfig || "{}");
        result = { data: rows, chartConfig: existingConfig };
      } else if (recipe.dataSource === "dune-sql" && recipe.sql) {
        const { executeDuneSQL } = await import("../dune-client");
        const rawData = await executeDuneSQL(recipe.sql);
        const rows = rawData?.rows || [];
        const existingConfig = JSON.parse(chart.chartConfig || "{}");
        result = { data: rows, chartConfig: existingConfig };
      } else if (recipe.dataSource === "coingecko" && recipe.coinId) {
        const resp = await fetch(`https://api.coingecko.com/api/v3/coins/${recipe.coinId}/market_chart?vs_currency=usd&days=${recipe.daysBack || 365}`);
        if (!resp.ok) throw new Error(`CoinGecko API error: ${resp.status}`);
        const cgData = await resp.json();
        const rows = (cgData.prices || []).map((p: [number, number]) => ({
          date: Math.floor(p[0] / 1000),
          price: p[1],
        }));
        const existingConfig = JSON.parse(chart.chartConfig || "{}");
        result = { data: rows, chartConfig: existingConfig };
      } else if (recipe.dataSource === "stonks") {
        const apiKey = process.env.STONKS_API_KEY;
        if (!apiKey) throw new Error("Stonks API key not configured");
        const endpoint = recipe.endpoint || "summary";
        const resp = await fetch(`https://api.stonksonchain.com/v1/hyperliquid/${endpoint}`, {
          headers: { "x-api-key": apiKey },
        });
        if (!resp.ok) throw new Error(`Stonks API error: ${resp.status}`);
        const freshData = await resp.json();
        const rows = Array.isArray(freshData) ? freshData : [freshData];
        const existingConfig = JSON.parse(chart.chartConfig || "{}");
        result = { data: rows, chartConfig: existingConfig };
      } else if (recipe.dataSource === "defillama" && recipe.endpoint) {
        const defillama = await import("../defillama-client");
        const slug = recipe.slug || recipe.protocol;
        let rows: any[] = [];
        if (recipe.endpoint === "tvl") {
          const tvlData = await defillama.getProtocolTvl(slug);
          rows = (tvlData || []).map((d: any) => ({ date: d.date, tvl: d.totalLiquidityUSD }));
        } else if (recipe.endpoint === "fees") {
          const feesData = await defillama.getProtocolFees(slug);
          rows = (feesData?.totalDataChart || []).map((d: any) => ({ date: d[0], fees: d[1] }));
        } else if (recipe.endpoint === "revenue") {
          const revData = await defillama.getProtocolRevenue(slug);
          rows = (revData?.totalDataChart || []).map((d: any) => ({ date: d[0], revenue: d[1] }));
        }
        const existingConfig = JSON.parse(chart.chartConfig || "{}");
        result = { data: rows, chartConfig: existingConfig };
      } else {
        // Pass userId so the resolver inside the derived-metrics pipeline can
        // promote the user's stonksonchain (or other) preference — without
        // it, share-of-X charts whose numerator is a HIP-3 deployer silently
        // resolve to defillama.dex_volume (empty) and refresh returns 0 pts.
        result = await executeRefreshRecipe(recipe, { userId: req.user!.id });
      }

      // Normalize refreshed rows so they match the chart's stored shape.
      // Two distinct mismatches we observed:
      //   1) Scale: DefiLlama returns absolute dollars (14_197_275_351) but
      //      the chart's data was emitted scaled to billions (10.9) with the
      //      unit carried in the yAxis label ("TVL ($B)"). Without scaling,
      //      the renderer treats raw dollars as billions → "$14B BILLIONS".
      //   2) Column names: Dune-SQL returns native column names ("weekly_revenue",
      //      "week_start", "avg_price") but the chart's yAxes were configured
      //      with display names ("Weekly Revenue", "HYPE Price") with xAxis
      //      "week". With no overlap the chart finds nothing to plot → blank.
      // We don't get to change the original artifact — the chart is already
      // saved — so refresh has to bend its output to match.
      result = normalizeRefreshOutput(result, chart);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[RefreshChart] Done in ${elapsed}s — ${result.data.length} data points`);

      await dbImport.update(dashboardCharts)
        .set({
          data: JSON.stringify(result.data),
          chartConfig: JSON.stringify(result.chartConfig),
          updatedAt: new Date(),
        })
        .where(eq(dashboardCharts.id, chart.id));

      res.json({
        id: chart.id,
        data: result.data,
        chartConfig: result.chartConfig,
        updatedAt: new Date().toISOString(),
        dataPoints: result.data.length,
        refreshTimeMs: Date.now() - startTime,
      });
    } catch (e: any) {
      console.error("[RefreshChart] failed:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/charts/:id", requireAuth, async (req, res) => {
    try {
      const { dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      await dbImport.delete(dashboardCharts)
        .where(and(eq(dashboardCharts.id, req.params.id), eq(dashboardCharts.userId, req.user!.id)));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/reports", requireAuth, async (req, res) => {
    try {
      const { researchReports, messages, conversations } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, desc, inArray } = await import("drizzle-orm");
      const { extractMemoMetadata } = await import("@shared/memo-metadata");

      const reports = await dbImport.select().from(researchReports)
        .where(eq(researchReports.userId, req.user!.id))
        .orderBy(desc(researchReports.updatedAt));

      // Recompute title + description from the source message when we can.
      // Older memos were saved with a naive "sessionTitle — firstLine" title
      // and a raw truncated content for description; regenerating on read
      // cleans them up without a destructive migration.
      const msgIds = reports
        .map(r => r.sourceMessageId)
        .filter((id): id is number => typeof id === "number");
      const convIds = reports
        .map(r => r.sourceConversationId)
        .filter((id): id is number => typeof id === "number");

      const msgs = msgIds.length
        ? await dbImport.select().from(messages).where(inArray(messages.id, msgIds))
        : [];
      const convs = convIds.length
        ? await dbImport.select().from(conversations).where(inArray(conversations.id, convIds))
        : [];
      const msgById = new Map(msgs.map(m => [m.id, m]));
      const convById = new Map(convs.map(c => [c.id, c]));

      const enriched = reports.map(r => {
        const msg = r.sourceMessageId != null ? msgById.get(r.sourceMessageId) : null;
        const conv = r.sourceConversationId != null ? convById.get(r.sourceConversationId) : null;
        const rawContent = msg?.content || r.content;
        if (!rawContent) return r;
        const { title, description } = extractMemoMetadata(rawContent, conv?.title);
        return { ...r, title, description };
      });

      res.json(enriched);
    } catch (e: any) {
      console.error("[GET /api/research/reports]", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/reports", requireAuth, async (req, res) => {
    try {
      const { title, description } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const { researchReports } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const [report] = await dbImport.insert(researchReports).values({
        userId: req.user!.id,
        title,
        description: description || null,
      }).returning();
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/reports/:id", requireAuth, async (req, res) => {
    try {
      const { researchReports, reportCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      await dbImport.delete(reportCharts).where(eq(reportCharts.reportId, req.params.id));
      await dbImport.delete(researchReports)
        .where(and(eq(researchReports.id, req.params.id), eq(researchReports.userId, req.user!.id)));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/reports/:id/charts", requireAuth, async (req, res) => {
    try {
      const { chartId } = req.body;
      if (!chartId) return res.status(400).json({ message: "chartId is required" });
      const { reportCharts, researchReports } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      const [report] = await dbImport.select().from(researchReports)
        .where(and(eq(researchReports.id, req.params.id), eq(researchReports.userId, req.user!.id)));
      if (!report) return res.status(404).json({ message: "Report not found" });

      const existing = await dbImport.select().from(reportCharts)
        .where(and(eq(reportCharts.reportId, req.params.id), eq(reportCharts.chartId, chartId)));
      if (existing.length > 0) return res.json({ message: "Chart already in report" });

      const [rc] = await dbImport.insert(reportCharts).values({
        reportId: req.params.id,
        chartId,
      }).returning();
      res.json(rc);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/reports/:reportId/charts/:chartId", requireAuth, async (req, res) => {
    try {
      const { reportCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq, and } = await import("drizzle-orm");
      await dbImport.delete(reportCharts)
        .where(and(eq(reportCharts.reportId, req.params.reportId), eq(reportCharts.chartId, req.params.chartId)));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/reports/:id/charts", requireAuth, async (req, res) => {
    try {
      const { reportCharts, dashboardCharts } = await import("@shared/schema");
      const { db: dbImport } = await import("../db");
      const { eq } = await import("drizzle-orm");
      const rcs = await dbImport.select().from(reportCharts)
        .where(eq(reportCharts.reportId, req.params.id))
        .orderBy(reportCharts.sortOrder);
      const chartIds = rcs.map(rc => rc.chartId);
      if (chartIds.length === 0) return res.json([]);
      const { inArray } = await import("drizzle-orm");
      const charts = await dbImport.select().from(dashboardCharts)
        .where(inArray(dashboardCharts.id, chartIds));
      const orderedCharts = chartIds.map(id => charts.find(c => c.id === id)).filter(Boolean);
      res.json(orderedCharts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/models", requireAuth, async (req, res) => {
    try {
      const models = await storage.getFinancialModels(req.user!.id);
      res.json({ models });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/models/:id", requireAuth, async (req, res) => {
    try {
      const model = await storage.getFinancialModel(req.params.id);
      if (!model) return res.status(404).json({ message: "Model not found" });
      if (model.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });
      res.json(model);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/models/:id", requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteFinancialModel(req.params.id, req.user!.id);
      if (!deleted) return res.status(404).json({ message: "Model not found" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/analyst/overview", requireAuth, async (_req, res) => {
    try {
      const { getAnalystOverviews } = await import("../analyst-corpus");
      const { ANALYST_DISPLAY } = await import("@shared/schema");
      const overviews = await getAnalystOverviews();
      res.json({
        analysts: overviews.map((o) => ({ ...o, displayName: ANALYST_DISPLAY[o.analyst] })),
      });
    } catch (e: any) {
      console.error("[analyst/overview] failed:", e);
      res.status(500).json({ message: e.message || "Failed to load analyst overview" });
    }
  });

  app.get("/api/analyst/:name/frameworks", requireAuth, async (req, res) => {
    try {
      const { listAnalystFrameworks } = await import("../analyst-corpus");
      const items = await listAnalystFrameworks(req.params.name);
      res.json({ items });
    } catch (e: any) {
      console.error("[analyst/frameworks] failed:", e);
      res.status(500).json({ message: e.message || "Failed to load frameworks" });
    }
  });

  app.get("/api/analyst/:name/documents", requireAuth, async (req, res) => {
    try {
      const { listAnalystDocuments } = await import("../analyst-corpus");
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = req.query.limit ? Math.max(1, parseInt(String(req.query.limit), 10) || 30) : 30;
      const offset = req.query.offset ? Math.max(0, parseInt(String(req.query.offset), 10) || 0) : 0;
      const data = await listAnalystDocuments({ analyst: req.params.name, q, limit, offset });
      res.json(data);
    } catch (e: any) {
      console.error("[analyst/documents] failed:", e);
      res.status(500).json({ message: e.message || "Failed to load documents" });
    }
  });

  app.get("/api/pipeline-brain", requireAuth, async (req, res) => {
    try {
      const { derivePipelineBrain } = await import("../pipeline-brain");
      const data = await derivePipelineBrain(req.user!.id);
      res.json(data);
    } catch (e: any) {
      console.error("[pipeline-brain] derivation failed:", e);
      res.status(500).json({ message: e.message || "Failed to derive pipeline brain" });
    }
  });

  app.get("/api/data-brain/stats", requireAuth, async (_req, res) => {
    try {
      const { getStats } = await import("../data-source-brain/db");
      const stats = await getStats();
      const provenCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM proven_queries WHERE is_active = true`);
      const provenByProtocol = await db.execute(sql`SELECT protocol, COUNT(*) as cnt, MAX(success_count) as max_success FROM proven_queries WHERE is_active = true GROUP BY protocol ORDER BY cnt DESC LIMIT 30`);
      const learningsCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM system_learnings WHERE is_active = true`);
      const learningsByScope = await db.execute(sql`SELECT scope, COUNT(*) as cnt FROM system_learnings WHERE is_active = true GROUP BY scope ORDER BY cnt DESC`);
      res.json({
        facts: stats,
        provenQueries: {
          total: Number((provenCount as any).rows?.[0]?.cnt || 0),
          byProtocol: (provenByProtocol as any).rows || [],
        },
        systemLearnings: {
          total: Number((learningsCount as any).rows?.[0]?.cnt || 0),
          byScope: (learningsByScope as any).rows || [],
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/data-brain/proven-queries", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const protocol = req.query.protocol as string | undefined;
      const where = protocol
        ? sql`WHERE is_active = true AND protocol ILIKE ${'%' + protocol + '%'}`
        : sql`WHERE is_active = true`;
      const rows = await db.execute(sql`SELECT id, protocol, metric_type, sql_query, chart_type, success_count, fail_count, last_used, created_at FROM proven_queries ${where} ORDER BY success_count DESC, last_used DESC LIMIT ${limit}`);
      res.json((rows as any).rows || []);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/data-brain/facts", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const source = req.query.source as string | undefined;
      const where = source
        ? sql`WHERE source = ${source}`
        : sql``;
      const rows = await db.execute(sql`SELECT id, source, scope, scope_ref, category, content, confidence, source_of_fact, observed_count, created_at, last_seen_at FROM data_source_facts ${where} ORDER BY last_seen_at DESC LIMIT ${limit}`);
      res.json((rows as any).rows || []);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/data-brain/learnings", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await db.execute(sql`SELECT id, scope, scope_key, rule_type, rule_text, confidence, source, applied_count, is_active, created_at FROM system_learnings WHERE is_active = true ORDER BY applied_count DESC, created_at DESC LIMIT ${limit}`);
      res.json((rows as any).rows || []);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
