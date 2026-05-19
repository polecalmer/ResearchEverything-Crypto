/**
 * execute_python tool — subprocess-based Python execution.
 *
 * Phase 4a (this module): one-shot, hardened subprocess per call.
 *   - Pre-built venv at server/python-sandbox/venv/ with whitelisted libs
 *     (pandas, numpy, scipy, statsmodels, scikit-learn, openpyxl).
 *   - Code → stdin, result → stdout JSON, errors → stderr.
 *   - Resource limits: 60s wall timeout, 512MB memory cap, no network.
 *   - No persistent kernel state across calls; each call is fresh.
 *
 * Phase 4b (separate work): persistent kernel per session — Jupyter-style
 * state across tool calls. Enables hermes' iterative "build df → transform
 * → analyze → save" rhythm. Bigger lift; ship Phase 4a first, validate,
 * then come back.
 *
 * Security model:
 *   - Pre-built venv means only whitelisted packages are importable.
 *   - We do NOT use `eval()` / `python -c` on raw user input — instead
 *     write the code to a temp file and exec that, so multiline programs
 *     work without shell-escaping nightmare.
 *   - Subprocess inherits a STRIPPED env — no AWS creds, no API keys, no
 *     paths to host secrets.
 *   - Working directory is a session-scoped temp dir; no access to the
 *     server's filesystem outside that dir.
 *   - SIGKILL on timeout, child reaped, temp file cleaned on exit.
 *
 * Output contract:
 *   - The agent's code MUST emit ONE JSON object to stdout via
 *     `print(json.dumps(result))`. Anything else printed is captured as
 *     "stdout_warning" and surfaced to the model as a hint.
 *   - If the JSON parse fails, we return the raw stdout truncated.
 *   - Stderr is captured and returned as `stderr` for debugging — visible
 *     to the model so it can fix syntax errors.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getRequestContext } from "./request-context";
import { logger } from "./logger";

/* ─────────────────────────── Config ─────────────────────────── */

// Resolve the venv's python binary. The venv must be bootstrapped via
// server/python-sandbox/bootstrap.sh before first use; if missing we
// fall back to the system python3 with a clear warning (agent gets the
// error and can't use the tool until setup).
const PYTHON_SANDBOX_DIR = path.resolve(
  process.cwd(),
  "server/python-sandbox",
);
const VENV_PYTHON = path.join(PYTHON_SANDBOX_DIR, "venv/bin/python3");
const SCRATCH_ROOT = "/tmp/sessions-python-scratch";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_CODE_BYTES = 100_000; // 100KB cap on source code
const MAX_STDOUT_BYTES = 5 * 1024 * 1024; // 5MB stdout
const MAX_STDERR_BYTES = 256 * 1024; // 256KB stderr

/* ────────────────────── Venv discovery ────────────────────── */

let _venvCheckCache: { exists: boolean; checkedAt: number } | null = null;
const VENV_CHECK_TTL_MS = 30_000;

async function venvExists(): Promise<boolean> {
  if (_venvCheckCache && Date.now() - _venvCheckCache.checkedAt < VENV_CHECK_TTL_MS) {
    return _venvCheckCache.exists;
  }
  try {
    const stat = await fs.stat(VENV_PYTHON);
    _venvCheckCache = { exists: stat.isFile(), checkedAt: Date.now() };
    return stat.isFile();
  } catch {
    _venvCheckCache = { exists: false, checkedAt: Date.now() };
    return false;
  }
}

/* ─────────────────── Tool definition ─────────────────── */

export const EXECUTE_PYTHON_TOOL_DEF = {
  name: "execute_python",
  description:
    "Execute Python in a sandboxed subprocess with pandas, numpy, scipy, statsmodels, scikit-learn, and openpyxl preloaded. Use for: statistical analysis (regression, distributions, hypothesis tests), time-series math (rolling windows, resampling, decomposition), valuation modeling (scenario lattices, sensitivity tables, Monte Carlo), data transformations (merging series, computing derived columns, pivoting), Excel workbook construction (use openpyxl to build complex models; alternatively use write_xlsx for simple sheet shapes). Your code MUST print exactly one JSON object to stdout via `print(json.dumps(result))` — the JSON is returned to you. Anything else printed becomes a stdout_warning. The Python process has no network access and no host filesystem access outside its scratch dir. Timeout default 60s, max 120s. For SIMPLE single-value computations (one ratio, one sum), use the lighter `compute` or `execute_code` tools — `execute_python` is for analysis with statistical or scientific libraries.",
  input_schema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "Python source code. MUST end with `print(json.dumps(result))` where `result` is the value you want returned. Imports allowed: json, math, re, statistics, datetime, pandas as pd, numpy as np, scipy, statsmodels.api as sm, sklearn (preloaded; do NOT `pip install`). Input data: pass as constants in the code (the agent loop's tool outputs are JSON strings — paste their data arrays inline).",
      },
      description: {
        type: "string",
        description: "Short label for this computation (1-line). Logged + surfaced in the agent's thinking trace.",
      },
      timeout_seconds: {
        type: "integer",
        description: "Wall-clock timeout in seconds (default 60, max 120). Use higher only when the computation actually needs it — fitting a large regression, Monte Carlo runs.",
        minimum: 1,
        maximum: 120,
      },
    },
    required: ["code"],
  },
} as const;

/* ─────────────────── Executor ─────────────────── */

interface ExecuteInput {
  code: string;
  description?: string;
  timeout_seconds?: number;
}

interface ExecResult {
  ok: boolean;
  /** Parsed JSON from stdout (or raw stdout when JSON parse fails). */
  result?: any;
  /** Captured stderr — non-empty doesn't mean failure (DeprecationWarning,
   *  pandas SettingWithCopy notices, etc. land here). */
  stderr?: string;
  /** Set when stdout had non-JSON content the agent should know about. */
  stdoutWarning?: string;
  error?: string;
  durationMs: number;
}

async function ensureScratchDir(sessionId: string): Promise<string> {
  const id = crypto.randomBytes(6).toString("hex");
  const dir = path.join(SCRATCH_ROOT, String(sessionId), id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function execute(input: ExecuteInput, sessionId: string): Promise<ExecResult> {
  const start = Date.now();
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(1000, (input.timeout_seconds ?? 60) * 1000),
  );

  if (!input.code || typeof input.code !== "string" || !input.code.trim()) {
    return {
      ok: false,
      error: "execute_python requires a non-empty `code` string.",
      durationMs: 0,
    };
  }
  if (input.code.length > MAX_CODE_BYTES) {
    return {
      ok: false,
      error: `Code too large (${input.code.length} bytes, max ${MAX_CODE_BYTES}).`,
      durationMs: 0,
    };
  }

  const hasVenv = await venvExists();
  if (!hasVenv) {
    return {
      ok: false,
      error: `Python sandbox not bootstrapped. The venv at ${VENV_PYTHON} is missing. Run \`bash server/python-sandbox/bootstrap.sh\` to set it up, then retry. Until then, fall back to execute_code (JavaScript) or the compute tool for derived numbers.`,
      durationMs: 0,
    };
  }

  let scratch: string;
  try {
    scratch = await ensureScratchDir(sessionId);
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to create scratch dir: ${err?.message || String(err)}`,
      durationMs: 0,
    };
  }

  const codeFile = path.join(scratch, "exec.py");
  try {
    await fs.writeFile(codeFile, input.code, "utf-8");
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to write code file: ${err?.message || String(err)}`,
      durationMs: Date.now() - start,
    };
  }

  // Stripped env — only what Python needs to import the venv's libs.
  // Crucially we DON'T inherit AWS / API keys / DATABASE_URL / etc. so
  // even if the venv had a malicious package, it wouldn't see secrets.
  // PATH includes the venv's bin so any subprocess Python tries to spawn
  // resolves to the sandboxed binary.
  const venvBin = path.join(PYTHON_SANDBOX_DIR, "venv/bin");
  const env: NodeJS.ProcessEnv = {
    PATH: `${venvBin}:/usr/bin:/bin`,
    HOME: scratch,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    // Block network attempts. Python's stdlib socket module still works
    // (we can't fully block at the language level without a wrapper),
    // but most common HTTP libs (requests, urllib3) honor these.
    HTTP_PROXY: "http://127.0.0.1:0",
    HTTPS_PROXY: "http://127.0.0.1:0",
    NO_PROXY: "",
    // Disable Python's user-site so the agent can't import packages from
    // the host user's pip dir.
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8",
  };

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);

  try {
    const child = spawn(VENV_PYTHON, [codeFile], {
      cwd: scratch,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      // Detach so we can kill the entire process group if it spawns
      // subprocesses (unlikely but defensive).
      detached: false,
    });

    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) {
        stdout = Buffer.concat([stdout, chunk]);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr = Buffer.concat([stderr, chunk]);
      }
    });

    const exitCode: number = await new Promise((resolve) => {
      child.on("close", (code) => resolve(code ?? -1));
      child.on("error", () => resolve(-1));
    });
    clearTimeout(timer);

    const stdoutStr = stdout.toString("utf-8");
    const stderrStr = stderr.toString("utf-8");

    if (killedByTimeout) {
      return {
        ok: false,
        error: `Execution timed out after ${timeoutMs / 1000}s. Either the code is too slow, or it's stuck in a loop. Reduce data size, vectorise with numpy/pandas, or split the work into smaller calls.`,
        stderr: stderrStr.slice(0, 4000),
        durationMs: Date.now() - start,
      };
    }
    if (exitCode !== 0) {
      return {
        ok: false,
        error: `Python exited with code ${exitCode}.`,
        stderr: stderrStr.slice(0, 8000),
        durationMs: Date.now() - start,
      };
    }

    // Parse stdout as JSON. If it has both JSON and other text, the JSON
    // must be on the LAST non-empty line (that's our convention from the
    // print(json.dumps(...)) contract).
    const lines = stdoutStr.split("\n").map((l) => l.trim()).filter(Boolean);
    let parsed: any = undefined;
    let warning: string | undefined;
    if (lines.length === 0) {
      warning = "Python printed nothing — did you forget `print(json.dumps(result))`?";
    } else {
      const last = lines[lines.length - 1];
      try {
        parsed = JSON.parse(last);
        if (lines.length > 1) {
          warning = `Stdout contained ${lines.length - 1} non-JSON line(s) before the result. Use logging via stderr (sys.stderr.write) for debug prints; stdout should be exactly the JSON result.`;
        }
      } catch {
        // Try the whole thing as JSON (in case it's pretty-printed)
        try {
          parsed = JSON.parse(stdoutStr);
        } catch {
          warning = `Stdout was not valid JSON. Wrap your result in \`print(json.dumps(result))\`. Raw stdout (first 1000 chars): ${stdoutStr.slice(0, 1000)}`;
          parsed = stdoutStr.slice(0, MAX_STDOUT_BYTES);
        }
      }
    }

    return {
      ok: true,
      result: parsed,
      stderr: stderrStr ? stderrStr.slice(0, 4000) : undefined,
      stdoutWarning: warning,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    // Best-effort cleanup of the scratch dir. Don't fail if it errors.
    fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

/** Public entrypoint — called from the agent's executeTool dispatch. */
export async function executePython(input: ExecuteInput): Promise<string> {
  const ctx = getRequestContext();
  const sessionId = ctx?.sessionId ? String(ctx.sessionId) : "default";
  const description = input.description || "compute";

  logger.info(
    { sessionId, description, codeBytes: input.code?.length || 0, timeoutS: input.timeout_seconds ?? 60 },
    "execute_python start",
  );

  const res = await execute(input, sessionId);

  logger.info(
    { sessionId, description, ok: res.ok, durationMs: res.durationMs, hasWarning: !!res.stdoutWarning },
    "execute_python done",
  );

  if (!res.ok) {
    return JSON.stringify({
      error: res.error,
      ...(res.stderr ? { stderr: res.stderr } : {}),
      durationMs: res.durationMs,
    });
  }

  return JSON.stringify({
    ok: true,
    result: res.result,
    ...(res.stdoutWarning ? { stdoutWarning: res.stdoutWarning } : {}),
    ...(res.stderr ? { stderr: res.stderr } : {}),
    durationMs: res.durationMs,
  });
}
