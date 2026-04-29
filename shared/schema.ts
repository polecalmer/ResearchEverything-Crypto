import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, boolean, doublePrecision, vector, index, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Postgres tsvector type — used by hybrid search on data_source_facts.
// Declared so Drizzle's schema diff doesn't try to drop the column on push.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() { return "tsvector"; },
});

export const PIPELINE_STAGES = [
  "discovered",
  "researching",
  "reaching_out",
  "in_diligence",
  "passed",
  "invested",
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  discovered: "Discovered",
  researching: "Researching",
  reaching_out: "Reaching Out",
  in_diligence: "In Diligence",
  passed: "Passed",
  invested: "Invested",
};

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  name: text("name").notNull(),
  oneLiner: text("one_liner").notNull(),
  description: text("description"),
  sector: text("sector"),
  subSector: text("sub_sector"),
  businessModel: text("business_model"),
  stage: text("stage"),
  fundingHistory: text("funding_history"),
  competitiveLandscape: text("competitive_landscape"),
  sourceUrl: text("source_url"),
  websiteUrl: text("website_url"),
  githubUrl: text("github_url"),
  twitterUrl: text("twitter_url"),
  linkedinUrl: text("linkedin_url"),
  pipelineStage: text("pipeline_stage").notNull().default("discovered"),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  imageUrl: text("image_url"),
  excitementScore: integer("excitement_score"),
  excitementReason: text("excitement_reason"),
  adjacentReads: text("adjacent_reads"),
  hasLiquidToken: boolean("has_liquid_token").default(false),
  tokenTier: text("token_tier"),
  tokenTicker: text("token_ticker"),
  tokenContractAddress: text("token_contract_address"),
  tokenChain: text("token_chain"),
  liquidTokenAnalysis: text("liquid_token_analysis"),
  deletedReportCount: integer("deleted_report_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const founders = pgTable("founders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  role: text("role"),
  bio: text("bio"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  githubUrl: text("github_url"),
  personalUrl: text("personal_url"),
  priorCompanies: text("prior_companies"),
});

export const notes = pgTable("notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("generating"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tokenProfiles = pgTable("token_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  contractAddress: text("contract_address").notNull(),
  chain: text("chain").notNull().default("ethereum"),
  tokenTicker: text("token_ticker"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const masterDuneQueries = pgTable("master_dune_queries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  queryId: integer("query_id").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  category: text("category"),
  protocolTags: text("protocol_tags").array().default([]),
  chainTags: text("chain_tags").array().default([]),
  visualizationType: text("visualization_type").notNull().default("table"),
  sourceUrl: text("source_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const duneQueries = pgTable("dune_queries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  queryId: integer("query_id").notNull(),
  label: text("label").notNull(),
  visualizationType: text("visualization_type").notNull().default("table"),
  displayOrder: integer("display_order").notNull().default(0),
  masterQueryId: varchar("master_query_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tokenAnalyses = pgTable("token_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("generating"),
  duneData: text("dune_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dashboardCharts = pgTable("dashboard_charts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  chartType: text("chart_type").notNull().default("line"),
  dataSource: text("data_source").notNull(),
  dataSourceConfig: text("data_source_config").notNull(),
  chartConfig: text("chart_config").notNull(),
  data: text("data"),
  status: text("status").notNull().default("generating"),
  errorMessage: text("error_message"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDashboardChartSchema = createInsertSchema(dashboardCharts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DashboardChart = typeof dashboardCharts.$inferSelect;

export const researchReports = pgTable("research_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  // Optional full-text body — populated when a whole session message is saved
  // as a report via POST /api/research/messages/:msgId/save-to-report. Chart-
  // grouped reports (created via POST /api/research/reports) leave this null
  // and attach charts via the report_charts join table instead.
  content: text("content"),
  sourceConversationId: integer("source_conversation_id"),
  sourceMessageId: integer("source_message_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ResearchReport = typeof researchReports.$inferSelect;

export const reportCharts = pgTable("report_charts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reportId: varchar("report_id").notNull(),
  chartId: varchar("chart_id").notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReportChart = typeof reportCharts.$inferSelect;
export type InsertDashboardChart = z.infer<typeof insertDashboardChartSchema>;

export const securityAuditRuns = pgTable("security_audit_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  budgetUsd: text("budget_usd").notNull().default("5.0"),
  totalSpentUsd: text("total_spent_usd").notNull().default("0"),
  phasesEnabled: text("phases_enabled").array().notNull().default(sql`ARRAY['recon','prompt_extraction','data_exfil','cross_tenant','output_analysis']::text[]`),
  summary: jsonb("summary"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type SecurityAuditRun = typeof securityAuditRuns.$inferSelect;

export const securityAuditFindings = pgTable("security_audit_findings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  phase: text("phase").notNull(),
  testName: text("test_name").notNull(),
  severity: text("severity").notNull(),
  verdict: text("verdict").notNull(),
  promptText: text("prompt_text").notNull(),
  responseText: text("response_text"),
  scoreReason: text("score_reason"),
  costUsd: text("cost_usd").notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SecurityAuditFinding = typeof securityAuditFindings.$inferSelect;

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export const insertFounderSchema = createInsertSchema(founders).omit({
  id: true,
});

export const insertNoteSchema = createInsertSchema(notes).omit({
  id: true,
  createdAt: true,
});

export const insertTokenProfileSchema = createInsertSchema(tokenProfiles).omit({
  id: true,
  createdAt: true,
});

export const insertMasterDuneQuerySchema = createInsertSchema(masterDuneQueries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDuneQuerySchema = createInsertSchema(duneQueries).omit({
  id: true,
  createdAt: true,
});

export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Founder = typeof founders.$inferSelect;
export type InsertFounder = z.infer<typeof insertFounderSchema>;
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Report = typeof reports.$inferSelect;
export type TokenProfile = typeof tokenProfiles.$inferSelect;
export type InsertTokenProfile = z.infer<typeof insertTokenProfileSchema>;
export type MasterDuneQuery = typeof masterDuneQueries.$inferSelect;
export type InsertMasterDuneQuery = z.infer<typeof insertMasterDuneQuerySchema>;
export type DuneQuery = typeof duneQueries.$inferSelect;
export type InsertDuneQuery = z.infer<typeof insertDuneQuerySchema>;
export type TokenAnalysis = typeof tokenAnalyses.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  privyId: text("privy_id").unique(),
  walletAddress: text("wallet_address"),
  email: text("email"),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  credits: integer("credits").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: text("subscription_status"),
  subscriptionId: text("subscription_id"),
  subscriptionPeriodEnd: timestamp("subscription_period_end"),
  telegramChatId: text("telegram_chat_id"),
});

export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  amount: text("amount").notNull(),
  apiCost: text("api_cost"),
  companyName: text("company_name"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  txHash: text("tx_hash"),
  status: text("status").default("success").notNull(),
  costBasis: text("cost_basis"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usageEvents = pgTable("usage_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  event: text("event").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const provenQueries = pgTable("proven_queries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  protocol: text("protocol").notNull(),
  metricType: text("metric_type").notNull(),
  sqlQuery: text("sql_query").notNull(),
  dataSource: text("data_source").notNull().default("dune-sql"),
  chartType: text("chart_type"),
  chartConfig: jsonb("chart_config"),
  xAxisKey: text("x_axis_key"),
  yAxisKey: text("y_axis_key"),
  yAxisLabel: text("y_axis_label"),
  yAxisFormat: text("y_axis_format"),
  successCount: integer("success_count").notNull().default(1),
  failCount: integer("fail_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  lastUsed: timestamp("last_used").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Voyage 1024-d embedding of "<protocol> <metric_type>\n<sql snippet>".
  // Nullable so the column can be added without a backfill blocking the
  // migration. Rows with null embeddings fall back to ILIKE search; the
  // backfill script populates them and saveProvenQuery embeds new rows on
  // write. See server/dune-sql-author.ts:findProvenQueryByIntent.
  embedding: vector("embedding", { dimensions: 1024 }),
  contentTsv: tsvector("content_tsv").generatedAlwaysAs(
    sql`to_tsvector('english', protocol || ' ' || metric_type || ' ' || COALESCE(left(sql_query, 2000), ''))`,
    { mode: "stored" as any },
  ),
}, (table) => ({
  embeddingIdx: index("proven_queries_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  tsvIdx: index("proven_queries_tsv_idx").using("gin", table.contentTsv),
  protocolIdx: index("proven_queries_protocol_idx").on(table.protocol),
}));

export const insertProvenQuerySchema = createInsertSchema(provenQueries).omit({
  id: true,
  successCount: true,
  failCount: true,
  isActive: true,
  lastUsed: true,
  createdAt: true,
  updatedAt: true,
});
export type ProvenQuery = typeof provenQueries.$inferSelect;
export type InsertProvenQuery = z.infer<typeof insertProvenQuerySchema>;

export const systemLearnings = pgTable("system_learnings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scope: text("scope").notNull(),
  scopeKey: text("scope_key").notNull(),
  ruleType: text("rule_type").notNull(),
  ruleText: text("rule_text").notNull(),
  confidence: integer("confidence").notNull().default(50),
  source: text("source").notNull().default("auto"),
  triggeredBy: text("triggered_by"),
  appliedCount: integer("applied_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSystemLearningSchema = createInsertSchema(systemLearnings).omit({
  id: true,
  confidence: true,
  appliedCount: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});
export type SystemLearning = typeof systemLearnings.$inferSelect;
export type InsertSystemLearning = z.infer<typeof insertSystemLearningSchema>;

// ═══════════════════════════════════════════════════════════════
// CORRECTION INGESTION — capture user corrections so the next
// run benefits without the user repeating themselves. Two stores:
// (1) tool_arg_overrides for deterministic substitution at tool-
// call time (slug aliases). (2) brain_facts for vector-recallable
// rebrand/method/fact corrections (existing table, source='user-
// correction'). See docs/internal/correction-ingestion-spec.md.
// ═══════════════════════════════════════════════════════════════

// Deterministic arg-substitution table consulted by every brain-
// aware tool wrapper BEFORE the network call. tool_name='*' means
// "any tool that takes this arg" (used for cross-source slugs like
// the defillama-vs-coingecko maple/maple-finance case).
export const toolArgOverrides = pgTable("tool_arg_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  toolName: text("tool_name").notNull(),
  argName: text("arg_name").notNull(),
  fromValue: text("from_value").notNull(),
  toValue: text("to_value").notNull(),
  sourceMsgId: integer("source_msg_id"),
  confidence: integer("confidence").notNull().default(80),
  hitCount: integer("hit_count").notNull().default(0),
  lastHitAt: timestamp("last_hit_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  lookupIdx: uniqueIndex("tao_lookup_uniq").on(table.userId, table.toolName, table.argName, table.fromValue),
}));

// Pending-extraction queue. A row is inserted when the detector
// notices corrective language in a user message; the row is drained
// after the NEXT assistant turn lands a successful artifact, at
// which point the extractor compares the failed-vs-corrected pair.
export const correctionQueue = pgTable("correction_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: integer("conversation_id").notNull(),
  prevAssistantMsgId: integer("prev_assistant_msg_id").notNull(),
  userMsgId: integer("user_msg_id").notNull(),
  status: text("status").notNull().default("awaiting_corrected_turn"),
  correctedAssistantMsgId: integer("corrected_assistant_msg_id"),
  processedAt: timestamp("processed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("correction_queue_status_idx").on(table.status, table.conversationId),
}));

export type ToolArgOverride = typeof toolArgOverrides.$inferSelect;
export type CorrectionQueue = typeof correctionQueue.$inferSelect;

// ═══════════════════════════════════════════════════════════════
// CANONICAL AGGREGATION RULES — explicit "for entity X, metric Y
// requires combining sources A+B+C" knowledge. Domain knowledge the
// system can't derive on its own; sourced from a small curated seed
// + grown via user corrections (correction-ingestion can write here
// when it detects coverage-gap class corrections).
//
// Surfaced to the agent in three places:
//   1. System prompt at preflight (so it picks the right sources
//      from the start)
//   2. Tool-result hint when the agent calls a partial source for
//      a metric with a canonical rule (catch at fetch moment)
//   3. Strict-pass validator: if a compute() result name matches a
//      rule, all required source_label patterns must appear in the
//      provenance trail — otherwise the response gets rejected/retried.
// ═══════════════════════════════════════════════════════════════
export const canonicalAggregations = pgTable("canonical_aggregations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entity: text("entity").notNull(),               // 'hyperliquid', 'maple', '*' for cross-entity
  metricName: text("metric_name").notNull(),      // 'ltm_gross_fees', 'protocol_revenue', 'ttm_volume'
  description: text("description").notNull(),
  // Array of { source_label_pattern, role, required, notes } — see
  // server/numeric-provenance/canonical-aggregations.ts for shape.
  requiredSources: jsonb("required_sources").notNull(),
  aggregationMethod: text("aggregation_method").notNull().default("sum"),
  notes: text("notes"),
  // Provenance: msg ID if learned from a user correction, else null
  // (curated seeds carry source='seed' below).
  sourceMsgId: integer("source_msg_id"),
  source: text("source").notNull().default("seed"),
  confidence: integer("confidence").notNull().default(80),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  lookupIdx: uniqueIndex("canonical_agg_lookup_uniq").on(table.entity, table.metricName),
}));
export type CanonicalAggregation = typeof canonicalAggregations.$inferSelect;

// ═══════════════════════════════════════════════════════════════
// OUTPUT REQUIREMENTS — "for prompt-shape X, the agent must
// include these specific charts/tables/sections in the output."
// Domain knowledge that the system can't derive on its own; lets
// us extend FS prompts to require valuation-multiple time-series,
// add scenario tables, etc., without changing code. Surfaced to
// the agent in the system prompt when the matching prompt-shape
// is detected (e.g. financial-statement → daily P/E + P/S charts).
// ═══════════════════════════════════════════════════════════════
export const outputRequirements = pgTable("output_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Prompt shape this rule applies to. 'financial_statement',
  // 'valuation_dashboard', 'tokenomics_breakdown', etc. The
  // FS-router and similar detectors map prompts to these shapes.
  promptShape: text("prompt_shape").notNull(),
  // Entity scope: '*' for any entity, or a specific entity name.
  entity: text("entity").notNull().default("*"),
  // Short label used in the surfaced prompt block.
  title: text("title").notNull(),
  // The full requirement text. Written as direct instruction to the
  // agent — what to include, how to compute, what to label.
  requirement: text("requirement").notNull(),
  // Render order (lower = earlier in the prompt).
  ordering: integer("ordering").notNull().default(100),
  source: text("source").notNull().default("seed"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  shapeIdx: index("output_req_shape_idx").on(table.promptShape, table.entity, table.isActive),
}));
export type OutputRequirement = typeof outputRequirements.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// ═══════════════════════════════════════════════════════════════
// AUTORESEARCH EVAL SYSTEM — query logging + benchmark tables
// ═══════════════════════════════════════════════════════════════

/** Logs every attempt in a chart request lifecycle (first try, retries, fallbacks) */
export const queryAttempts = pgTable("query_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: text("request_id").notNull(),        // groups attempts for same user request
  protocol: text("protocol").notNull(),
  metricType: text("metric_type").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  dataSource: text("data_source").notNull(),
  sqlQuery: text("sql_query"),
  errorType: text("error_type"),                   // null if success
  errorMessage: text("error_message"),
  sampleRows: jsonb("sample_rows"),
  finalOutcome: text("final_outcome").notNull(),   // 'success' | 'retry' | 'fallback' | 'failure'
  llmModel: text("llm_model"),
  latencyMs: integer("latency_ms"),
  wasCacheHit: boolean("was_cache_hit").default(false),
  crossValidationStatus: text("cross_validation_status"), // 'validated' | 'warning' | 'likely_wrong' | null
  crossValidationRatio: doublePrecision("cross_validation_ratio"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertQueryAttemptSchema = createInsertSchema(queryAttempts).omit({
  id: true,
  createdAt: true,
});
export type QueryAttempt = typeof queryAttempts.$inferSelect;
export type InsertQueryAttempt = z.infer<typeof insertQueryAttemptSchema>;

/** Ground truth benchmark cases — auto-seeded from DeFiLlama */
export const benchmarkCases = pgTable("benchmark_cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  protocol: text("protocol").notNull(),
  metricType: text("metric_type").notNull(),
  referenceSource: text("reference_source").notNull(),   // 'defillama_tvl', 'defillama_fees', etc.
  naturalLanguageQuery: text("natural_language_query").notNull(),
  referenceFetcher: text("reference_fetcher").notNull(),  // function name to fetch canonical answer
  tolerance: doublePrecision("tolerance").notNull().default(0.20),
  difficulty: text("difficulty").notNull().default("standard"),
  isActive: boolean("is_active").notNull().default(true),
  protocolSlug: text("protocol_slug"),                    // DeFiLlama slug
  protocolCategory: text("protocol_category"),            // 'Lending', 'Dexes', etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBenchmarkCaseSchema = createInsertSchema(benchmarkCases).omit({
  id: true,
  createdAt: true,
});
export type BenchmarkCase = typeof benchmarkCases.$inferSelect;
export type InsertBenchmarkCase = z.infer<typeof insertBenchmarkCaseSchema>;

/** A single eval run (one full benchmark pass) */
export const benchmarkRuns = pgTable("benchmark_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  configVersion: integer("config_version").notNull(),
  totalCases: integer("total_cases").notNull(),
  passedCases: integer("passed_cases").notNull(),
  failedCases: integer("failed_cases").notNull(),
  overallAccuracy: doublePrecision("overall_accuracy").notNull(),
  totalCostUsd: doublePrecision("total_cost_usd"),
  totalLatencyMs: integer("total_latency_ms"),
  configSnapshot: jsonb("config_snapshot"),              // snapshot of rules + routing at time of run
  improvementsApplied: jsonb("improvements_applied"),    // what changed vs previous run
  status: text("status").notNull().default("running"),   // 'running' | 'completed' | 'failed'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BenchmarkRun = typeof benchmarkRuns.$inferSelect;

/** Per-case result within a benchmark run */
export const benchmarkCaseResults = pgTable("benchmark_case_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  caseId: varchar("case_id").notNull(),
  score: doublePrecision("score").notNull(),             // 0-1 composite score
  magnitudeRatio: doublePrecision("magnitude_ratio"),
  trendMatch: boolean("trend_match"),
  mape: doublePrecision("mape"),                         // mean absolute percentage error
  executionSuccess: boolean("execution_success").notNull(),
  sanityPassed: boolean("sanity_passed"),
  dataSource: text("data_source"),
  sqlUsed: text("sql_used"),
  errorMessage: text("error_message"),
  latencyMs: integer("latency_ms"),
  llmCalls: integer("llm_calls"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BenchmarkCaseResult = typeof benchmarkCaseResults.$inferSelect;

/**
 * Quality benchmark cases — LLM-judged evaluations that exercise the
 * qualitative dimensions a numeric-tolerance run cannot: chart-form
 * selection, compound reasoning, memo prose quality, conversational
 * refinement. Separate from `benchmark_cases` so neither suite
 * contaminates the other's accuracy signal.
 */
export const benchmarkQualityCases = pgTable("benchmark_quality_cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dimension: text("dimension").notNull(),              // "compound" | "chart_form" | "memo_quality" | "refinement" | "verification" | "quick"
  prompt: text("prompt").notNull(),                    // natural-language user query (the FINAL turn the test grades)
  rubric: text("rubric").notNull(),                    // what the judge should look for, free-form
  expectedBehavior: text("expected_behavior"),         // one-liner describing the ideal response
  tags: jsonb("tags"),                                 // string[] — protocols/metrics/etc for grouping
  // Optional conversation history that runs BEFORE `prompt`. Used by
  // refinement-dimension cases to set up the prior turn the user is
  // pushing back on. Empty / null for single-turn cases. Shape:
  // [{ role: "user" | "assistant", content: string }, ...]
  priorTurns: jsonb("prior_turns"),
  // Structured rubric criteria. When present, the judge emits per-criterion
  // 0/0.5/1 scores against these IDs (in addition to the freeform `rubric`),
  // enabling cross-run failure-mode aggregation. Shape:
  // [{ id: "memo.exec_deck", description: "...", points: 2 }, ...]
  criteria: jsonb("criteria"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BenchmarkQualityCase = typeof benchmarkQualityCases.$inferSelect;
export type QualityCriterion = { id: string; description: string; points: number };

/** One full pass over the active quality cases. */
export const benchmarkQualityRuns = pgTable("benchmark_quality_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  totalCases: integer("total_cases").notNull(),
  scoredCases: integer("scored_cases").notNull().default(0),
  averageScore: doublePrecision("average_score"),     // mean 0-5 across scored cases
  totalCostUsd: doublePrecision("total_cost_usd"),
  totalLatencyMs: integer("total_latency_ms"),
  status: text("status").notNull().default("running"), // 'running' | 'completed' | 'failed'
  judgeModel: text("judge_model"),                     // e.g. "claude-opus-4-7"
  notes: text("notes"),                                // free-form run description
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BenchmarkQualityRun = typeof benchmarkQualityRuns.$inferSelect;

/** Per-case quality result with LLM-judge critique. */
export const benchmarkQualityResults = pgTable("benchmark_quality_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  caseId: varchar("case_id").notNull(),
  dimension: text("dimension").notNull(),             // denormalised for easy grouping
  score: doublePrecision("score").notNull(),          // 0-5 from the judge
  verdict: text("verdict"),                           // "pass" | "partial" | "fail"
  critique: text("critique"),                         // judge's reasoning
  responseText: text("response_text"),                // agent's response verbatim
  responseArtifacts: jsonb("response_artifacts"),     // captured chart configs etc.
  judgeRaw: jsonb("judge_raw"),                       // full judge JSON for later re-analysis
  // Per-criterion scoring: { [criterionId]: 0 | 0.5 | 1 }. Populated when the
  // case has a structured `criteria` array; null for legacy cases.
  criteriaScores: jsonb("criteria_scores"),
  // Denormalised list of criterion IDs the judge marked as missed. Enables
  // GROUP BY across runs to surface recurring failure modes.
  failedCriteriaIds: text("failed_criteria_ids").array(),
  // Optional follow-up turn — second prompt run with conversation history.
  // Lets us probe whether follow-ups produce more intelligent outputs.
  followUpPrompt: text("follow_up_prompt"),
  followUpResponse: text("follow_up_response"),
  followUpCost: doublePrecision("follow_up_cost"),
  followUpLatencyMs: integer("follow_up_latency_ms"),
  costUsd: doublePrecision("cost_usd"),
  latencyMs: integer("latency_ms"),
  executionSuccess: boolean("execution_success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BenchmarkQualityResult = typeof benchmarkQualityResults.$inferSelect;

/** Compound financial query templates (SQL with placeholders) */
export const queryTemplates = pgTable("query_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  businessModel: text("business_model").notNull(),
  description: text("description"),
  sqlTemplate: text("sql_template").notNull(),
  requiredParams: jsonb("required_params").notNull(),
  outputMetrics: jsonb("output_metrics").notNull(),
  exampleProtocol: text("example_protocol"),
  savedQueryDependencies: jsonb("saved_query_dependencies"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertQueryTemplateSchema = createInsertSchema(queryTemplates).omit({
  id: true,
  createdAt: true,
});
export type QueryTemplate = typeof queryTemplates.$inferSelect;
export type InsertQueryTemplate = z.infer<typeof insertQueryTemplateSchema>;

/** Protocol revenue models — researched and validated revenue logic per protocol */
export const protocolRevenueModels = pgTable("protocol_revenue_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  protocol: text("protocol").notNull(),
  protocolSlug: text("protocol_slug"),                         // DeFiLlama slug
  protocolType: text("protocol_type").notNull(),               // 'lending', 'dex', 'staking', 'stablecoin_yield', 'derivatives'
  revenueSources: jsonb("revenue_sources").notNull(),          // [{ name, description, onChainSignal }]
  keyContracts: jsonb("key_contracts").notNull(),              // [{ label, address, chain }]
  feeStructure: text("fee_structure"),                         // human-readable description
  suggestedDuneTables: jsonb("suggested_dune_tables"),         // ["lending.borrow", "tokens.transfers", ...]
  existingDuneQueryIds: jsonb("existing_dune_query_ids"),      // [number, ...]
  revenueSqlDraft: text("revenue_sql_draft"),                  // Working SQL that produces revenue time series
  validationStatus: text("validation_status").notNull().default("unvalidated"), // 'unvalidated', 'validated', 'failed'
  validationScore: doublePrecision("validation_score"),        // cross-validation score vs DeFiLlama
  validationError: text("validation_error"),                   // error details if validation failed
  coinGeckoId: text("coingecko_id"),                           // for price/mcap lookups
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Protocol knowledge base — crawled from DeFiLlama + CoinGecko + Dune */
export const projectKnowledge = pgTable("project_knowledge", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),              // DeFiLlama slug
  category: text("category"),                          // 'Lending', 'Dexs', 'Liquid Staking', 'CEX', etc.
  protocolType: text("protocol_type"),                 // normalized: 'lending', 'dex', 'liquid_staking', 'cex', 'bridge', etc.
  primaryChain: text("primary_chain"),                 // highest TVL chain
  chains: jsonb("chains"),                             // all chains
  tvl: doublePrecision("tvl"),                         // latest TVL
  tvlRank: integer("tvl_rank"),                        // rank by TVL
  geckoId: text("gecko_id"),                           // CoinGecko token ID
  symbol: text("symbol"),                              // token symbol
  hasFeeData: boolean("has_fee_data").default(false),
  hasRevenueData: boolean("has_revenue_data").default(false),
  hasDexVolumeData: boolean("has_dex_volume_data").default(false),
  fees24h: doublePrecision("fees_24h"),
  revenue24h: doublePrecision("revenue_24h"),
  duneSpellbookCoverage: jsonb("dune_spellbook_coverage"),  // { dex_trades: true, lending_borrow: true, ... }
  duneProjectName: text("dune_project_name"),          // project name in Dune Spellbook (e.g., 'aave', 'uniswap')
  lastCrawledAt: timestamp("last_crawled_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProjectKnowledgeSchema = createInsertSchema(projectKnowledge).omit({
  id: true,
  createdAt: true,
});
export type ProjectKnowledge = typeof projectKnowledge.$inferSelect;
export type InsertProjectKnowledge = z.infer<typeof insertProjectKnowledgeSchema>;

export const insertProtocolRevenueModelSchema = createInsertSchema(protocolRevenueModels).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ProtocolRevenueModel = typeof protocolRevenueModels.$inferSelect;
export type InsertProtocolRevenueModel = z.infer<typeof insertProtocolRevenueModelSchema>;

export const costAlertSettings = pgTable("cost_alert_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyThreshold: doublePrecision("daily_threshold").notNull().default(5.0),
  enabled: boolean("enabled").notNull().default(true),
  telegramEnabled: boolean("telegram_enabled").notNull().default(false),
  lastAlertDate: text("last_alert_date"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCostAlertSettingsSchema = createInsertSchema(costAlertSettings).omit({
  id: true,
  lastAlertDate: true,
  updatedAt: true,
});

export type CostAlertSettings = typeof costAlertSettings.$inferSelect;
export type InsertCostAlertSettings = z.infer<typeof insertCostAlertSettingsSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;

export const DATA_SOURCES = ["defillama", "coingecko", "dune", "allium", "stonksonchain"] as const;
export type DataSource = typeof DATA_SOURCES[number];

export const FACT_SCOPES = ["source", "endpoint", "field", "cross-source"] as const;
export type FactScope = typeof FACT_SCOPES[number];

export const FACT_CATEGORIES = [
  "rate_limit", "auth", "coverage", "definition", "freshness",
  "reliability", "schema", "disagreement", "other",
] as const;
export type FactCategory = typeof FACT_CATEGORIES[number];

export const FACT_CONFIDENCE = [
  "verified_doc", "verified_runtime", "observed_once", "inferred", "unverified",
] as const;
export type FactConfidence = typeof FACT_CONFIDENCE[number];

export const dataSourceFacts = pgTable("data_source_facts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  source: text("source").notNull(),
  scope: text("scope").notNull(),
  scopeRef: text("scope_ref").notNull(),
  category: text("category").notNull(),
  content: text("content").notNull(),
  confidence: text("confidence").notNull(),
  sourceOfFact: text("source_of_fact").notNull(),
  observedCount: integer("observed_count").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  staleAt: timestamp("stale_at"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  // Generated STORED column populated from `content` via the seeder's setup
  // (`to_tsvector('english', content)`). Declared here so Drizzle keeps it
  // on push; the GENERATED ALWAYS AS clause is managed in raw SQL.
  contentTsv: tsvector("content_tsv").generatedAlwaysAs(sql`to_tsvector('english', content)`, { mode: "stored" as any }),
}, (table) => ({
  embeddingIdx: index("data_source_facts_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  sourceIdx: index("data_source_facts_source_idx").on(table.source),
  scopeRefIdx: index("data_source_facts_scope_ref_idx").on(table.scopeRef),
}));

export type DataSourceFact = typeof dataSourceFacts.$inferSelect;

// ─── Analyst Corpus ──────────────────────────────────────────────────────────
// Markdown corpora from third-party crypto analysts (TopherGMI, shaundadevens,
// thiccyth0t). Documents are chunked + embedded via Voyage; agent queries them
// through the analyst-corpus tools to surface specific lenses on a topic.
export const ANALYST_NAMES = ["TopherGMI", "shaundadevens", "thiccyth0t", "CryptoHayes", "AustinBarack", "defi_monk", "RyanWatkins_", "robbiepetersen_"] as const;
export type AnalystName = typeof ANALYST_NAMES[number];

export const ANALYST_DISPLAY: Record<AnalystName, string> = {
  TopherGMI: "TopherGMI (Arca CIO — macro, market structure, tokenomics)",
  shaundadevens: "shaundadevens (Blockworks columnist — fees, governance, market microstructure)",
  thiccyth0t: "thiccyth0t (Scimitar Capital — derivatives, MM, on-chain quant)",
  CryptoHayes: "Arthur Hayes (BitMEX co-founder — macro, geopolitics, monetary policy)",
  AustinBarack: "Austin Barack (crypto investor — early-stage, market catalysts, ecosystem analysis)",
  defi_monk: "defi_monk (DeFi native — protocol mechanics, yield strategies, on-chain analytics)",
  RyanWatkins_: "Ryan Watkins (Messari alum — sector mapping, protocol valuation, market structure)",
  robbiepetersen_: "Robbie Petersen (Delphi Digital — cross-chain research, emerging protocols)",
};

export const analystDocuments = pgTable("analyst_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  analyst: text("analyst").notNull(),
  source: text("source").notNull(),
  url: text("url"),
  date: text("date"),
  title: text("title"),
  body: text("body").notNull(),
  type: text("type"),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  filePath: text("file_path").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  analystIdx: index("analyst_documents_analyst_idx").on(t.analyst),
  dateIdx: index("analyst_documents_date_idx").on(t.date),
}));

export const analystChunks = pgTable("analyst_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull(),
  analyst: text("analyst").notNull(),
  source: text("source").notNull(),
  date: text("date"),
  title: text("title"),
  url: text("url"),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  contentTsv: tsvector("content_tsv").generatedAlwaysAs(sql`to_tsvector('english', content)`, { mode: "stored" as any }),
}, (t) => ({
  embeddingIdx: index("analyst_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  analystIdx: index("analyst_chunks_analyst_idx").on(t.analyst),
  docIdx: index("analyst_chunks_document_idx").on(t.documentId),
  docChunkUnique: uniqueIndex("analyst_chunks_doc_chunk_unique").on(t.documentId, t.chunkIndex),
}));

export const analystFrameworks = pgTable("analyst_frameworks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  analyst: text("analyst").notNull(),
  frameworkSlug: text("framework_slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category"),
  versions: jsonb("versions").notNull(),
  versionCount: integer("version_count").notNull().default(1),
  firstSeenDate: text("first_seen_date"),
  lastSeenDate: text("last_seen_date"),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  contentTsv: tsvector("content_tsv").generatedAlwaysAs(sql`to_tsvector('english', name || ' ' || description)`, { mode: "stored" as any }),
}, (t) => ({
  embeddingIdx: index("analyst_frameworks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  analystIdx: index("analyst_frameworks_analyst_idx").on(t.analyst),
  analystSlugUnique: uniqueIndex("analyst_frameworks_analyst_slug_unique").on(t.analyst, t.frameworkSlug),
}));

export type AnalystDocument = typeof analystDocuments.$inferSelect;
export type AnalystChunk = typeof analystChunks.$inferSelect;
export type AnalystFramework = typeof analystFrameworks.$inferSelect;

export const financialModels = pgTable("financial_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  sourceMessageId: integer("source_message_id"),
  sourceConversationId: integer("source_conversation_id"),
  sections: jsonb("sections").notNull().default(sql`'[]'::jsonb`),
  assumptions: jsonb("assumptions").notNull().default(sql`'[]'::jsonb`),
  sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("complete"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FinancialModel = typeof financialModels.$inferSelect;

export const brainFacts = pgTable("brain_facts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  factId: text("fact_id").notNull(),
  topic: text("topic").notNull().default(""),
  fact: text("fact").notNull(),
  entities: text("entities").array().notNull().default(sql`'{}'::text[]`),
  source: text("source").notNull().default(""),
  date: text("date"),
  confidence: text("confidence").notNull().default("verified"),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  contentTsv: tsvector("content_tsv").generatedAlwaysAs(sql`to_tsvector('english', topic || ' ' || fact)`, { mode: "stored" as any }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  embeddingIdx: index("brain_facts_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  userIdx: index("brain_facts_user_idx").on(table.userId),
  userFactUnique: uniqueIndex("brain_facts_user_fact_unique").on(table.userId, table.factId),
}));

export const brainEntities = pgTable("brain_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  entityName: text("entity_name").notNull(),
  type: text("type").notNull().default("unknown"),
  category: text("category"),
  summary: text("summary"),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  contentTsv: tsvector("content_tsv").generatedAlwaysAs(sql`to_tsvector('english', entity_name || ' ' || COALESCE(summary, '') || ' ' || type)`, { mode: "stored" as any }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  embeddingIdx: index("brain_entities_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  userIdx: index("brain_entities_user_idx").on(table.userId),
  userEntityUnique: uniqueIndex("brain_entities_user_entity_unique").on(table.userId, table.entityName),
}));

export type BrainFactRow = typeof brainFacts.$inferSelect;
export type BrainEntityRow = typeof brainEntities.$inferSelect;

export { sessions } from "./models/auth";

export * from "./models/chat";
