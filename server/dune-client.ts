import { getRequestSignal, abortableSleep } from "./request-context";

const DUNE_API_BASE = "https://api.dune.com/api/v1";

export interface DuneQueryResult {
  columns: string[];
  rows: Record<string, any>[];
  metadata: {
    queryId: number;
    executionId: string;
    state: string;
    rowCount: number;
  };
}

function getDuneApiKey(): string {
  const key = process.env.DUNE_API_KEY;
  if (!key) throw new Error("DUNE_API_KEY not set");
  return key;
}

export function isDuneConfigured(): boolean {
  return !!process.env.DUNE_API_KEY;
}

async function executeDuneQueryOnce(queryId: number, params?: Record<string, any>): Promise<DuneQueryResult> {
  const apiKey = getDuneApiKey();
  const signal = getRequestSignal();
  signal?.throwIfAborted();

  const executeRes = await fetch(`${DUNE_API_BASE}/query/${queryId}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dune-API-Key": apiKey,
    },
    body: JSON.stringify({ query_parameters: params || {}, performance: "large" }),
    signal,
  });

  if (!executeRes.ok) {
    const err = await executeRes.text().catch(() => "Unknown error");
    throw new Error(`Dune execute failed (${executeRes.status}): ${err}`);
  }

  const { execution_id } = await executeRes.json();

  const maxAttempts = 60;
  const pollInterval = 3000;

  for (let i = 0; i < maxAttempts; i++) {
    await abortableSleep(pollInterval, signal);

    const statusRes = await fetch(`${DUNE_API_BASE}/execution/${execution_id}/status`, {
      headers: { "X-Dune-API-Key": apiKey },
      signal,
    });

    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();
    const state = statusData.state;

    if (state === "QUERY_STATE_COMPLETED") {
      const resultsRes = await fetch(`${DUNE_API_BASE}/execution/${execution_id}/results?limit=1000`, {
        headers: { "X-Dune-API-Key": apiKey },
        signal,
      });

      if (!resultsRes.ok) {
        throw new Error(`Dune results fetch failed (${resultsRes.status})`);
      }

      const resultsData = await resultsRes.json();
      const result = resultsData.result;

      return {
        columns: result?.metadata?.column_names || [],
        rows: result?.rows || [],
        metadata: {
          queryId,
          executionId: execution_id,
          state: "completed",
          rowCount: result?.metadata?.total_row_count || result?.rows?.length || 0,
        },
      };
    }

    if (state === "QUERY_STATE_FAILED" || state === "QUERY_STATE_CANCELLED") {
      throw new Error(`Dune query ${queryId} ${state.toLowerCase()}`);
    }
  }

  throw new Error(`Dune query ${queryId} timed out after ${maxAttempts * pollInterval / 1000}s`);
}

export async function executeDuneQuery(queryId: number, params?: Record<string, any>): Promise<DuneQueryResult> {
  try {
    return await executeDuneQueryOnce(queryId, params);
  } catch (firstError: any) {
    const isQueryFailed = firstError.message?.includes("query_state_failed");
    console.log(`[Dune] Query ${queryId} first attempt failed: ${firstError.message}`);

    if (isQueryFailed) {
      console.log(`[Dune] Query ${queryId} failed on Dune side, trying cached results...`);
      try {
        const cached = await getLatestDuneResults(queryId);
        if (cached.rows.length > 0) {
          console.log(`[Dune] Returning ${cached.rows.length} cached rows for query ${queryId}`);
          return cached;
        }
      } catch (cacheErr: any) {
        console.log(`[Dune] Cache fallback also failed for query ${queryId}: ${cacheErr.message}`);
      }

      console.log(`[Dune] Retrying execution for query ${queryId}...`);
      await new Promise((r) => setTimeout(r, 5000));
      try {
        return await executeDuneQueryOnce(queryId, params);
      } catch (retryError: any) {
        console.log(`[Dune] Retry also failed for query ${queryId}: ${retryError.message}`);
        throw new Error(`Dune query ${queryId} failed after retry. The query may have errors on Dune's side — try a different query or check the query on dune.com.`);
      }
    }

    throw firstError;
  }
}

export async function executeDuneSQL(sql: string, name?: string): Promise<DuneQueryResult> {
  const apiKey = getDuneApiKey();
  const signal = getRequestSignal();
  signal?.throwIfAborted();
  const queryName = name || `agent_sql_${Date.now()}`;

  console.log(`[Dune] Creating ad-hoc SQL query: ${queryName}`);
  console.log(`[Dune] SQL: ${sql.slice(0, 200)}...`);

  const createRes = await fetch(`${DUNE_API_BASE}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dune-API-Key": apiKey,
    },
    body: JSON.stringify({
      name: queryName,
      query_sql: sql,
      is_private: false,
    }),
    signal,
  });

  if (!createRes.ok) {
    const err = await createRes.text().catch(() => "Unknown error");
    throw new Error(`Dune SQL create failed (${createRes.status}): ${err}`);
  }

  const { query_id } = await createRes.json();
  console.log(`[Dune] Created query ${query_id}, executing...`);

  try {
    const result = await executeDuneQueryOnce(query_id, {});
    // Archive the query after execution to avoid hitting private query limits
    archiveDuneQuery(query_id, apiKey).catch(() => {});
    return result;
  } catch (err: any) {
    // Archive even on failure
    archiveDuneQuery(query_id, apiKey).catch(() => {});
    throw new Error(`Dune SQL execution failed for query ${query_id}: ${err.message}`);
  }
}

/** Archive (soft-delete) a private query to free up the private query slot */
async function archiveDuneQuery(queryId: number, apiKey: string): Promise<void> {
  try {
    await fetch(`${DUNE_API_BASE}/query/${queryId}/archive`, {
      method: "POST",
      headers: { "X-Dune-API-Key": apiKey },
    });
  } catch {}
}

export async function getLatestDuneResults(queryId: number): Promise<DuneQueryResult> {
  const apiKey = getDuneApiKey();
  const signal = getRequestSignal();
  signal?.throwIfAborted();

  const res = await fetch(`${DUNE_API_BASE}/query/${queryId}/results?limit=1000`, {
    headers: { "X-Dune-API-Key": apiKey },
    signal,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return executeDuneQuery(queryId);
    }
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Dune latest results failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const result = data.result;

  return {
    columns: result?.metadata?.column_names || [],
    rows: result?.rows || [],
    metadata: {
      queryId,
      executionId: data.execution_id || "",
      state: "completed",
      rowCount: result?.metadata?.total_row_count || result?.rows?.length || 0,
    },
  };
}
