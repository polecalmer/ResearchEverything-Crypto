"""
FastAPI sidecar.  Single endpoint: POST /backtest with a BacktestPlan body.
Returns metrics + equity curve + trades.  Exposed only to the Node app over
a private network; no auth in v1 — add a shared-secret header before any
public exposure.
"""
from __future__ import annotations
import os
import time
import logging
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from .plan import BacktestPlan
from .engine import run_backtest

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("backtest-engine")

app = FastAPI(title="ResearchEverything Backtest Engine", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/backtest")
def backtest(plan: BacktestPlan):
    started = time.time()
    try:
        result = run_backtest(plan)
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
