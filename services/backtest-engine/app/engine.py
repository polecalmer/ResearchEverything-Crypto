"""
Translate a BacktestPlan into vectorbt-compatible signal arrays and run the
backtest. Returns metrics + equity curve + trades.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import vectorbt as vbt
from typing import Any

from .plan import BacktestPlan, Indicator, Constant, BinaryOp, LogicalOp
from .loader import resolve_market_ids, load_ohlcv


# ── Indicator computation ────────────────────────────────────────────────────

def _series_for_source(df: pd.DataFrame, source: str | None) -> pd.Series:
    return df[source or "close"]


def compute_indicator(df: pd.DataFrame, ind: Indicator) -> pd.Series:
    src = _series_for_source(df, ind.source)
    name = ind.indicator
    if name == "close":
        return df["close"]
    if name == "sma":
        return src.rolling(ind.period or 20).mean()
    if name == "ema":
        return src.ewm(span=ind.period or 20, adjust=False).mean()
    if name == "rsi":
        delta = src.diff()
        gain = delta.where(delta > 0, 0.0).rolling(ind.period or 14).mean()
        loss = (-delta.where(delta < 0, 0.0)).rolling(ind.period or 14).mean()
        rs = gain / loss.replace(0, np.nan)
        return 100 - (100 / (1 + rs))
    if name == "macd_hist":
        ema_fast = src.ewm(span=12, adjust=False).mean()
        ema_slow = src.ewm(span=26, adjust=False).mean()
        macd = ema_fast - ema_slow
        signal = macd.ewm(span=9, adjust=False).mean()
        return macd - signal
    if name == "atr":
        h, l, c = df["high"], df["low"], df["close"]
        tr = pd.concat([(h - l), (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
        return tr.rolling(ind.period or 14).mean()
    if name in ("bbands_upper", "bbands_lower"):
        period = ind.period or 20
        ma = src.rolling(period).mean()
        std = src.rolling(period).std()
        return ma + 2 * std if name == "bbands_upper" else ma - 2 * std
    if name == "vol_pct_change":
        return df["volume"].pct_change(ind.lookback or 1)
    if name == "price_pct_change":
        return src.pct_change(ind.lookback or 1)
    raise ValueError(f"unsupported indicator: {name}")


# ── Expression evaluator ────────────────────────────────────────────────────

def evaluate(node: Any, df: pd.DataFrame) -> pd.Series:
    if isinstance(node, Indicator):
        return compute_indicator(df, node)
    if isinstance(node, Constant):
        return pd.Series(node.const, index=df.index)
    if isinstance(node, BinaryOp):
        l = evaluate(node.left, df)
        r = evaluate(node.right, df)
        op = node.op
        if op == "gt":  return l > r
        if op == "gte": return l >= r
        if op == "lt":  return l < r
        if op == "lte": return l <= r
        if op == "eq":  return l == r
        if op == "neq": return l != r
        if op == "cross_above":
            prev_l, prev_r = l.shift(1), r.shift(1)
            return (l > r) & (prev_l <= prev_r)
        if op == "cross_below":
            prev_l, prev_r = l.shift(1), r.shift(1)
            return (l < r) & (prev_l >= prev_r)
        raise ValueError(f"bad binary op {op}")
    if isinstance(node, LogicalOp):
        op = node.op
        if op == "not":
            return ~evaluate(node.args[0], df).astype(bool)
        results = [evaluate(a, df).astype(bool) for a in node.args]
        out = results[0]
        for r in results[1:]:
            out = out & r if op == "and" else out | r
        return out
    raise ValueError(f"bad node {node}")


# ── Run ─────────────────────────────────────────────────────────────────────

def run_backtest(plan: BacktestPlan) -> dict:
    market_ids = resolve_market_ids(plan.universe)
    if len(plan.universe) > 1:
        raise NotImplementedError("v1 supports a single-market universe; multi-asset coming next")

    u = plan.universe[0]
    market_id = market_ids[f"{u.exchange}:{u.symbol}"]
    df = load_ohlcv(market_id, plan.interval, plan.lookback.start, plan.lookback.end)
    if df.empty or len(df) < 30:
        raise ValueError(f"not enough OHLCV data for {u.exchange}/{u.symbol} ({plan.interval}): {len(df)} bars")

    entries = evaluate(plan.signals.entry, df).fillna(False).astype(bool)
    exits = evaluate(plan.signals.exit, df).fillna(False).astype(bool)

    fees = plan.costs.fee_bps / 10_000
    slippage = plan.costs.slippage_bps / 10_000

    if plan.sizing.type == "fixed_fraction":
        size = plan.sizing.value     # fraction of equity
        size_type = "percent"
    else:
        size = plan.sizing.value     # treat as fraction; vol-target is a v2 enhancement
        size_type = "percent"

    pf = vbt.Portfolio.from_signals(
        df["close"],
        entries=entries,
        exits=exits,
        fees=fees,
        slippage=slippage,
        size=size,
        size_type=size_type,
        freq=plan.interval,
        direction=plan.direction,
    )

    stats = pf.stats()
    equity = pf.value()
    benchmark_return = float((df["close"].iloc[-1] / df["close"].iloc[0]) - 1.0)

    trades_df = pf.trades.records_readable
    trade_rows = []
    for _, row in trades_df.head(500).iterrows():
        trade_rows.append({
            "entry_ts": str(row.get("Entry Timestamp", "")),
            "exit_ts": str(row.get("Exit Timestamp", "")),
            "size": float(row.get("Size", 0)),
            "pnl": float(row.get("PnL", 0)),
            "return": float(row.get("Return", 0)),
        })

    metrics = {
        "total_return": float(stats.get("Total Return [%]", 0)) / 100.0,
        "annualized_return": float(stats.get("Total Return [%]", 0)) / 100.0,   # simplified; refined in v2
        "sharpe": float(stats.get("Sharpe Ratio", 0) or 0),
        "sortino": float(stats.get("Sortino Ratio", 0) or 0),
        "max_drawdown": float(stats.get("Max Drawdown [%]", 0) or 0) / 100.0,
        "win_rate": float(stats.get("Win Rate [%]", 0) or 0) / 100.0,
        "trade_count": int(stats.get("Total Trades", 0) or 0),
        "exposure": float(stats.get("Exposure [%]", 0) or 0) / 100.0,
        "benchmark_return": benchmark_return,
        "alpha_vs_hodl": (float(stats.get("Total Return [%]", 0)) / 100.0) - benchmark_return,
    }

    equity_curve = [
        {"ts": ts.isoformat(), "equity": float(v)}
        for ts, v in equity.items()
    ]

    return {"metrics": metrics, "equity_curve": equity_curve, "trades": trade_rows}
