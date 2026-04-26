"""
FastAPI sidecar.  Single endpoint: POST /backtest with { plan, data }.
The `data` block selects which loader pulls OHLCV (postgres / inline /
parquet_url / csv_path) — see app/loader.py for the discriminated-union
schema. Returns metrics + equity curve + trades.
"""
from __future__ import annotations
import os
import time
import logging
from typing import Annotated
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .plan import BacktestPlan
from .loader import (
    DataSource, PostgresSource, InlineSource, ParquetUrlSource, CsvPathSource,
)
from .engine import run_backtest

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("backtest-engine")

app = FastAPI(title="ResearchEverything Backtest Engine", version="0.2.0")


class BacktestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: BacktestPlan
    data: DataSource = Field(discriminator="mode")


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.2.0"}


@app.post("/backtest")
def backtest(req: BacktestRequest):
    started = time.time()
    try:
        result = run_backtest(req.plan, req.data)
        result["duration_ms"] = int((time.time() - started) * 1000)
        return JSONResponse(result)
    except ValueError as ex:
        log.warning("backtest validation: %s", ex)
        raise HTTPException(status_code=422, detail=str(ex))
    except NotImplementedError as ex:
        raise HTTPException(status_code=501, detail=str(ex))
    except Exception as ex:
        log.exception("backtest failed")
        raise HTTPException(status_code=500, detail=f"engine error: {ex}")
