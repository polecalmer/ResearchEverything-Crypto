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
}

const ANTHROPIC_MPP_URL = "https://anthropic.mpp.tempo.xyz/v1/messages";

export async function callAnthropic(request: AnthropicRequest): Promise<AnthropicResponse> {
  const response = await ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))(ANTHROPIC_MPP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "mpp",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  let text = "";
  if (data.content) {
    for (const block of data.content) {
      if (block.type === "text") {
        text += block.text;
      }
    }
  }

  return {
    text,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
  };
}
