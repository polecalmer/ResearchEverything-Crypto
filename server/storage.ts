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
  users, companies, founders, notes, reports, transactions,
  tokenProfiles, masterDuneQueries, duneQueries, tokenAnalyses, dashboardCharts,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, isNull, sql } from "drizzle-orm";
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

  logTransaction(data: { userId: string; type: string; description: string; amount: string; apiCost?: string; companyName?: string; inputTokens?: number; outputTokens?: number; txHash?: string; status?: string }): Promise<Transaction>;
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
  updateDashboardChart(id: string, data: Partial<Pick<DashboardChart, 'title' | 'description' | 'chartType' | 'chartConfig' | 'data' | 'status' | 'errorMessage' | 'updatedAt'>>): Promise<DashboardChart | undefined>;
  getDashboardChart(id: string): Promise<DashboardChart | undefined>;
  getDashboardChartsByCompany(companyId: string, userId: string): Promise<DashboardChart[]>;
  deleteDashboardChart(id: string): Promise<boolean>;
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

  async logTransaction(data: { userId: string; type: string; description: string; amount: string; apiCost?: string; companyName?: string; inputTokens?: number; outputTokens?: number; txHash?: string; status?: string }): Promise<Transaction> {
    const [tx] = await db.insert(transactions).values(data).returning();
    return tx;
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

  async updateDashboardChart(id: string, data: Partial<Pick<DashboardChart, 'title' | 'description' | 'chartType' | 'chartConfig' | 'data' | 'status' | 'errorMessage' | 'updatedAt'>>): Promise<DashboardChart | undefined> {
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
      .orderBy(desc(dashboardCharts.createdAt));
  }

  async deleteDashboardChart(id: string): Promise<boolean> {
    const result = await db.delete(dashboardCharts).where(eq(dashboardCharts.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
