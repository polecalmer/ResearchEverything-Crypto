/**
 * Prior-work pre-flight — runs at the top of every focused/deep turn.
 *
 * Background: the chart-mode router used to vector-search the
 * `proven_queries` library before the agent loop fired and inject
 * `[CACHE-HIT CANDIDATE]` hints into the system prompt. When chart
 * mode was removed (2026-05-19), that pre-flight died with it. The
 * cost of a regression: a turn that asked the same question as
 * yesterday's session re-authored fresh SQL from scratch ($6.21
 * deep run) instead of reusing the cached SQL ($0.30 cache hit).
 *
 * This module restores the pre-flight, mounts it mode-agnostically,
 * and broadens it to surface ALL prior work — not just proven_queries.
 *
 * Sources scanned (in parallel):
 *   1. proven_queries        — yesterday's Dune SQL, vector-searched
 *   2. dashboard_charts      — saved charts in the library, fuzzy-
 *                              matched on (protocol, metric) extracted
 *                              from the prompt
 *   3. financial_models      — saved financial models, fuzzy-matched
 *                              on protocol
 *   4. brain_facts (recent)  — last 7 days of validated numeric facts
 *                              about the prompt's entities
 *
 * Output: a single `<prior_work_detected>...</prior_work_detected>`
 * block injected into the system prompt BEFORE the agent decides
 * what tools to call. The agent then has a choice — reuse + refresh,
 * or build fresh.
 *
 * Cost: ~$0 (vector search is local pgvector + indexed lookups).
 * Latency: ~100-300ms typical, 500ms p99. Always best-effort — any
 * failure logs + falls back to "no prior work injected".
 */

import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { extractCanonicalEntities, displayProtocolName } from "./protocol-canonical";

export interface PriorWorkResult {
  /** The system-prompt addendum to splice in (empty string if no
   *  prior work found). */
  promptBlock: string;
  /** Telemetry — counts of what was found, for logging. */
  counts: {
    provenQueries: number;
    savedCharts: number;
    financialModels: number;
    recentFacts: number;
  };
  /** How long the pre-flight took, total. */
  durationMs: number;
}

// Entity extraction moved into protocol-canonical.ts so write and
// read sides share a single alias table. `extractCanonicalEntities`
// returns the same lowercase canonical keys we now store in
// brain_facts.entities[] and brain_entities.entity_name.
function extractEntities(userMessage: string): string[] {
  return extractCanonicalEntities(userMessage);
}

/**
 * Run the pre-flight. ALL 4 lookups fire in parallel. Each is wrapped
 * in its own try/catch so one failing doesn't kill the others.
 */
export async function buildPriorWorkBlock(
  userMessage: string,
  userId: string | undefined,
): Promise<PriorWorkResult> {
  const t0 = Date.now();
  const entities = extractEntities(userMessage);

  const [provenQueries, savedCharts, financialModels, recentFacts] = await Promise.all([
    fetchProvenQueries(userMessage).catch((err) => {
      logger.warn?.({ err: err?.message }, "prior-work: proven-queries lookup failed");
      return [] as ProvenQueryHit[];
    }),
    fetchSavedCharts(entities, userId).catch((err) => {
      logger.warn?.({ err: err?.message }, "prior-work: saved-charts lookup failed");
      return [] as SavedChartHit[];
    }),
    fetchFinancialModels(entities, userId).catch((err) => {
      logger.warn?.({ err: err?.message }, "prior-work: financial-models lookup failed");
      return [] as FinancialModelHit[];
    }),
    fetchRecentBrainFacts(entities, userId).catch((err) => {
      logger.warn?.({ err: err?.message }, "prior-work: brain-facts lookup failed");
      return [] as BrainFactHit[];
    }),
  ]);

  const counts = {
    provenQueries: provenQueries.length,
    savedCharts: savedCharts.length,
    financialModels: financialModels.length,
    recentFacts: recentFacts.length,
  };
  const totalHits = counts.provenQueries + counts.savedCharts + counts.financialModels + counts.recentFacts;
  const durationMs = Date.now() - t0;

  if (totalHits === 0) {
    return { promptBlock: "", counts, durationMs };
  }

  const promptBlock = renderPromptBlock({
    provenQueries,
    savedCharts,
    financialModels,
    recentFacts,
    entities,
  });

  logger.info?.(
    {
      entities,
      counts,
      durationMs,
    },
    "prior-work pre-flight surfaced cached work",
  );

  return { promptBlock, counts, durationMs };
}

/* ─── Source 1: proven_queries (Dune SQL, vector-indexed) ─── */

interface ProvenQueryHit {
  protocol: string;
  metricType: string;
  similarity: number | null;
  successCount: number;
  sqlPreview: string;
}

async function fetchProvenQueries(userMessage: string): Promise<ProvenQueryHit[]> {
  const { findProvenQueryByIntent } = await import("./proven-queries-search");
  const matches = await findProvenQueryByIntent(userMessage, {
    minSimilarity: 0.55,
    topK: 3,
  });
  return matches.map((m) => ({
    protocol: m.query.protocol,
    metricType: m.query.metricType,
    similarity: m.similarity ?? null,
    successCount: m.query.successCount ?? 0,
    // Cap SQL preview at 800 chars so the prompt doesn't blow up
    sqlPreview: (m.query.sqlQuery || "").slice(0, 800),
  }));
}

/* ─── Source 2: dashboard_charts (saved charts in the library) ─── */

interface SavedChartHit {
  id: string;
  title: string;
  chartType: string;
  description: string | null;
  updatedAt: Date;
  ageDays: number;
}

async function fetchSavedCharts(
  entities: string[],
  userId: string | undefined,
): Promise<SavedChartHit[]> {
  if (entities.length === 0 || !userId) return [];
  // Match on title OR display-name aliases — chart titles are often
  // written as "HYPE Price" or "Hyperliquid Revenue", so we expand
  // each canonical key (e.g. "hyperliquid") to BOTH the canonical
  // AND the display ("Hyperliquid"). Plus the ticker via the alias
  // regex baked into the canonical table. ILIKE is a cheap full-table
  // scan on a single user's <100 charts.
  const patterns = entities.flatMap((e) => {
    const display = displayProtocolName(e);
    return display && display.toLowerCase() !== e
      ? [`%${e}%`, `%${display.toLowerCase()}%`]
      : [`%${e}%`];
  });
  const rows = await db.execute(sql`
    SELECT id, title, chart_type, description, updated_at,
           EXTRACT(EPOCH FROM (now() - updated_at)) / 86400 AS age_days
    FROM dashboard_charts
    WHERE user_id = ${userId}
      AND status = 'complete'
      AND (${sql.join(patterns.map((p) => sql`lower(title) ILIKE ${p}`), sql` OR `)})
    ORDER BY updated_at DESC
    LIMIT 5
  `);
  const raw: any[] = (rows as any).rows ?? rows;
  return raw.map((r) => ({
    id: r.id,
    title: r.title,
    chartType: r.chart_type,
    description: r.description ?? null,
    updatedAt: r.updated_at,
    ageDays: Math.round(Number(r.age_days) * 10) / 10,
  }));
}

/* ─── Source 3: financial_models ─── */

interface FinancialModelHit {
  id: string;
  title: string;
  subtitle: string | null;
  updatedAt: Date;
  ageDays: number;
  sourceConversationId: number | null;
}

async function fetchFinancialModels(
  entities: string[],
  userId: string | undefined,
): Promise<FinancialModelHit[]> {
  if (entities.length === 0 || !userId) return [];
  // Same expansion as saved-charts: match canonical key + display name.
  const patterns = entities.flatMap((e) => {
    const display = displayProtocolName(e);
    return display && display.toLowerCase() !== e
      ? [`%${e}%`, `%${display.toLowerCase()}%`]
      : [`%${e}%`];
  });
  const rows = await db.execute(sql`
    SELECT id, title, subtitle, updated_at, source_conversation_id,
           EXTRACT(EPOCH FROM (now() - updated_at)) / 86400 AS age_days
    FROM financial_models
    WHERE user_id = ${userId}
      AND status = 'complete'
      AND (${sql.join(patterns.map((p) => sql`lower(title) ILIKE ${p}`), sql` OR `)})
    ORDER BY updated_at DESC
    LIMIT 3
  `);
  const raw: any[] = (rows as any).rows ?? rows;
  return raw.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle ?? null,
    updatedAt: r.updated_at,
    sourceConversationId: r.source_conversation_id ?? null,
    ageDays: Math.round(Number(r.age_days) * 10) / 10,
  }));
}

/* ─── Source 4: brain_facts (recent validated numbers about entities) ─── */

interface BrainFactHit {
  topic: string;
  fact: string;
  source: string | null;
  factDate: string | null;
  confidence: string | null;
  ageDays: number;
}

async function fetchRecentBrainFacts(
  entities: string[],
  userId: string | undefined,
): Promise<BrainFactHit[]> {
  if (entities.length === 0 || !userId) return [];
  // Expand canonical → canonical + display so we match facts stored
  // under either label during the fragmentation era.
  const patterns = entities.flatMap((e) => {
    const display = displayProtocolName(e);
    return display && display.toLowerCase() !== e
      ? [`%${e}%`, `%${display.toLowerCase()}%`]
      : [`%${e}%`];
  });
  // brain_facts columns (actual schema): id, user_id, fact_id, topic,
  // fact, entities (text[]), source, date, confidence, embedding,
  // content_tsv, created_at. No value/unit columns — those live
  // inside the prose of `fact` itself. Match on topic OR the
  // `entities` array via ANY().
  // For the entities[] array match, expand each canonical back to ALL
  // known aliases (canonical + display-lowercase) so we catch facts
  // stored during the fragmentation era under e.g. "hype" instead of
  // "hyperliquid".
  const entityKeys = Array.from(new Set(
    entities.flatMap((e) => {
      const display = displayProtocolName(e);
      return display ? [e, display.toLowerCase()] : [e];
    }),
  ));
  const rows = await db.execute(sql`
    SELECT topic, fact, source, date, confidence,
           EXTRACT(EPOCH FROM (now() - created_at)) / 86400 AS age_days
    FROM brain_facts
    WHERE user_id = ${userId}
      AND created_at > now() - interval '7 days'
      AND (
        (${sql.join(patterns.map((p) => sql`lower(topic) ILIKE ${p}`), sql` OR `)})
        OR (${sql.join(entityKeys.map((k) => sql`${k} = ANY(entities)`), sql` OR `)})
      )
    ORDER BY created_at DESC
    LIMIT 10
  `);
  const raw: any[] = (rows as any).rows ?? rows;
  return raw.map((r) => ({
    topic: r.topic,
    fact: r.fact,
    source: r.source ?? null,
    factDate: r.date ?? null,
    confidence: r.confidence ?? null,
    ageDays: Math.round(Number(r.age_days) * 10) / 10,
  }));
}

/* ─── Render: build the <prior_work_detected> block ─── */

function renderPromptBlock(args: {
  provenQueries: ProvenQueryHit[];
  savedCharts: SavedChartHit[];
  financialModels: FinancialModelHit[];
  recentFacts: BrainFactHit[];
  entities: string[];
}): string {
  const lines: string[] = ["", "<prior_work_detected>"];

  if (args.entities.length > 0) {
    lines.push(`Entities recognized in this prompt: ${args.entities.join(", ")}.`);
    lines.push(`Below is RELEVANT prior work the user (or other users) already produced. STRONGLY PREFER to reuse + refresh over building from scratch.`);
    lines.push("");
  }

  if (args.savedCharts.length > 0) {
    lines.push(`### Saved charts in this user's library (${args.savedCharts.length})`);
    for (const c of args.savedCharts) {
      lines.push(
        `- "${c.title}" (${c.chartType}, ${c.ageDays}d ago, id=${c.id})${
          c.description ? ` — ${c.description.slice(0, 120)}` : ""
        }`,
      );
    }
    lines.push(
      `If a saved chart above matches the user's intent, surface it with a brief "I have this from ${args.savedCharts[0].ageDays}d ago — refreshing now" prose intro and re-emit with fresh data. Do NOT silently re-author from scratch.`,
    );
    lines.push("");
  }

  if (args.financialModels.length > 0) {
    lines.push(`### Saved financial models (${args.financialModels.length})`);
    for (const m of args.financialModels) {
      lines.push(
        `- "${m.title}" (${m.ageDays}d ago, id=${m.id})${
          m.subtitle ? ` — ${m.subtitle.slice(0, 120)}` : ""
        }`,
      );
    }
    lines.push(
      `If the user is asking for analysis on the same protocol, the model above is the prior work. Extend it (don't rebuild the assumptions table from scratch).`,
    );
    lines.push("");
  }

  if (args.provenQueries.length > 0) {
    lines.push(`### Proven Dune queries (vector-matched, ${args.provenQueries.length})`);
    for (const q of args.provenQueries) {
      const simStr = q.similarity != null ? q.similarity.toFixed(3) : "n/a";
      const tag = q.similarity != null && q.similarity >= 0.65 ? " [CACHE-HIT CANDIDATE]" : "";
      lines.push(
        `- [${q.protocol}] "${q.metricType}" (sim=${simStr}, ${q.successCount} prior successes)${tag}`,
      );
      if (q.sqlPreview) {
        const preview = q.sqlPreview.slice(0, 500).replace(/\n/g, " ").trim();
        lines.push(`  SQL: ${preview}${q.sqlPreview.length > 500 ? "..." : ""}`);
      }
    }
    lines.push(
      `If a [CACHE-HIT CANDIDATE] above answers the user's question, execute its SQL directly via dune_execute_query (saves 30+s and avoids re-authoring).`,
    );
    lines.push("");
  }

  if (args.recentFacts.length > 0) {
    lines.push(`### Recent validated brain facts (${args.recentFacts.length}, last 7 days)`);
    for (const f of args.recentFacts) {
      const ageStr = f.ageDays < 1 ? `<1d ago` : `${f.ageDays}d ago`;
      const srcStr = f.source ? ` [${f.source}]` : "";
      const confStr = f.confidence && f.confidence !== "verified" ? ` (${f.confidence})` : "";
      lines.push(`- ${f.topic}: ${f.fact.slice(0, 160)} (${ageStr}${srcStr}${confStr})`);
    }
    lines.push(
      `These facts are ALREADY VALIDATED — cite them in prose; do not re-fetch unless the user explicitly asks for fresh data.`,
    );
    lines.push("");
  }

  lines.push("</prior_work_detected>");
  lines.push("");
  return lines.join("\n");
}
