import {
  type User, type InsertUser,
  type Company, type InsertCompany,
  type Founder, type InsertFounder,
  type Note, type InsertNote,
  type Report,
  type Transaction,
  type TokenProfile, type InsertTokenProfile,
  type MasterDuneQuery, type InsertMasterDuneQuery,
  type DuneQuery, type InsertDuneQuery,
  type TokenAnalysis,
  type DashboardChart, type InsertDashboardChart,
  type ProvenQuery, type InsertProvenQuery,
  type SystemLearning, type InsertSystemLearning,
  type QueryAttempt, type InsertQueryAttempt,
  type BenchmarkCase, type InsertBenchmarkCase,
  type BenchmarkRun, type BenchmarkCaseResult,
  type QueryTemplate, type InsertQueryTemplate,
  type ProtocolRevenueModel, type InsertProtocolRevenueModel,
  type Conversation, type Message,
  users, companies, founders, notes, reports, transactions,
  tokenProfiles, masterDuneQueries, duneQueries, tokenAnalyses, dashboardCharts,
  provenQueries, systemLearnings,
  queryAttempts, benchmarkCases, benchmarkRuns, benchmarkCaseResults,
  queryTemplates,
  protocolRevenueModels,
  conversations, messages, researchBrains,
  costAlertSettings,
  type CostAlertSettings,
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, desc, asc, and, isNull, isNotNull, sql } from "drizzle-orm";
import { pool } from "./db";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByPrivyId(privyId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createPrivyUser(data: { privyId: string; email: string; walletAddress: string; username: string }): Promise<User>;
  getUserCredits(userId: string): Promise<number>;
  deductCredit(userId: string): Promise<boolean>;
  addCredits(userId: string, amount: number): Promise<number>;
  updateStripeCustomerId(userId: string, customerId: string): Promise<void>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  updateWalletAddress(userId: string, walletAddress: string): Promise<void>;
  checkIsAdmin(userId: string): Promise<boolean>;

  getCompanies(userId: string): Promise<Company[]>;
  getCompany(id: string, userId?: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<InsertCompany>, userId?: string): Promise<Company | undefined>;
  deleteCompany(id: string, userId?: string): Promise<void>;

  getFoundersByCompany(companyId: string): Promise<Founder[]>;
  createFounder(founder: InsertFounder): Promise<Founder>;

  getNotesByCompany(companyId: string): Promise<Note[]>;
  createNote(note: InsertNote): Promise<Note>;
  deleteNote(id: string, userId?: string): Promise<boolean>;

  updateSubscription(userId: string, data: { subscriptionStatus: string; subscriptionId: string; subscriptionPeriodEnd: Date | null }): Promise<void>;

  createReport(data: { companyId: string; userId: string; title: string; content: string; status: string }): Promise<Report>;
  updateReport(id: string, data: { content?: string; status?: string }): Promise<Report | undefined>;
  getReport(id: string): Promise<Report | undefined>;
  getReportsByCompany(companyId: string, userId: string): Promise<Report[]>;

  claimOrphanedCompanies(userId: string): Promise<number>;

  logTransaction(data: { userId: string; type: string; description: string; amount: string; apiCost?: string; companyName?: string; inputTokens?: number; outputTokens?: number; txHash?: string; status?: string; costBasis?: string }): Promise<Transaction>;
  getTransactions(userId: string, limit?: number): Promise<Transaction[]>;

  getTokenProfile(companyId: string): Promise<TokenProfile | undefined>;
  upsertTokenProfile(data: InsertTokenProfile): Promise<TokenProfile>;
  deleteTokenProfile(companyId: string): Promise<void>;

  getMasterDuneQueries(): Promise<MasterDuneQuery[]>;
  getMasterDuneQuery(id: string): Promise<MasterDuneQuery | undefined>;
  upsertMasterDuneQuery(data: InsertMasterDuneQuery): Promise<MasterDuneQuery>;
  deleteMasterDuneQuery(id: string): Promise<boolean>;
  searchMasterDuneQueries(protocolTag?: string, chainTag?: string, category?: string): Promise<MasterDuneQuery[]>;

  getDuneQueries(companyId: string): Promise<DuneQuery[]>;
  addDuneQuery(data: InsertDuneQuery): Promise<DuneQuery>;
  removeDuneQuery(id: string): Promise<boolean>;

  createTokenAnalysis(data: { companyId: string; userId: string; content: string; status: string }): Promise<TokenAnalysis>;
  updateTokenAnalysis(id: string, data: { content?: string; status?: string; duneData?: string }): Promise<TokenAnalysis | undefined>;
  getTokenAnalysis(id: string): Promise<TokenAnalysis | undefined>;
  getTokenAnalysesByCompany(companyId: string, userId: string): Promise<TokenAnalysis[]>;
  deleteTokenAnalysis(id: string): Promise<void>;

  createDashboardChart(data: InsertDashboardChart): Promise<DashboardChart>;
  updateDashboardChart(id: string, data: Partial<Pick<DashboardChart, 'title' | 'description' | 'chartType' | 'chartConfig' | 'data' | 'status' | 'errorMessage' | 'updatedAt' | 'sortOrder' | 'dataSource' | 'dataSourceConfig'>>): Promise<DashboardChart | undefined>;
  getDashboardChart(id: string): Promise<DashboardChart | undefined>;
  getDashboardChartsByCompany(companyId: string, userId: string): Promise<DashboardChart[]>;
  getDashboardChartsByStatus(status: string, limit: number): Promise<DashboardChart[]>;
  deleteDashboardChart(id: string): Promise<boolean>;

  findProvenQuery(protocol: string, metricType: string): Promise<ProvenQuery | undefined>;
  getFewShotExamples(protocol: string, metricType: string, limit?: number): Promise<ProvenQuery[]>;
  saveProvenQuery(data: InsertProvenQuery): Promise<ProvenQuery>;
  recordProvenQuerySuccess(id: string): Promise<void>;
  recordProvenQueryFailure(id: string): Promise<void>;
  getStaleProvenQueries(daysSinceUse: number): Promise<ProvenQuery[]>;
  updateProvenQueryLastUsed(id: string): Promise<void>;

  getLearnings(scope: string, scopeKey: string): Promise<SystemLearning[]>;
  getGlobalLearnings(): Promise<SystemLearning[]>;
  saveLearning(data: InsertSystemLearning): Promise<SystemLearning>;
  incrementLearningApplied(id: string): Promise<void>;
  deactivateLearning(id: string): Promise<void>;
  getAllActiveLearnings(): Promise<SystemLearning[]>;

  // ═══ Eval system ═══
  logQueryAttempt(data: InsertQueryAttempt): Promise<QueryAttempt>;
  getQueryAttemptsByRequest(requestId: string): Promise<QueryAttempt[]>;
  getRetryDiffs(daysSince?: number): Promise<{ failed: QueryAttempt; fixed: QueryAttempt }[]>;
  getFailurePatterns(daysSince?: number): Promise<{ protocol: string; metricType: string; errorType: string; count: number }[]>;

  insertBenchmarkCases(cases: InsertBenchmarkCase[]): Promise<BenchmarkCase[]>;
  getActiveBenchmarkCases(difficulty?: string): Promise<BenchmarkCase[]>;
  getBenchmarkCaseCount(): Promise<number>;
  deactivateBenchmarkCase(id: string): Promise<void>;

  createBenchmarkRun(data: Partial<BenchmarkRun>): Promise<BenchmarkRun>;
  updateBenchmarkRun(id: string, data: Partial<BenchmarkRun>): Promise<BenchmarkRun | undefined>;
  getLatestBenchmarkRun(): Promise<BenchmarkRun | undefined>;
  getBenchmarkRunHistory(limit?: number): Promise<BenchmarkRun[]>;

  insertBenchmarkCaseResult(data: Partial<BenchmarkCaseResult>): Promise<BenchmarkCaseResult>;
  getBenchmarkCaseResultsByRun(runId: string): Promise<BenchmarkCaseResult[]>;
  getFailedCaseResultsByRun(runId: string): Promise<(BenchmarkCaseResult & { benchmarkCase?: BenchmarkCase })[]>;

  // Query templates
  insertQueryTemplate(template: InsertQueryTemplate): Promise<QueryTemplate>;
  getQueryTemplateByName(name: string, businessModel: string): Promise<QueryTemplate | undefined>;
  getActiveQueryTemplates(): Promise<QueryTemplate[]>;

  // Protocol revenue models
  insertProtocolRevenueModel(model: InsertProtocolRevenueModel): Promise<ProtocolRevenueModel>;
  getProtocolRevenueModel(protocol: string): Promise<ProtocolRevenueModel | undefined>;
  updateProtocolRevenueModel(id: string, data: Partial<InsertProtocolRevenueModel & { validationStatus: string; validationScore: number; validationError: string }>): Promise<ProtocolRevenueModel>;
  getActiveProtocolRevenueModels(): Promise<ProtocolRevenueModel[]>;

  // Session research conversations
  createConversation(data: { userId: string; title: string; type: string }): Promise<Conversation>;
  getConversations(userId: string, type: string): Promise<Conversation[]>;
  getConversation(id: number): Promise<Conversation | undefined>;
  updateConversationTitle(id: number, title: string): Promise<void>;
  setConversationShareToken(id: number, shareToken: string | null): Promise<void>;
  getConversationByShareToken(shareToken: string): Promise<Conversation | undefined>;
  deleteConversation(id: number): Promise<void>;
  getMessages(conversationId: number): Promise<Message[]>;
  createMessage(data: { conversationId: number; role: string; content: string; artifacts?: any }): Promise<Message>;
  getResearchBrain(userId: string): Promise<any | null>;
  upsertResearchBrain(userId: string, brain: { entities?: any; knowledge?: any; preferences?: any; relationships?: any; contradictions?: any; meta?: any }): Promise<void>;

  getAllUsers(): Promise<User[]>;
  getAdminTelegramChatIds(): Promise<string[]>;

  getCostAlertSettings(): Promise<CostAlertSettings | undefined>;
  upsertCostAlertSettings(data: { dailyThreshold: number; enabled: boolean; telegramEnabled: boolean }): Promise<CostAlertSettings>;
  updateCostAlertLastAlertDate(id: string, date: string): Promise<void>;
  getTodayApiCost(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByPrivyId(privyId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.privyId, privyId));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByTelegramChatId(chatId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId));
    return user;
  }

  async linkTelegramChat(userId: string, chatId: string): Promise<void> {
    await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, userId));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createPrivyUser(data: { privyId: string; email: string; walletAddress: string; username: string }): Promise<User> {
    const uniqueUsername = `${data.username}_${Date.now()}`;
    const [user] = await db.insert(users).values({
      privyId: data.privyId,
      email: data.email,
      walletAddress: data.walletAddress,
      username: uniqueUsername,
      password: "privy_auth",
    }).returning();
    return user;
  }

  async updateWalletAddress(userId: string, walletAddress: string): Promise<void> {
    await db.update(users).set({ walletAddress }).where(eq(users.id, userId));
  }

  private async isAdminUser(userId: string): Promise<boolean> {
    const [user] = await db.select({ email: users.email, username: users.username }).from(users).where(eq(users.id, userId));
    return user?.username === "polecalmer" || user?.email === "polecalmer@admin" || user?.email === "allmysubscriptions10@proton.me";
  }

  async checkIsAdmin(userId: string): Promise<boolean> {
    return this.isAdminUser(userId);
  }

  async getUserCredits(userId: string): Promise<number> {
    if (await this.isAdminUser(userId)) return 999999;
    const [user] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId));
    return user?.credits ?? 0;
  }

  async deductCredit(userId: string): Promise<boolean> {
    if (await this.isAdminUser(userId)) return true;
    const result = await db
      .update(users)
      .set({ credits: sql`${users.credits} - 1` })
      .where(and(eq(users.id, userId), sql`${users.credits} > 0`))
      .returning();
    return result.length > 0;
  }

  async addCredits(userId: string, amount: number): Promise<number> {
    const [updated] = await db
      .update(users)
      .set({ credits: sql`${users.credits} + ${amount}` })
      .where(eq(users.id, userId))
      .returning();
    return updated?.credits ?? 0;
  }

  async updateStripeCustomerId(userId: string, customerId: string): Promise<void> {
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    return user;
  }

  async getCompanies(userId: string): Promise<Company[]> {
    return db.select().from(companies).where(eq(companies.userId, userId)).orderBy(desc(companies.createdAt));
  }

  async getCompany(id: string, userId?: string): Promise<Company | undefined> {
    const conditions = [eq(companies.id, id)];
    if (userId) conditions.push(eq(companies.userId, userId));
    const [company] = await db.select().from(companies).where(and(...conditions));
    return company;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  async updateCompany(id: string, data: Partial<InsertCompany>, userId?: string): Promise<Company | undefined> {
    const conditions = [eq(companies.id, id)];
    if (userId) conditions.push(eq(companies.userId, userId));
    const [updated] = await db.update(companies).set(data).where(and(...conditions)).returning();
    return updated;
  }

  async deleteCompany(id: string, userId?: string): Promise<void> {
    const conditions = [eq(companies.id, id)];
    if (userId) conditions.push(eq(companies.userId, userId));
    const [company] = await db.select().from(companies).where(and(...conditions));
    if (!company) return;
    await db.delete(tokenAnalyses).where(eq(tokenAnalyses.companyId, id));
    await db.delete(duneQueries).where(eq(duneQueries.companyId, id));
    await db.delete(tokenProfiles).where(eq(tokenProfiles.companyId, id));
    await db.delete(reports).where(eq(reports.companyId, id));
    await db.delete(notes).where(eq(notes.companyId, id));
    await db.delete(founders).where(eq(founders.companyId, id));
    await db.delete(companies).where(eq(companies.id, id));
  }

  async getFoundersByCompany(companyId: string): Promise<Founder[]> {
    return db.select().from(founders).where(eq(founders.companyId, companyId));
  }

  async createFounder(founder: InsertFounder): Promise<Founder> {
    const [created] = await db.insert(founders).values(founder).returning();
    return created;
  }

  async getNotesByCompany(companyId: string): Promise<Note[]> {
    return db.select().from(notes).where(eq(notes.companyId, companyId)).orderBy(desc(notes.createdAt));
  }

  async createNote(note: InsertNote): Promise<Note> {
    const [created] = await db.insert(notes).values(note).returning();
    return created;
  }

  async deleteNote(id: string, userId?: string): Promise<boolean> {
    if (userId) {
      const [note] = await db.select().from(notes).where(eq(notes.id, id));
      if (!note) return false;
      const company = await this.getCompany(note.companyId, userId);
      if (!company) return false;
    }
    const result = await db.delete(notes).where(eq(notes.id, id)).returning();
    return result.length > 0;
  }

  async updateSubscription(userId: string, data: { subscriptionStatus: string; subscriptionId: string; subscriptionPeriodEnd: Date | null }): Promise<void> {
    await db.update(users).set({
      subscriptionStatus: data.subscriptionStatus,
      subscriptionId: data.subscriptionId,
      subscriptionPeriodEnd: data.subscriptionPeriodEnd,
    }).where(eq(users.id, userId));
  }

  async createReport(data: { companyId: string; userId: string; title: string; content: string; status: string }): Promise<Report> {
    const [report] = await db.insert(reports).values(data).returning();
    return report;
  }

  async updateReport(id: string, data: { content?: string; status?: string }): Promise<Report | undefined> {
    const [updated] = await db.update(reports).set(data).where(eq(reports.id, id)).returning();
    return updated;
  }

  async getReport(id: string): Promise<Report | undefined> {
    const [report] = await db.select().from(reports).where(eq(reports.id, id));
    return report;
  }

  async getReportsByCompany(companyId: string, userId: string): Promise<Report[]> {
    return db.select().from(reports).where(and(eq(reports.companyId, companyId), eq(reports.userId, userId))).orderBy(desc(reports.createdAt));
  }

  async deleteReport(id: string, userId: string): Promise<{ companyId: string } | null> {
    const [report] = await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId)));
    if (!report) return null;
    await db.delete(reports).where(eq(reports.id, id));
    await db.update(companies).set({
      deletedReportCount: sql`${companies.deletedReportCount} + 1`,
    }).where(eq(companies.id, report.companyId));
    return { companyId: report.companyId };
  }

  async claimOrphanedCompanies(userId: string): Promise<number> {
    const orphaned = await db
      .update(companies)
      .set({ userId })
      .where(isNull(companies.userId))
      .returning();
    return orphaned.length;
  }

  async logTransaction(data: { userId: string; type: string; description: string; amount: string; apiCost?: string; companyName?: string; inputTokens?: number; outputTokens?: number; txHash?: string; status?: string; costBasis?: string }): Promise<Transaction> {
    const [tx] = await db.insert(transactions).values(data).returning();
    if (data.apiCost && data.status !== "failed") {
      this.runCostAlertCheck().catch(() => {});
    }
    return tx;
  }

  private async runCostAlertCheck(): Promise<void> {
    try {
      const { checkCostAlert } = await import("./cost-alert");
      await checkCostAlert();
    } catch (err: any) {
      console.error("[CostAlert] Post-transaction check failed:", err?.message || err);
    }
  }

  async getTransactions(userId: string, limit: number = 50): Promise<Transaction[]> {
    return db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.createdAt)).limit(limit);
  }

  async getTokenProfile(companyId: string): Promise<TokenProfile | undefined> {
    const [profile] = await db.select().from(tokenProfiles).where(eq(tokenProfiles.companyId, companyId));
    return profile;
  }

  async upsertTokenProfile(data: InsertTokenProfile): Promise<TokenProfile> {
    const existing = await this.getTokenProfile(data.companyId);
    if (existing) {
      const [updated] = await db.update(tokenProfiles)
        .set({ contractAddress: data.contractAddress, chain: data.chain, tokenTicker: data.tokenTicker })
        .where(eq(tokenProfiles.companyId, data.companyId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(tokenProfiles).values(data).returning();
    return created;
  }

  async deleteTokenProfile(companyId: string): Promise<void> {
    await db.delete(tokenProfiles).where(eq(tokenProfiles.companyId, companyId));
  }

  async getMasterDuneQueries(): Promise<MasterDuneQuery[]> {
    return db.select().from(masterDuneQueries).where(eq(masterDuneQueries.isActive, true)).orderBy(masterDuneQueries.category, masterDuneQueries.label);
  }

  async getMasterDuneQuery(id: string): Promise<MasterDuneQuery | undefined> {
    const [q] = await db.select().from(masterDuneQueries).where(eq(masterDuneQueries.id, id));
    return q;
  }

  async upsertMasterDuneQuery(data: InsertMasterDuneQuery): Promise<MasterDuneQuery> {
    const [result] = await db.insert(masterDuneQueries).values(data)
      .onConflictDoUpdate({
        target: masterDuneQueries.queryId,
        set: {
          label: data.label,
          description: data.description,
          category: data.category,
          protocolTags: data.protocolTags,
          chainTags: data.chainTags,
          visualizationType: data.visualizationType,
          sourceUrl: data.sourceUrl,
          isActive: data.isActive ?? true,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();
    return result;
  }

  async deleteMasterDuneQuery(id: string): Promise<boolean> {
    const result = await db.delete(masterDuneQueries).where(eq(masterDuneQueries.id, id)).returning();
    return result.length > 0;
  }

  async searchMasterDuneQueries(protocolTag?: string, chainTag?: string, category?: string): Promise<MasterDuneQuery[]> {
    let query = db.select().from(masterDuneQueries).where(eq(masterDuneQueries.isActive, true));
    const results = await query;
    return results.filter(q => {
      if (protocolTag && !(q.protocolTags || []).some(t => t.toLowerCase() === protocolTag.toLowerCase())) return false;
      if (chainTag && !(q.chainTags || []).some(t => t.toLowerCase() === chainTag.toLowerCase())) return false;
      if (category && q.category?.toLowerCase() !== category.toLowerCase()) return false;
      return true;
    });
  }

  async getDuneQueries(companyId: string): Promise<DuneQuery[]> {
    return db.select().from(duneQueries).where(eq(duneQueries.companyId, companyId)).orderBy(duneQueries.displayOrder);
  }

  async addDuneQuery(data: InsertDuneQuery): Promise<DuneQuery> {
    const [created] = await db.insert(duneQueries).values(data).returning();
    return created;
  }

  async removeDuneQuery(id: string): Promise<boolean> {
    const result = await db.delete(duneQueries).where(eq(duneQueries.id, id)).returning();
    return result.length > 0;
  }

  async getDuneQueryWithCompany(queryDbId: string): Promise<{ query: DuneQuery; companyId: string } | null> {
    const [q] = await db.select().from(duneQueries).where(eq(duneQueries.id, queryDbId));
    if (!q) return null;
    return { query: q, companyId: q.companyId };
  }

  async createTokenAnalysis(data: { companyId: string; userId: string; content: string; status: string }): Promise<TokenAnalysis> {
    const [analysis] = await db.insert(tokenAnalyses).values(data).returning();
    return analysis;
  }

  async updateTokenAnalysis(id: string, data: { content?: string; status?: string; duneData?: string }): Promise<TokenAnalysis | undefined> {
    const [updated] = await db.update(tokenAnalyses).set(data).where(eq(tokenAnalyses.id, id)).returning();
    return updated;
  }

  async getTokenAnalysis(id: string): Promise<TokenAnalysis | undefined> {
    const [analysis] = await db.select().from(tokenAnalyses).where(eq(tokenAnalyses.id, id));
    return analysis;
  }

  async getTokenAnalysesByCompany(companyId: string, userId: string): Promise<TokenAnalysis[]> {
    return db.select().from(tokenAnalyses)
      .where(and(eq(tokenAnalyses.companyId, companyId), eq(tokenAnalyses.userId, userId)))
      .orderBy(desc(tokenAnalyses.createdAt));
  }

  async deleteTokenAnalysis(id: string): Promise<void> {
    await db.delete(tokenAnalyses).where(eq(tokenAnalyses.id, id));
  }

  async createDashboardChart(data: InsertDashboardChart): Promise<DashboardChart> {
    const [chart] = await db.insert(dashboardCharts).values(data).returning();
    return chart;
  }

  async updateDashboardChart(id: string, data: Partial<Pick<DashboardChart, 'title' | 'description' | 'chartType' | 'chartConfig' | 'data' | 'status' | 'errorMessage' | 'updatedAt' | 'sortOrder' | 'dataSource' | 'dataSourceConfig'>>): Promise<DashboardChart | undefined> {
    const [updated] = await db.update(dashboardCharts).set({ ...data, updatedAt: new Date() }).where(eq(dashboardCharts.id, id)).returning();
    return updated;
  }

  async getDashboardChart(id: string): Promise<DashboardChart | undefined> {
    const [chart] = await db.select().from(dashboardCharts).where(eq(dashboardCharts.id, id));
    return chart;
  }

  async getDashboardChartsByCompany(companyId: string, userId: string): Promise<DashboardChart[]> {
    return db.select().from(dashboardCharts)
      .where(and(eq(dashboardCharts.companyId, companyId), eq(dashboardCharts.userId, userId)))
      .orderBy(dashboardCharts.sortOrder, desc(dashboardCharts.createdAt));
  }

  async getDashboardChartsByStatus(status: string, limit: number): Promise<DashboardChart[]> {
    return db.select().from(dashboardCharts)
      .where(eq(dashboardCharts.status, status))
      .orderBy(desc(dashboardCharts.updatedAt))
      .limit(limit);
  }

  async deleteDashboardChart(id: string): Promise<boolean> {
    const result = await db.delete(dashboardCharts).where(eq(dashboardCharts.id, id)).returning();
    return result.length > 0;
  }

  async findProvenQuery(protocol: string, metricType: string): Promise<ProvenQuery | undefined> {
    const normalizedProtocol = protocol.toLowerCase().trim();
    const normalizedMetric = metricType.toLowerCase().trim();
    const [query] = await db.select().from(provenQueries)
      .where(and(
        eq(provenQueries.protocol, normalizedProtocol),
        eq(provenQueries.metricType, normalizedMetric),
        eq(provenQueries.isActive, true),
      ))
      .orderBy(desc(provenQueries.successCount))
      .limit(1);
    return query;
  }

  async getFewShotExamples(protocol: string, metricType: string, limit: number = 3): Promise<ProvenQuery[]> {
    const normalizedProtocol = protocol.toLowerCase().trim();
    const normalizedMetric = metricType.toLowerCase().trim();

    const sameMetricDiffProtocol = await db.select().from(provenQueries)
      .where(and(
        eq(provenQueries.metricType, normalizedMetric),
        eq(provenQueries.isActive, true),
        ne(provenQueries.protocol, normalizedProtocol),
        isNotNull(provenQueries.sqlQuery),
      ))
      .orderBy(desc(provenQueries.successCount))
      .limit(limit);

    if (sameMetricDiffProtocol.length >= limit) return sameMetricDiffProtocol;

    const remaining = limit - sameMetricDiffProtocol.length;
    const existingIds = sameMetricDiffProtocol.map(q => q.id);

    const sameProtocolDiffMetric = await db.select().from(provenQueries)
      .where(and(
        eq(provenQueries.protocol, normalizedProtocol),
        eq(provenQueries.isActive, true),
        ne(provenQueries.metricType, normalizedMetric),
        isNotNull(provenQueries.sqlQuery),
      ))
      .orderBy(desc(provenQueries.successCount))
      .limit(remaining);

    return [...sameMetricDiffProtocol, ...sameProtocolDiffMetric.filter(q => !existingIds.includes(q.id))];
  }

  async saveProvenQuery(data: InsertProvenQuery): Promise<ProvenQuery> {
    const normalizedData = {
      ...data,
      protocol: data.protocol.toLowerCase().trim(),
      metricType: data.metricType.toLowerCase().trim(),
    };
    const existing = await this.findProvenQuery(normalizedData.protocol, normalizedData.metricType);
    if (existing) {
      const [updated] = await db.update(provenQueries)
        .set({
          sqlQuery: normalizedData.sqlQuery,
          chartType: normalizedData.chartType,
          chartConfig: normalizedData.chartConfig,
          xAxisKey: normalizedData.xAxisKey,
          yAxisKey: normalizedData.yAxisKey,
          yAxisLabel: normalizedData.yAxisLabel,
          yAxisFormat: normalizedData.yAxisFormat,
          successCount: sql`${provenQueries.successCount} + 1`,
          failCount: 0,
          isActive: true,
          lastUsed: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(provenQueries.id, existing.id))
        .returning();
      return updated;
    }
    const [query] = await db.insert(provenQueries).values(normalizedData).returning();
    return query;
  }

  async recordProvenQuerySuccess(id: string): Promise<void> {
    await db.update(provenQueries)
      .set({
        successCount: sql`${provenQueries.successCount} + 1`,
        failCount: 0,
        lastUsed: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(provenQueries.id, id));
  }

  async recordProvenQueryFailure(id: string): Promise<void> {
    await db.update(provenQueries)
      .set({
        failCount: sql`${provenQueries.failCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(provenQueries.id, id));
    const [query] = await db.select().from(provenQueries).where(eq(provenQueries.id, id));
    if (query && query.failCount >= 3) {
      await db.update(provenQueries)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(provenQueries.id, id));
      console.log(`[ProvenQuery] Deactivated query "${query.metricType}" for "${query.protocol}" after ${query.failCount} failures`);
    }
  }

  async getStaleProvenQueries(daysSinceUse: number): Promise<ProvenQuery[]> {
    return db.select().from(provenQueries)
      .where(and(
        eq(provenQueries.isActive, true),
        sql`${provenQueries.lastUsed} < NOW() - INTERVAL '${sql.raw(String(daysSinceUse))} days'`,
      ))
      .orderBy(provenQueries.lastUsed);
  }

  async updateProvenQueryLastUsed(id: string): Promise<void> {
    await db.update(provenQueries)
      .set({ lastUsed: new Date(), updatedAt: new Date() })
      .where(eq(provenQueries.id, id));
  }

  async getLearnings(scope: string, scopeKey: string): Promise<SystemLearning[]> {
    return db.select().from(systemLearnings)
      .where(and(
        eq(systemLearnings.scope, scope),
        eq(systemLearnings.scopeKey, scopeKey.toLowerCase().trim()),
        eq(systemLearnings.isActive, true),
      ))
      .orderBy(desc(systemLearnings.confidence));
  }

  async getGlobalLearnings(): Promise<SystemLearning[]> {
    return db.select().from(systemLearnings)
      .where(and(
        eq(systemLearnings.scope, "global"),
        eq(systemLearnings.isActive, true),
      ))
      .orderBy(desc(systemLearnings.confidence));
  }

  async saveLearning(data: InsertSystemLearning): Promise<SystemLearning> {
    const normalized = {
      ...data,
      scopeKey: data.scopeKey.toLowerCase().trim(),
    };
    const existing = await db.select().from(systemLearnings)
      .where(and(
        eq(systemLearnings.scope, normalized.scope),
        eq(systemLearnings.scopeKey, normalized.scopeKey),
        eq(systemLearnings.ruleType, normalized.ruleType),
        eq(systemLearnings.ruleText, normalized.ruleText),
        eq(systemLearnings.isActive, true),
      ))
      .limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(systemLearnings)
        .set({
          confidence: sql`LEAST(${systemLearnings.confidence} + 10, 100)`,
          updatedAt: new Date(),
        })
        .where(eq(systemLearnings.id, existing[0].id))
        .returning();
      return updated;
    }
    const [learning] = await db.insert(systemLearnings).values(normalized).returning();
    return learning;
  }

  async incrementLearningApplied(id: string): Promise<void> {
    await db.update(systemLearnings)
      .set({
        appliedCount: sql`${systemLearnings.appliedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(systemLearnings.id, id));
  }

  async deactivateLearning(id: string): Promise<void> {
    await db.update(systemLearnings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(systemLearnings.id, id));
  }

  async getAllActiveLearnings(): Promise<SystemLearning[]> {
    return db.select().from(systemLearnings)
      .where(eq(systemLearnings.isActive, true))
      .orderBy(desc(systemLearnings.confidence));
  }

  // ═══════════════════════════════════════════════════════════════
  // EVAL SYSTEM — query attempts, benchmarks, runs
  // ═══════════════════════════════════════════════════════════════

  async logQueryAttempt(data: InsertQueryAttempt): Promise<QueryAttempt> {
    const [attempt] = await db.insert(queryAttempts).values(data).returning();
    return attempt;
  }

  async getQueryAttemptsByRequest(requestId: string): Promise<QueryAttempt[]> {
    return db.select().from(queryAttempts)
      .where(eq(queryAttempts.requestId, requestId))
      .orderBy(asc(queryAttempts.attemptNumber));
  }

  /** Find retry chains where attempt N failed and attempt N+1 succeeded — the diff is learning signal */
  async getRetryDiffs(daysSince: number = 30): Promise<{ failed: QueryAttempt; fixed: QueryAttempt }[]> {
    const rows = await db.execute(sql`
      SELECT
        a1.id as failed_id, a1.request_id, a1.protocol, a1.metric_type,
        a1.sql_query as failed_sql, a1.error_type, a1.error_message,
        a2.id as fixed_id, a2.sql_query as fixed_sql
      FROM query_attempts a1
      JOIN query_attempts a2
        ON a1.request_id = a2.request_id
        AND a2.attempt_number = a1.attempt_number + 1
        AND a2.final_outcome = 'success'
      WHERE a1.final_outcome = 'retry'
        AND a1.sql_query IS NOT NULL
        AND a2.sql_query IS NOT NULL
        AND a1.created_at > NOW() - INTERVAL '${sql.raw(String(daysSince))} days'
      ORDER BY a1.created_at DESC
    `);
    // Map raw rows to typed pairs
    return (rows.rows || []).map((r: any) => ({
      failed: { id: r.failed_id, requestId: r.request_id, protocol: r.protocol, metricType: r.metric_type, sqlQuery: r.failed_sql, errorType: r.error_type, errorMessage: r.error_message } as QueryAttempt,
      fixed: { id: r.fixed_id, requestId: r.request_id, protocol: r.protocol, metricType: r.metric_type, sqlQuery: r.fixed_sql } as QueryAttempt,
    }));
  }

  /** Aggregate failure patterns — which protocols/metrics fail most and why */
  async getFailurePatterns(daysSince: number = 30): Promise<{ protocol: string; metricType: string; errorType: string; count: number }[]> {
    const rows = await db.execute(sql`
      SELECT protocol, metric_type, error_type, COUNT(*) as count
      FROM query_attempts
      WHERE final_outcome IN ('failure', 'retry')
        AND error_type IS NOT NULL
        AND created_at > NOW() - INTERVAL '${sql.raw(String(daysSince))} days'
      GROUP BY protocol, metric_type, error_type
      HAVING COUNT(*) >= 2
      ORDER BY count DESC
      LIMIT 50
    `);
    return (rows.rows || []).map((r: any) => ({
      protocol: r.protocol,
      metricType: r.metric_type,
      errorType: r.error_type,
      count: Number(r.count),
    }));
  }

  // ═══ Benchmark cases ═══

  async insertBenchmarkCases(cases: InsertBenchmarkCase[]): Promise<BenchmarkCase[]> {
    if (cases.length === 0) return [];
    const results = await db.insert(benchmarkCases).values(cases).returning();
    return results;
  }

  async getActiveBenchmarkCases(difficulty?: string): Promise<BenchmarkCase[]> {
    if (difficulty) {
      return db.select().from(benchmarkCases)
        .where(and(eq(benchmarkCases.isActive, true), eq(benchmarkCases.difficulty, difficulty)));
    }
    return db.select().from(benchmarkCases).where(eq(benchmarkCases.isActive, true));
  }

  async getBenchmarkCaseCount(): Promise<number> {
    const rows = await db.execute(sql`SELECT COUNT(*) as count FROM benchmark_cases WHERE is_active = true`);
    return Number((rows.rows || [])[0]?.count || 0);
  }

  async deactivateBenchmarkCase(id: string): Promise<void> {
    await db.update(benchmarkCases).set({ isActive: false }).where(eq(benchmarkCases.id, id));
  }

  // ═══ Benchmark runs ═══

  async createBenchmarkRun(data: Partial<BenchmarkRun>): Promise<BenchmarkRun> {
    const [run] = await db.insert(benchmarkRuns).values(data as any).returning();
    return run;
  }

  async updateBenchmarkRun(id: string, data: Partial<BenchmarkRun>): Promise<BenchmarkRun | undefined> {
    const [updated] = await db.update(benchmarkRuns).set(data as any).where(eq(benchmarkRuns.id, id)).returning();
    return updated;
  }

  async getLatestBenchmarkRun(): Promise<BenchmarkRun | undefined> {
    const [run] = await db.select().from(benchmarkRuns)
      .where(eq(benchmarkRuns.status, "completed"))
      .orderBy(desc(benchmarkRuns.createdAt))
      .limit(1);
    return run;
  }

  async getBenchmarkRunHistory(limit: number = 20): Promise<BenchmarkRun[]> {
    return db.select().from(benchmarkRuns)
      .orderBy(desc(benchmarkRuns.createdAt))
      .limit(limit);
  }

  // ═══ Benchmark case results ═══

  async insertBenchmarkCaseResult(data: Partial<BenchmarkCaseResult>): Promise<BenchmarkCaseResult> {
    const [result] = await db.insert(benchmarkCaseResults).values(data as any).returning();
    return result;
  }

  async getBenchmarkCaseResultsByRun(runId: string): Promise<BenchmarkCaseResult[]> {
    return db.select().from(benchmarkCaseResults)
      .where(eq(benchmarkCaseResults.runId, runId))
      .orderBy(desc(benchmarkCaseResults.score));
  }

  async getFailedCaseResultsByRun(runId: string): Promise<(BenchmarkCaseResult & { benchmarkCase?: BenchmarkCase })[]> {
    const results = await db.select().from(benchmarkCaseResults)
      .where(and(eq(benchmarkCaseResults.runId, runId), sql`${benchmarkCaseResults.score} < 0.5`))
      .orderBy(asc(benchmarkCaseResults.score));

    // Hydrate with benchmark case details
    const caseIds = results.map(r => r.caseId);
    if (caseIds.length === 0) return [];
    const cases = await db.select().from(benchmarkCases)
      .where(sql`${benchmarkCases.id} IN (${sql.join(caseIds.map(id => sql`${id}`), sql`, `)})`);
    const caseMap = new Map(cases.map(c => [c.id, c]));

    return results.map(r => ({ ...r, benchmarkCase: caseMap.get(r.caseId) }));
  }

  async insertQueryTemplate(template: InsertQueryTemplate): Promise<QueryTemplate> {
    const [result] = await db.insert(queryTemplates).values(template).returning();
    return result;
  }

  async getQueryTemplateByName(name: string, businessModel: string): Promise<QueryTemplate | undefined> {
    const [result] = await db.select().from(queryTemplates)
      .where(and(eq(queryTemplates.name, name), eq(queryTemplates.businessModel, businessModel), eq(queryTemplates.isActive, true)));
    return result;
  }

  async getActiveQueryTemplates(): Promise<QueryTemplate[]> {
    return db.select().from(queryTemplates).where(eq(queryTemplates.isActive, true));
  }

  // ═══════════════════════════════════════════════════════════════
  // PROTOCOL REVENUE MODELS
  // ═══════════════════════════════════════════════════════════════

  async insertProtocolRevenueModel(model: InsertProtocolRevenueModel): Promise<ProtocolRevenueModel> {
    const [result] = await db.insert(protocolRevenueModels).values(model).returning();
    return result;
  }

  async getProtocolRevenueModel(protocol: string): Promise<ProtocolRevenueModel | undefined> {
    const [result] = await db.select().from(protocolRevenueModels)
      .where(and(
        eq(protocolRevenueModels.isActive, true),
        sql`LOWER(${protocolRevenueModels.protocol}) = LOWER(${protocol})`
      ));
    return result;
  }

  async updateProtocolRevenueModel(
    id: string,
    data: Partial<InsertProtocolRevenueModel & { validationStatus: string; validationScore: number; validationError: string }>
  ): Promise<ProtocolRevenueModel> {
    const [result] = await db.update(protocolRevenueModels)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(protocolRevenueModels.id, id))
      .returning();
    return result;
  }

  async getActiveProtocolRevenueModels(): Promise<ProtocolRevenueModel[]> {
    return db.select().from(protocolRevenueModels).where(eq(protocolRevenueModels.isActive, true));
  }

  async createConversation(data: { userId: string; title: string; type: string }): Promise<Conversation> {
    const [conv] = await db.insert(conversations).values(data).returning();
    return conv;
  }

  async getConversations(userId: string, type: string): Promise<Conversation[]> {
    return db.select().from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.type, type)))
      .orderBy(desc(conversations.createdAt));
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv;
  }

  async updateConversationTitle(id: number, title: string): Promise<void> {
    await db.update(conversations).set({ title }).where(eq(conversations.id, id));
  }

  async setConversationShareToken(id: number, shareToken: string | null): Promise<void> {
    await db.update(conversations).set({ shareToken }).where(eq(conversations.id, id));
  }

  async getConversationByShareToken(shareToken: string): Promise<Conversation | undefined> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.shareToken, shareToken));
    return conv;
  }

  async deleteConversation(id: number): Promise<void> {
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getMessages(conversationId: number): Promise<Message[]> {
    return db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  }

  async createMessage(data: { conversationId: number; role: string; content: string; artifacts?: any }): Promise<Message> {
    const [msg] = await db.insert(messages).values(data).returning();
    return msg;
  }

  async getResearchBrain(userId: string): Promise<any | null> {
    const [brain] = await db.select().from(researchBrains).where(eq(researchBrains.userId, userId));
    return brain || null;
  }

  async upsertResearchBrain(userId: string, brain: { entities?: any; knowledge?: any; preferences?: any; relationships?: any; contradictions?: any; meta?: any }): Promise<void> {
    const existing = await this.getResearchBrain(userId);
    if (existing) {
      const updates: any = { updatedAt: new Date() };
      if (brain.entities !== undefined) updates.entities = brain.entities;
      if (brain.knowledge !== undefined) updates.knowledge = brain.knowledge;
      if (brain.preferences !== undefined) updates.preferences = brain.preferences;
      if (brain.relationships !== undefined) updates.relationships = brain.relationships;
      if (brain.contradictions !== undefined) updates.contradictions = brain.contradictions;
      if (brain.meta !== undefined) updates.meta = brain.meta;
      await db.update(researchBrains).set(updates).where(eq(researchBrains.userId, userId));
    } else {
      await db.insert(researchBrains).values({
        userId,
        entities: brain.entities || {},
        knowledge: brain.knowledge || [],
        preferences: brain.preferences || {},
        relationships: brain.relationships || [],
        contradictions: brain.contradictions || [],
        meta: brain.meta || {},
      });
    }
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getAdminTelegramChatIds(): Promise<string[]> {
    const allWithTelegram = await db.select({ id: users.id, telegramChatId: users.telegramChatId })
      .from(users)
      .where(isNotNull(users.telegramChatId));
    const adminChatIds: string[] = [];
    for (const u of allWithTelegram) {
      if (u.telegramChatId?.trim() && await this.isAdminUser(u.id)) {
        adminChatIds.push(u.telegramChatId.trim());
      }
    }
    return adminChatIds;
  }

  async getCostAlertSettings(): Promise<CostAlertSettings | undefined> {
    const [settings] = await db.select().from(costAlertSettings).limit(1);
    return settings;
  }

  async upsertCostAlertSettings(data: { dailyThreshold: number; enabled: boolean; telegramEnabled: boolean }): Promise<CostAlertSettings> {
    const existing = await this.getCostAlertSettings();
    if (existing) {
      const [updated] = await db.update(costAlertSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(costAlertSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(costAlertSettings).values(data).returning();
    return created;
  }

  async updateCostAlertLastAlertDate(id: string, date: string): Promise<void> {
    await db.update(costAlertSettings)
      .set({ lastAlertDate: date })
      .where(eq(costAlertSettings.id, id));
  }

  async getTodayApiCost(): Promise<number> {
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as today_cost
      FROM transactions
      WHERE status = 'success'
        AND DATE(created_at) = CURRENT_DATE
    `);
    return Number(result.rows[0]?.today_cost || 0);
  }
}

export const storage = new DatabaseStorage();
