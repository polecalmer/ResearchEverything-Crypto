// Translator tests for the OpenRouter direct client. Locks in the
// Anthropic↔OpenAI shape conversion so an env-flag flip (LLM_PROVIDER=
// openrouter) doesn't silently change what the agent sees.
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import { logger } from "./logger";

beforeAll(() => {
  logger.level = "silent";
});

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.OPENROUTER_API_KEY = "test-key";
});

/* ──────────────────────── Request translation ──────────────────────── */

describe("toOpenAIRequest", () => {
  it("converts a system string and plain user message", async () => {
    const { toOpenAIRequest } = await import("./openrouter-client");
    const out = toOpenAIRequest({
      model: "claude-opus-4-7",
      system: "You are a research assistant.",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
    });
    expect(out.model).toBe("anthropic/claude-opus-4-7");
    expect(out.messages[0]).toEqual({ role: "system", content: "You are a research assistant." });
    expect(out.messages[1]).toEqual({ role: "user", content: "Hi" });
    expect(out.max_tokens).toBe(100);
  });

  it("flattens an array-shaped system prompt", async () => {
    const { toOpenAIRequest } = await import("./openrouter-client");
    const out = toOpenAIRequest({
      model: "claude-sonnet-4-6",
      system: [
        { type: "text", text: "Block A." },
        { type: "text", text: "Block B." },
      ],
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
    });
    expect(out.messages[0]).toEqual({ role: "system", content: "Block A.\n\nBlock B." });
  });

  it("translates assistant tool_use blocks into OpenAI tool_calls", async () => {
    const { toOpenAIRequest } = await import("./openrouter-client");
    const out = toOpenAIRequest({
      model: "claude-haiku-4-5",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll fetch TVL." },
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "query_defillama_tvl",
              input: { protocol: "aave" },
            },
          ],
        },
      ],
      max_tokens: 100,
    });
    const assistantMsg = out.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe("I'll fetch TVL.");
    expect(assistantMsg!.tool_calls).toHaveLength(1);
    expect(assistantMsg!.tool_calls![0]).toEqual({
      id: "toolu_abc",
      type: "function",
      function: {
        name: "query_defillama_tvl",
        arguments: JSON.stringify({ protocol: "aave" }),
      },
    });
  });

  it("translates user tool_result blocks into OpenAI tool messages", async () => {
    const { toOpenAIRequest } = await import("./openrouter-client");
    const out = toOpenAIRequest({
      model: "claude-haiku-4-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_abc",
              content: '{"protocol":"aave","points":365}',
            },
            { type: "text", text: "Now what does this mean?" },
          ],
        },
      ],
      max_tokens: 100,
    });
    // Tool result message is emitted FIRST, then the user's text.
    const toolMsg = out.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.tool_call_id).toBe("toolu_abc");
    expect(toolMsg!.content).toContain("aave");
    const userMsg = out.messages.find((m) => m.role === "user");
    expect(userMsg!.content).toBe("Now what does this mean?");
  });

  it("translates tools array (input_schema → parameters)", async () => {
    const { toOpenAIRequest } = await import("./openrouter-client");
    const out = toOpenAIRequest({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      tools: [
        {
          name: "query_defillama_tvl",
          description: "Fetch TVL history",
          input_schema: { type: "object", properties: { protocol: { type: "string" } } },
        },
      ],
    });
    expect(out.tools).toHaveLength(1);
    expect(out.tools![0]).toEqual({
      type: "function",
      function: {
        name: "query_defillama_tvl",
        description: "Fetch TVL history",
        parameters: { type: "object", properties: { protocol: { type: "string" } } },
      },
    });
  });

  it("passes through model IDs that already have a provider prefix", async () => {
    const { toOpenAIRequest } = await import("./openrouter-client");
    const out = toOpenAIRequest({
      model: "moonshotai/kimi-k2",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
    });
    expect(out.model).toBe("moonshotai/kimi-k2");
  });

  it("opts into usage tracking on streaming requests", async () => {
    const { toOpenAIRequest } = await import("./openrouter-client");
    const out = toOpenAIRequest({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      stream: true,
    });
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
  });
});

/* ──────────────────────── Non-streaming end-to-end ──────────────────────── */

describe("callAnthropicViaOpenRouter (non-streaming)", () => {
  it("translates an OpenAI response back to AnthropicRawResponse shape", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Aave TVL is recovering.",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 320, completion_tokens: 84, cost: 0.0042 },
        }),
        { status: 200 },
      ),
    );

    const { callAnthropicViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicViaOpenRouter({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "What's Aave's TVL trend?" }],
      max_tokens: 100,
    });

    expect(out.content).toEqual([{ type: "text", text: "Aave TVL is recovering." }]);
    expect(out.usage).toEqual({ input_tokens: 320, output_tokens: 84 });
    expect(out.stop_reason).toBe("end_turn");
    expect(out.mppCost).toBe(0.0042);
    expect(out.costSource).toBe("receipt");
  });

  it("maps tool_calls finish_reason to stop_reason=tool_use and emits tool_use blocks", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-2",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "I'll fetch the data.",
                tool_calls: [
                  {
                    id: "call_xyz",
                    type: "function",
                    function: {
                      name: "query_defillama_tvl",
                      arguments: JSON.stringify({ protocol: "aave" }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200 },
      ),
    );

    const { callAnthropicViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicViaOpenRouter({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "Get Aave TVL" }],
      max_tokens: 100,
    });

    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: "text", text: "I'll fetch the data." });
    expect(out.content[1]).toEqual({
      type: "tool_use",
      id: "call_xyz",
      name: "query_defillama_tvl",
      input: { protocol: "aave" },
    });
  });

  it("maps finish_reason=length to stop_reason=max_tokens", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-3",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Truncated…" },
              finish_reason: "length",
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 4096 },
        }),
        { status: 200 },
      ),
    );
    const { callAnthropicViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicViaOpenRouter({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "..." }],
      max_tokens: 4096,
    });
    expect(out.stop_reason).toBe("max_tokens");
  });

  it("falls back to voucher_estimate when OpenRouter omits usage.cost", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-4",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hi." },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      ),
    );
    const { callAnthropicViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicViaOpenRouter({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 50,
    });
    expect(out.mppCost).toBe(0);
    expect(out.costSource).toBe("voucher_estimate");
  });

  it("throws on a non-retryable error code (400)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("bad request", { status: 400 }),
    );
    const { callAnthropicViaOpenRouter } = await import("./openrouter-client");
    await expect(
      callAnthropicViaOpenRouter({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 50,
      }),
    ).rejects.toThrow(/OpenRouter API error \(400\)/);
  });

  it("includes the bearer auth header in the outgoing request", async () => {
    let sentInit: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sentInit = init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 },
        }),
        { status: 200 },
      );
    });
    const { callAnthropicViaOpenRouter } = await import("./openrouter-client");
    await callAnthropicViaOpenRouter({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 50,
    });
    const headers = sentInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer test-key");
  });
});

/* ──────────────────────── Streaming end-to-end ──────────────────────── */

/** Build a fake SSE Response.body from a list of OpenAI streaming events. */
function fakeSSEStream(events: any[]): Response {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunks));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("callAnthropicStreamingViaOpenRouter", () => {
  it("accumulates text deltas into a single Anthropic text block", async () => {
    const events = [
      { choices: [{ delta: { role: "assistant", content: "Aave" } }] },
      { choices: [{ delta: { content: " TVL" } }] },
      { choices: [{ delta: { content: " is recovering." }, finish_reason: "stop" }] },
      { usage: { prompt_tokens: 320, completion_tokens: 84, cost: 0.004 } },
    ];
    vi.stubGlobal("fetch", async () => fakeSSEStream(events));

    const { callAnthropicStreamingViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicStreamingViaOpenRouter({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "What's Aave's TVL trend?" }],
      max_tokens: 100,
    });

    expect(out.content).toEqual([{ type: "text", text: "Aave TVL is recovering." }]);
    expect(out.usage).toEqual({ input_tokens: 320, output_tokens: 84 });
    expect(out.stop_reason).toBe("end_turn");
    expect(out.mppCost).toBe(0.004);
  });

  it("rebuilds a tool_use block from streamed tool_call arg deltas", async () => {
    // OpenAI streams tool arguments as concatenated string deltas keyed
    // by index. The translator must reassemble them into a single
    // tool_use block with parsed input.
    const events = [
      {
        choices: [
          {
            delta: {
              role: "assistant",
              tool_calls: [
                { index: 0, id: "call_xyz", function: { name: "query_defillama_tvl", arguments: "" } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '{"prot' } }] } },
        ],
      },
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: 'ocol":"aave"}' } }] } },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 } },
    ];
    vi.stubGlobal("fetch", async () => fakeSSEStream(events));

    const { callAnthropicStreamingViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicStreamingViaOpenRouter({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "Get Aave TVL" }],
      max_tokens: 100,
    });

    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toEqual({
      type: "tool_use",
      id: "call_xyz",
      name: "query_defillama_tvl",
      input: { protocol: "aave" },
    });
  });

  it("interleaves text and tool_use blocks in stream order", async () => {
    const events = [
      { choices: [{ delta: { role: "assistant", content: "I'll fetch this." } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "tool_a", arguments: '{"x":1}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { usage: { prompt_tokens: 50, completion_tokens: 20 } },
    ];
    vi.stubGlobal("fetch", async () => fakeSSEStream(events));

    const { callAnthropicStreamingViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicStreamingViaOpenRouter({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Run a tool" }],
      max_tokens: 100,
    });
    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: "text", text: "I'll fetch this." });
    expect(out.content[1]).toMatchObject({
      type: "tool_use",
      id: "call_1",
      name: "tool_a",
      input: { x: 1 },
    });
  });

  it("handles malformed tool_call arguments without crashing", async () => {
    // If the streamed arguments string isn't valid JSON after assembly,
    // the agent's tool dispatcher gets {} and surfaces the failure
    // through its own retry / error path. The translator must NOT throw.
    const events = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_z", function: { name: "broken", arguments: '{"unterminated' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { usage: { prompt_tokens: 10, completion_tokens: 10 } },
    ];
    vi.stubGlobal("fetch", async () => fakeSSEStream(events));

    const { callAnthropicStreamingViaOpenRouter } = await import("./openrouter-client");
    const out = await callAnthropicStreamingViaOpenRouter({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
    });
    expect(out.content[0]).toMatchObject({ type: "tool_use", input: {} });
  });
});
