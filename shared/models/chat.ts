import { pgTable, serial, integer, text, timestamp, jsonb, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  title: text("title").notNull(),
  type: text("type").default("chat").notNull(),
  shareToken: text("share_token"),
  // parentSessionId fingerprints sub-sessions (Build Chart, Double
  // Click) back to the master session that spawned them. Null for
  // top-level sessions started directly by the user. Powers the
  // "research journey" view: render parent + children as a cohesive
  // thread instead of a flat list.
  parentSessionId: integer("parent_session_id"),
  // Source of the spawn — informational only, lets the UI badge each
  // sub-session by what triggered it ("build-chart", "double-click",
  // null for top-level / explicit child).
  spawnSource: text("spawn_source"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const researchBrains = pgTable("research_brains", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  entities: jsonb("entities").default(sql`'{}'::jsonb`).notNull(),
  knowledge: jsonb("knowledge").default(sql`'[]'::jsonb`).notNull(),
  preferences: jsonb("preferences").default(sql`'{}'::jsonb`).notNull(),
  relationships: jsonb("relationships").default(sql`'[]'::jsonb`).notNull(),
  contradictions: jsonb("contradictions").default(sql`'[]'::jsonb`).notNull(),
  meta: jsonb("meta").default(sql`'{}'::jsonb`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  artifacts: jsonb("artifacts"),
  // Optional classification of this message. Currently used to mark deep-mode
  // assistant responses as "deep_model" so they can be surfaced in a saved-
  // models list independently of which conversation they live in.
  kind: text("kind"),
  // Structured ResearchPlan emitted by the planner pre-step. Stored on the
  // user message that triggered planning so a bad assistant response can be
  // traced back to the plan that produced it. Null for quick-mode or
  // pre-planner messages.
  plan: jsonb("plan"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type ResearchBrain = typeof researchBrains.$inferSelect;

// Chart-validator telemetry. One row per chart artifact that runs through
// validateChartArtifact. Lets us tune thresholds, observe false-positive rate,
// and review which classes of issues dominate in the wild. See
// server/chart-validator.ts for the validator that writes here.
export const chartValidations = pgTable("chart_validations", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  conversationId: integer("conversation_id"),
  messageId: integer("message_id"),
  chartTitle: text("chart_title"),
  ok: boolean("ok").notNull(),
  shipped: boolean("shipped").notNull().default(true),
  confidence: text("confidence").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  refereeModel: text("referee_model"),
  // tier{1,2,3}_issues are arrays of {kind, message, modelHint, evidence}.
  tier1Issues: jsonb("tier1_issues").default(sql`'[]'::jsonb`).notNull(),
  tier2Issues: jsonb("tier2_issues").default(sql`'[]'::jsonb`).notNull(),
  tier3Issues: jsonb("tier3_issues").default(sql`'[]'::jsonb`).notNull(),
  groundedFactCount: integer("grounded_fact_count").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  // Snapshot of {first, last, min, max, pctChange, trend, cv} per yAxis,
  // captured at validation time. Useful for after-the-fact debugging.
  seriesStats: jsonb("series_stats"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type ChartValidation = typeof chartValidations.$inferSelect;
