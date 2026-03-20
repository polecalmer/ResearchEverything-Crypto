import {
  type User, type InsertUser,
  type Company, type InsertCompany,
  type Founder, type InsertFounder,
  type Note, type InsertNote,
  type Report,
  type Transaction,
  users, companies, founders, notes, reports, transactions,
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
}

export const storage = new DatabaseStorage();
