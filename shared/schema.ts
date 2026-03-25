import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  companyId: varchar("company_id").notNull(),
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
export type InsertDashboardChart = z.infer<typeof insertDashboardChartSchema>;

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
});

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

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;

export { sessions } from "./models/auth";

export * from "./models/chat";
