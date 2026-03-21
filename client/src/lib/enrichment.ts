import { callAnthropic } from "./anthropic";

export interface EnrichmentStage {
  agent: string;
  step: number;
  total: number;
  message: string;
  status: "running" | "complete";
  companyName?: string;
  confidence?: string;
  issuesFound?: number;
  assessment?: string;
  pagesFetched?: number;
  readsFound?: number;
}

const AGENT_LABELS: Record<string, string> = {
  scraper: "Web Scraper",
  identifier: "Identifier Agent",
  researcher: "Research Agent",
  verify_clean: "Verify & Clean Agent",
  dd_reads: "Due Diligence Reads",
};

const AGENT_DESCRIPTIONS: Record<string, string> = {
  scraper: "Fetching real content from the URL",
  identifier: "Figuring out which company is referenced",
  researcher: "Building a comprehensive deal card",
  verify_clean: "Fact-checking claims and stripping unverified data",
  dd_reads: "Finding critical adjacent reads for due diligence",
};

export function getAgentLabel(agent: string): string {
  return AGENT_LABELS[agent] || agent;
}

export function getAgentDescription(agent: string): string {
  return AGENT_DESCRIPTIONS[agent] || "";
}

function emitProgress(events: any[], onStage: (stage: EnrichmentStage) => void) {
  for (const event of events) {
    if (event.type === "stage") {
      onStage({
        agent: event.agent,
        step: event.step,
        total: event.total,
        message: event.message,
        status: "running",
      });
    } else if (event.type === "stage_complete") {
      onStage({
        agent: event.agent,
        step: event.step,
        total: event.total || 5,
        message: "",
        status: "complete",
        companyName: event.companyName,
        confidence: event.confidence,
        issuesFound: event.issuesFound,
        assessment: event.assessment,
        pagesFetched: event.pagesFetched,
        readsFound: event.readsFound,
      });
    }
  }
}

export async function runEnrichmentPipeline(
  input: string,
  onStage: (stage: EnrichmentStage) => void,
  getAccessToken?: () => Promise<string | null>,
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let token: string | null = null;
  if (getAccessToken) {
    token = await getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-Privy-Token"] = token;
    }
  }

  const prepareRes = await fetch("/api/enrich/prepare", {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });

  if (!prepareRes.ok) {
    const error = await prepareRes.json().catch(() => ({ message: "Enrichment failed" }));
    throw new Error(error.message || "Enrichment failed");
  }

  let { sessionId, anthropicRequest, progress } = await prepareRes.json();
  emitProgress(progress, onStage);

  const MAX_ENRICHMENT_STEPS = 10;
  for (let step = 0; step < MAX_ENRICHMENT_STEPS; step++) {
    const anthropicResponse = await callAnthropic(anthropicRequest, token);

    const stepRes = await fetch("/api/enrich/step", {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId,
        responseText: anthropicResponse.text,
        responseUsage: anthropicResponse.usage,
        mppCost: anthropicResponse.mppCost,
      }),
    });

    if (!stepRes.ok) {
      const error = await stepRes.json().catch(() => ({ message: "Enrichment step failed" }));
      throw new Error(error.message || "Enrichment step failed");
    }

    const stepData = await stepRes.json();

    if (stepData.progress) {
      emitProgress(stepData.progress, onStage);
    }

    if (stepData.result) {
      return stepData.result.enriched;
    }

    if (stepData.anthropicRequest) {
      anthropicRequest = stepData.anthropicRequest;
    } else {
      throw new Error("Unexpected response from enrichment step");
    }
  }
  throw new Error("Enrichment pipeline exceeded maximum steps");
}

export async function runNextStepsPipeline(
  companyId: string,
  getAccessToken?: () => Promise<string | null>,
): Promise<any[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let token: string | null = null;
  if (getAccessToken) {
    token = await getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-Privy-Token"] = token;
    }
  }

  const prepareRes = await fetch(`/api/companies/${companyId}/next-steps/prepare`, {
    method: "POST",
    headers,
  });

  if (!prepareRes.ok) {
    const error = await prepareRes.json().catch(() => ({ message: "Next steps failed" }));
    throw new Error(error.message || "Next steps failed");
  }

  let { sessionId, anthropicRequest } = await prepareRes.json();

  const MAX_NEXT_STEPS_ITERATIONS = 5;
  for (let step = 0; step < MAX_NEXT_STEPS_ITERATIONS; step++) {
    const anthropicResponse = await callAnthropic(anthropicRequest, token);

    const stepRes = await fetch(`/api/companies/${companyId}/next-steps/step`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId,
        responseText: anthropicResponse.text,
        responseUsage: anthropicResponse.usage,
        mppCost: anthropicResponse.mppCost,
      }),
    });

    if (!stepRes.ok) {
      const error = await stepRes.json().catch(() => ({ message: "Next steps step failed" }));
      throw new Error(error.message || "Next steps step failed");
    }

    const stepData = await stepRes.json();

    if (stepData.result) {
      return stepData.result.steps;
    }

    if (stepData.anthropicRequest) {
      anthropicRequest = stepData.anthropicRequest;
    } else {
      throw new Error("Unexpected response from next steps step");
    }
  }
  throw new Error("Next steps pipeline exceeded maximum steps");
}

export async function runDeepResearchPipeline(
  companyId: string,
  getAccessToken?: () => Promise<string | null>,
): Promise<{ reportId: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (getAccessToken) {
    const token = await getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-Privy-Token"] = token;
    }
  }

  const prepareRes = await fetch(`/api/companies/${companyId}/reports/prepare`, {
    method: "POST",
    headers,
  });

  if (!prepareRes.ok) {
    const error = await prepareRes.json().catch(() => ({ message: "Deep research failed" }));
    throw new Error(error.message || "Deep research failed");
  }

  const { reportId } = await prepareRes.json();
  return { reportId };
}
