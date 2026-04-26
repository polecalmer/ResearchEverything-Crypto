"""
Pulls OHLCV from the same Postgres the Node app uses. Read-only.
"""
from __future__ import annotations
import os
import pandas as pd
import psycopg
from datetime import datetime
from typing import Iterable

from .plan import Universe


def _conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set in backtest sidecar environment")
    # psycopg accepts the standard pg URL
    return psycopg.connect(url)


def _table(interval: str) -> str:
    return {"1h": "ohlcv_1h", "1d": "ohlcv_1d"}[interval]


def resolve_market_ids(symbols: Iterable[Universe]) -> dict[str, str]:
    """Map (exchange, symbol) → market_id."""
    out: dict[str, str] = {}
    with _conn() as c:
        for u in symbols:
            with c.cursor() as cur:
                cur.execute(
                    "SELECT id FROM markets WHERE exchange_slug=%s AND symbol=%s LIMIT 1",
                    (u.exchange, u.symbol),
                )
                row = cur.fetchone()
                if row is None:
                    raise ValueError(f"market not seeded: {u.exchange}/{u.symbol}")
                out[f"{u.exchange}:{u.symbol}"] = row[0]
    return out


def load_ohlcv(market_id: str, interval: str, start: str, end: str | None) -> pd.DataFrame:
    table = _table(interval)
    end_clause = "AND ts <= %s" if end else ""
    args: list = [market_id, start]
    if end:
        args.append(end)
    sql = f"""
        SELECT ts, open, high, low, close, volume, quote_volume
        FROM {table}
        WHERE market_id = %s AND ts >= %s {end_clause}
        ORDER BY ts ASC
    """
    with _conn() as c, c.cursor() as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    if not rows:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume", "quote_volume"])
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume", "quote_volume"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.set_index("ts")
    return df.astype({"open": float, "high": float, "low": float, "close": float, "volume": float})
