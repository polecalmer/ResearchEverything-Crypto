export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ type: string; name: string; max_uses?: number }>;
}

export interface AnthropicResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  mppCost: number;
}

export async function callAnthropic(
  request: AnthropicRequest,
  accessToken?: string | null,
): Promise<AnthropicResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
    headers["X-Privy-Token"] = accessToken;
  }

  const response = await fetch("/api/ai/proxy", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: "AI call failed" }));
    throw new Error(errorData.message || `AI call failed (${response.status})`);
  }

  const data = await response.json();
  return {
    text: data.text,
    usage: data.usage,
    mppCost: data.mppCost || 0,
  };
}
