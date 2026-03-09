import {
  type User, type InsertUser,
  type Company, type InsertCompany,
  type Founder, type InsertFounder,
  type Note, type InsertNote,
  type Report,
  users, companies, founders, notes, reports,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { pool } from "./db";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";

const PgStore = connectPgSimple(session);

export interface IStorage {
  sessionStore: session.Store;

  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getUserCredits(userId: string): Promise<number>;
  deductCredit(userId: string): Promise<boolean>;
  addCredits(userId: string, amount: number): Promise<number>;
  updateStripeCustomerId(userId: string, customerId: string): Promise<void>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;

  getCompanies(userId: string): Promise<Company[]>;
  getCompany(id: string, userId?: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<InsertCompany>, userId?: string): Promise<Company | undefined>;
  deleteCompany(id: string, userId?: string): Promise<void>;

  getFoundersByCompany(companyId: string): Promise<Founder[]>;
  createFounder(founder: InsertFounder): Promise<Founder>;

  getNotesByCompany(companyId: string): Promise<Note[]>;
  createNote(note: InsertNote): Promise<Note>;
  deleteNote(id: string): Promise<void>;

  updateSubscription(userId: string, data: { subscriptionStatus: string; subscriptionId: string; subscriptionPeriodEnd: Date | null }): Promise<void>;

  createReport(data: { companyId: string; userId: string; title: string; content: string; status: string }): Promise<Report>;
  updateReport(id: string, data: { content?: string; status?: string }): Promise<Report | undefined>;
  getReport(id: string): Promise<Report | undefined>;
  getReportsByCompany(companyId: string, userId: string): Promise<Report[]>;

  claimOrphanedCompanies(userId: string): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PgStore({
      pool,
      createTableIfMissing: true,
    });
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getUserCredits(userId: string): Promise<number> {
    const [user] = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId));
    return user?.credits ?? 0;
  }

  async deductCredit(userId: string): Promise<boolean> {
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

  async deleteNote(id: string): Promise<void> {
    await db.delete(notes).where(eq(notes.id, id));
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
}

export const storage = new DatabaseStorage();
