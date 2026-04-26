import { db } from "../db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  exchanges,
  markets,
  ohlcv1h,
  ohlcv1d,
  backtestRuns,
  provenStrategies,
  marketDataHealth,
  type Market,
  type Exchange,
  type Ohlcv1h,
  type Ohlcv1d,
  type BacktestRun,
  type InsertBacktestRun,
  type ProvenStrategy,
  type InsertProvenStrategy,
  type ExchangeSlug,
  type OhlcvInterval,
} from "@shared/schema";
import type { NormalizedKline, NormalizedMarket } from "../exchange-clients";

const ohlcvTable = (interval: OhlcvInterval) => (interval === "1h" ? ohlcv1h : ohlcv1d);

export const backtestStorage = {
  // ─── Exchanges & markets ─────────────────────────────────────────────────

  async upsertExchange(slug: ExchangeSlug, name: string): Promise<Exchange> {
    const [row] = await db.insert(exchanges)
      .values({ slug, name })
      .onConflictDoUpdate({ target: exchanges.slug, set: { name } })
      .returning();
    return row;
  },

  async upsertMarkets(rows: NormalizedMarket[]): Promise<Market[]> {
    if (rows.length === 0) return [];
    const out: Market[] = [];
    for (const m of rows) {
      const [r] = await db.insert(markets)
        .values({
          exchangeSlug: m.exchangeSlug,
          symbol: m.symbol,
          base: m.base,
          quote: m.quote,
          type: m.type,
          status: m.status,
          quoteVolume24h: m.quoteVolume24h,
        })
        .onConflictDoUpdate({
          target: [markets.exchangeSlug, markets.symbol],
          set: {
            base: m.base,
            quote: m.quote,
            type: m.type,
            status: m.status,
            quoteVolume24h: m.quoteVolume24h,
            updatedAt: new Date(),
          },
        })
        .returning();
      out.push(r);
    }
    return out;
  },

  async getMarket(exchangeSlug: ExchangeSlug, symbol: string): Promise<Market | undefined> {
    const [m] = await db.select().from(markets)
      .where(and(eq(markets.exchangeSlug, exchangeSlug), eq(markets.symbol, symbol)))
      .limit(1);
    return m;
  },

  async listMarketsForExchange(exchangeSlug: ExchangeSlug, opts?: { topNByVolume?: number }): Promise<Market[]> {
    let q = db.select().from(markets).where(eq(markets.exchangeSlug, exchangeSlug));
    const rows = await q;
    if (opts?.topNByVolume) {
      return rows
        .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
        .slice(0, opts.topNByVolume);
    }
    return rows;
  },

  async findMarketsByBase(base: string): Promise<Market[]> {
    return db.select().from(markets).where(eq(markets.base, base.toUpperCase()));
  },

  // ─── OHLCV ───────────────────────────────────────────────────────────────

  /** Returns the most recent bar timestamp stored for a market, or null. Used
   *  by the seeder + WS worker to resume from where they left off. */
  async getLatestBarTs(marketId: string, interval: OhlcvInterval): Promise<Date | null> {
    const t = ohlcvTable(interval);
    const [row] = await db.select({ ts: t.ts }).from(t)
      .where(eq(t.marketId, marketId))
      .orderBy(desc(t.ts))
      .limit(1);
    return row?.ts ?? null;
  },

  /** Idempotent batch upsert. Conflicts on (market_id, ts) → keep latest values
   *  (a streaming bar may revise the in-flight bar before close). */
  async upsertKlines(marketId: string, interval: OhlcvInterval, bars: NormalizedKline[]): Promise<number> {
    if (bars.length === 0) return 0;
    const t = ohlcvTable(interval);
    const values = bars.map(b => ({
      marketId,
      ts: b.ts,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      quoteVolume: b.quoteVolume,
      trades: b.trades,
    }));
    // pg.params cap is ~65k; we stay well under by chunking at 500 rows × 9 cols.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK);
      await db.insert(t)
        .values(slice)
        .onConflictDoUpdate({
          target: [t.marketId, t.ts],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            quoteVolume: sql`excluded.quote_volume`,
            trades: sql`excluded.trades`,
          },
        });
      inserted += slice.length;
    }
    return inserted;
  },

  async getOhlcv(args: {
    marketId: string;
    interval: OhlcvInterval;
    start: Date;
    end: Date;
  }): Promise<Array<Ohlcv1h | Ohlcv1d>> {
    const t = ohlcvTable(args.interval);
    return db.select().from(t)
      .where(and(
        eq(t.marketId, args.marketId),
        gte(t.ts, args.start),
        lte(t.ts, args.end),
      ))
      .orderBy(asc(t.ts));
  },

  async countOhlcv(marketId: string, interval: OhlcvInterval): Promise<number> {
    const t = ohlcvTable(interval);
    const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(t)
      .where(eq(t.marketId, marketId));
    return row?.c ?? 0;
  },

  // ─── Backtest runs ───────────────────────────────────────────────────────

  async createBacktestRun(data: InsertBacktestRun): Promise<BacktestRun> {
    const [row] = await db.insert(backtestRuns).values(data).returning();
    return row;
  },

  async updateBacktestRun(
    id: string,
    patch: Partial<Pick<BacktestRun, "metrics" | "equityCurve" | "trades" | "status" | "errorMessage" | "durationMs" | "llmCostUsd">>,
  ): Promise<BacktestRun | undefined> {
    const [row] = await db.update(backtestRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(backtestRuns.id, id))
      .returning();
    return row;
  },

  async getBacktestRun(id: string): Promise<BacktestRun | undefined> {
    const [row] = await db.select().from(backtestRuns).where(eq(backtestRuns.id, id)).limit(1);
    return row;
  },

  // ─── Proven strategies ───────────────────────────────────────────────────

  async findProvenStrategy(asset: string, strategyType: string): Promise<ProvenStrategy | undefined> {
    const [row] = await db.select().from(provenStrategies)
      .where(and(
        eq(provenStrategies.asset, asset.toLowerCase().trim()),
        eq(provenStrategies.strategyType, strategyType.toLowerCase().trim()),
        eq(provenStrategies.isActive, true),
      ))
      .orderBy(desc(provenStrategies.successCount))
      .limit(1);
    return row;
  },

  async getStrategyExamples(asset: string, strategyType: string, limit = 3): Promise<ProvenStrategy[]> {
    const a = asset.toLowerCase().trim();
    const s = strategyType.toLowerCase().trim();
    return db.select().from(provenStrategies)
      .where(and(
        eq(provenStrategies.isActive, true),
        sql`(${provenStrategies.asset} = ${a} OR ${provenStrategies.strategyType} = ${s})`,
      ))
      .orderBy(desc(provenStrategies.successCount))
      .limit(limit);
  },

  async saveProvenStrategy(data: InsertProvenStrategy): Promise<ProvenStrategy> {
    const normalized = {
      ...data,
      asset: data.asset.toLowerCase().trim(),
      strategyType: data.strategyType.toLowerCase().trim(),
    };
    const existing = await this.findProvenStrategy(normalized.asset, normalized.strategyType);
    if (existing) {
      const [updated] = await db.update(provenStrategies)
        .set({
          plan: normalized.plan,
          lastSharpe: normalized.lastSharpe,
          lastReturn: normalized.lastReturn,
          lastMaxDrawdown: normalized.lastMaxDrawdown,
          successCount: sql`${provenStrategies.successCount} + 1`,
          failCount: 0,
          isActive: true,
          lastUsed: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(provenStrategies.id, existing.id))
        .returning();
      return updated;
    }
    const [row] = await db.insert(provenStrategies).values(normalized).returning();
    return row;
  },

  // ─── Worker health ───────────────────────────────────────────────────────

  async upsertHealth(args: {
    exchangeSlug: ExchangeSlug;
    interval: OhlcvInterval;
    lastBarTs?: Date;
    lastError?: string | null;
    workerId?: string;
  }) {
    await db.insert(marketDataHealth)
      .values({
        exchangeSlug: args.exchangeSlug,
        interval: args.interval,
        lastBarTs: args.lastBarTs,
        lastIngestAt: new Date(),
        lastError: args.lastError ?? null,
        workerId: args.workerId,
      })
      .onConflictDoUpdate({
        target: [marketDataHealth.exchangeSlug, marketDataHealth.interval],
        set: {
          lastBarTs: args.lastBarTs,
          lastIngestAt: new Date(),
          lastError: args.lastError ?? null,
          workerId: args.workerId,
          updatedAt: new Date(),
        },
      });
  },
};
