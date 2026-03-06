import {
  type User, type InsertUser,
  type Company, type InsertCompany,
  type Founder, type InsertFounder,
  type Note, type InsertNote,
  users, companies, founders, notes,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";
import { pool } from "./db";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";

const PgStore = connectPgSimple(session);

export interface IStorage {
  sessionStore: session.Store;

  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

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
}

export const storage = new DatabaseStorage();
