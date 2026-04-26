"""
BacktestPlan models — the JSON contract emitted by the Node-side LLM
translator and consumed by this engine. Mirrors server/backtest-agent.ts Zod
schema 1:1; if you change one, change the other.
"""
from __future__ import annotations
from typing import Literal, Optional, Union, List
from pydantic import BaseModel, Field, ConfigDict


# ── Indicator references ─────────────────────────────────────────────────────

class Indicator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    indicator: Literal["rsi", "sma", "ema", "macd_hist", "atr", "bbands_upper",
                       "bbands_lower", "vol_pct_change", "price_pct_change", "close"]
    period: Optional[int] = None        # window length
    source: Optional[Literal["close", "high", "low", "open", "volume"]] = "close"
    lookback: Optional[int] = None      # for pct_change


class Constant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    const: float


# ── Expression DSL (recursive) ───────────────────────────────────────────────

Operand = Union[Indicator, Constant, "BinaryOp", "LogicalOp"]


class BinaryOp(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: Literal["gt", "gte", "lt", "lte", "eq", "neq", "cross_above", "cross_below"]
    left: Operand
    right: Operand


class LogicalOp(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: Literal["and", "or", "not"]
    args: List[Operand]


BinaryOp.model_rebuild()
LogicalOp.model_rebuild()


# ── Plan ─────────────────────────────────────────────────────────────────────

class Universe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    exchange: Literal["binance", "bybit", "coinbase", "hyperliquid"]
    symbol: str


class Lookback(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: str                   # ISO date
    end: Optional[str] = None    # default = now


class Sizing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["fixed_fraction", "volatility_target"]
    value: float = Field(gt=0)


class Costs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fee_bps: float = Field(ge=0, default=10)
    slippage_bps: float = Field(ge=0, default=5)


class Signals(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry: BinaryOp | LogicalOp
    exit: BinaryOp | LogicalOp


class BacktestPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    thesis: str
    universe: List[Universe] = Field(min_length=1, max_length=20)
    interval: Literal["1h", "1d"]
    lookback: Lookback
    signals: Signals
    sizing: Sizing
    costs: Costs = Field(default_factory=Costs)
    benchmark: Optional[Literal["hodl", "btc"]] = "hodl"
    direction: Literal["long", "short", "long_short"] = "long"
