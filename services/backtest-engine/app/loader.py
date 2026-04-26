"""
Pluggable OHLCV loaders.

The engine accepts a `data` block in the request that selects one of:
  - postgres:    market_id pulled from the configured DATABASE_URL
  - inline:      bars supplied verbatim in the request body
  - parquet_url: presigned/HTTP parquet URL (e.g. Hydromancer S3 reservoir)
  - csv_path:    local CSV file (CLI / batch use)

Adding a new source means: a new dataclass in `DataSource` union and a new
branch in `load_dataframe`. The engine never touches Postgres directly any
more — everything routes through this module.
"""
from __future__ import annotations
import os
from typing import Any, Iterable, Literal, Union, List, Optional
import pandas as pd
import psycopg
from pydantic import BaseModel, ConfigDict, Field

from .plan import Universe


# ── Request data-source models ──────────────────────────────────────────────

class PostgresSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["postgres"]
    market_id: str


class InlineBar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ts: str            # ISO timestamp
    open: float
    high: float
    low: float
    close: float
    volume: float
    quote_volume: Optional[float] = None


class InlineSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["inline"]
    bars: List[InlineBar] = Field(min_length=1)


class ParquetUrlSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["parquet_url"]
    url: str
    symbol: str        # used to filter a multi-symbol parquet


class CsvPathSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["csv_path"]
    path: str


DataSource = Union[PostgresSource, InlineSource, ParquetUrlSource, CsvPathSource]


# ── Postgres ────────────────────────────────────────────────────────────────

def _conn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set — required for the postgres data source")
    return psycopg.connect(url)


def _table(interval: str) -> str:
    return {"1h": "ohlcv_1h", "1d": "ohlcv_1d"}[interval]


def resolve_market_ids(symbols: Iterable[Universe]) -> dict[str, str]:
    """Map (exchange, symbol) → market_id, used by the postgres mode."""
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


def _load_postgres(source: PostgresSource, interval: str, start: str, end: str | None) -> pd.DataFrame:
    table = _table(interval)
    end_clause = "AND ts <= %s" if end else ""
    args: list = [source.market_id, start]
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
    return _frame_from_rows(rows, ["ts", "open", "high", "low", "close", "volume", "quote_volume"])


# ── Inline ──────────────────────────────────────────────────────────────────

def _load_inline(source: InlineSource) -> pd.DataFrame:
    df = pd.DataFrame([b.model_dump() for b in source.bars])
    return _normalize_index(df)


# ── Parquet URL (e.g. Hydromancer S3) ───────────────────────────────────────

def _load_parquet_url(source: ParquetUrlSource) -> pd.DataFrame:
    # pandas reads parquet from any URL pyarrow + fsspec can resolve.
    # For S3 reservoirs configured as requester-pays, the caller must set
    # AWS_REQUEST_PAYER=requester before launching the engine.
    df = pd.read_parquet(source.url)
    if "coin" in df.columns:
        df = df[df["coin"] == source.symbol]
    if "timestamp" in df.columns and "ts" not in df.columns:
        df = df.rename(columns={"timestamp": "ts"})
    return _normalize_index(df)


# ── CSV ─────────────────────────────────────────────────────────────────────

def _load_csv(source: CsvPathSource) -> pd.DataFrame:
    df = pd.read_csv(source.path)
    if "timestamp" in df.columns and "ts" not in df.columns:
        df = df.rename(columns={"timestamp": "ts"})
    return _normalize_index(df)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _frame_from_rows(rows: list, columns: list[str]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=columns).set_index("ts" if "ts" in columns else None)
    df = pd.DataFrame(rows, columns=columns)
    return _normalize_index(df)


def _normalize_index(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.set_index("ts").sort_index()
    keep = [c for c in ("open", "high", "low", "close", "volume", "quote_volume") if c in df.columns]
    df = df[keep]
    return df.astype({c: float for c in keep if c != "trades"})


# ── Public entry point ─────────────────────────────────────────────────────

def load_dataframe(source: DataSource, interval: str, start: str, end: str | None) -> pd.DataFrame:
    if source.mode == "postgres":
        return _load_postgres(source, interval, start, end)
    if source.mode == "inline":
        df = _load_inline(source)
    elif source.mode == "parquet_url":
        df = _load_parquet_url(source)
    elif source.mode == "csv_path":
        df = _load_csv(source)
    else:
        raise ValueError(f"unsupported data source mode: {getattr(source, 'mode', '?')}")

    # Apply the lookback filter to non-postgres sources (postgres applies it
    # in SQL).
    start_ts = pd.to_datetime(start, utc=True)
    df = df[df.index >= start_ts]
    if end:
        end_ts = pd.to_datetime(end, utc=True)
        df = df[df.index <= end_ts]
    return df
