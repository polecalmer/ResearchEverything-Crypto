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

export async function executeDuneQuery(queryId: number, params?: Record<string, any>): Promise<DuneQueryResult> {
  const apiKey = getDuneApiKey();

  const executeRes = await fetch(`${DUNE_API_BASE}/query/${queryId}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dune-API-Key": apiKey,
    },
    body: JSON.stringify({ query_parameters: params || {}, performance: "large" }),
  });

  if (!executeRes.ok) {
    const err = await executeRes.text().catch(() => "Unknown error");
    throw new Error(`Dune execute failed (${executeRes.status}): ${err}`);
  }

  const { execution_id } = await executeRes.json();

  const maxAttempts = 60;
  const pollInterval = 3000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const statusRes = await fetch(`${DUNE_API_BASE}/execution/${execution_id}/status`, {
      headers: { "X-Dune-API-Key": apiKey },
    });

    if (!statusRes.ok) continue;

    const statusData = await statusRes.json();
    const state = statusData.state;

    if (state === "QUERY_STATE_COMPLETED") {
      const resultsRes = await fetch(`${DUNE_API_BASE}/execution/${execution_id}/results?limit=1000`, {
        headers: { "X-Dune-API-Key": apiKey },
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

export async function getLatestDuneResults(queryId: number): Promise<DuneQueryResult> {
  const apiKey = getDuneApiKey();

  const res = await fetch(`${DUNE_API_BASE}/query/${queryId}/results?limit=1000`, {
    headers: { "X-Dune-API-Key": apiKey },
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
