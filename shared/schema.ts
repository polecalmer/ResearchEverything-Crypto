import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
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

export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Founder = typeof founders.$inferSelect;
export type InsertFounder = z.infer<typeof insertFounderSchema>;
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Report = typeof reports.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  credits: integer("credits").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: text("subscription_status"),
  subscriptionId: text("subscription_id"),
  subscriptionPeriodEnd: timestamp("subscription_period_end"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export { sessions } from "./models/auth";

export * from "./models/chat";
