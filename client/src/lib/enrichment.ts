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
}

const AGENT_LABELS: Record<string, string> = {
  scraper: "Web Scraper",
  identifier: "Identifier Agent",
  researcher: "Research Agent",
  verify_clean: "Verify & Clean Agent",
};

const AGENT_DESCRIPTIONS: Record<string, string> = {
  scraper: "Fetching real content from the URL",
  identifier: "Figuring out which company is referenced",
  researcher: "Building a comprehensive deal card",
  verify_clean: "Fact-checking claims and stripping unverified data",
};

export function getAgentLabel(agent: string): string {
  return AGENT_LABELS[agent] || agent;
}

export function getAgentDescription(agent: string): string {
  return AGENT_DESCRIPTIONS[agent] || "";
}

export async function streamEnrichment(
  input: string,
  onStage: (stage: EnrichmentStage) => void,
  getAccessToken?: () => Promise<string | null>,
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (getAccessToken) {
    const token = await getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch("/api/enrich/stream", {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Enrichment failed");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);

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
            total: event.total || 4,
            message: "",
            status: "complete",
            companyName: event.companyName,
            confidence: event.confidence,
            issuesFound: event.issuesFound,
            assessment: event.assessment,
            pagesFetched: event.pagesFetched,
          });
        } else if (event.type === "complete") {
          result = event.data;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  if (!result) throw new Error("Enrichment completed but no data received");
  return result;
}
