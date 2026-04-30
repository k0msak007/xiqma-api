// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter wrapper — minimal client for chat completions.
// Configurable via env:
//   OPENROUTER_API_KEY  (required)
//   OPENROUTER_MODEL    (default: "anthropic/claude-3.5-sonnet")
//   OPENROUTER_BASE_URL (default: "https://openrouter.ai/api/v1")
//   OPENROUTER_APP_NAME (sent as X-Title header for OpenRouter analytics)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompleteOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Hint for providers that support OpenAI-style JSON mode */
  responseFormat?: "json_object";
  tools?: Tool[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCompletionResult {
  text: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  toolCalls?: ToolCall[];
}

const DEFAULT_MODEL = "anthropic/claude-3.5-sonnet";
const BASE_URL      = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

export async function chatComplete(opts: ChatCompleteOptions): Promise<ChatCompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set in environment");
  }

  const model = opts.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer":  "https://xiqma.app",
      "X-Title":       process.env.OPENROUTER_APP_NAME ?? "Xiqma",
    },
    body: JSON.stringify({
      model,
      messages:    opts.messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens:  opts.maxTokens ?? 1500,
      ...(opts.responseFormat === "json_object"
        ? { response_format: { type: "json_object" } }
        : {}),
      ...(opts.tools?.length
        ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto" }
        : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // Some providers reject response_format=json_object — retry once without it.
    if (
      res.status === 400 &&
      opts.responseFormat === "json_object" &&
      /json mode is not supported|response_format/i.test(errText)
    ) {
      return await chatComplete({ ...opts, responseFormat: undefined });
    }
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json: any = await res.json();
  const choice  = json?.choices?.[0];
  const message = choice?.message;

  // Try multiple shapes — different providers return content differently:
  //   1. OpenAI-compatible: message.content (string)
  //   2. Some Anthropic-via-OR: message.content (array of {type:"text", text:"..."})
  //   3. Reasoning models: message.reasoning + empty content (Tencent HY, DeepSeek R1, …)
  //   4. Refusal: message.refusal (string)
  let text: string | null = null;
  if (typeof message?.content === "string" && message.content.trim()) {
    text = message.content;
  } else if (Array.isArray(message?.content)) {
    text = message.content
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
      .trim() || null;
  } else if (typeof message?.reasoning === "string" && message.reasoning.trim()) {
    // Reasoning-only response — fall back to reasoning text
    text = message.reasoning;
  } else if (typeof message?.refusal === "string" && message.refusal.trim()) {
    throw new Error(`OpenRouter model refused: ${message.refusal}`);
  }

  if (!text) {
    // Surface useful diagnostics: finish_reason, model, raw payload (truncated)
    const finish = choice?.finish_reason ?? choice?.native_finish_reason ?? "unknown";
    const rawSnippet = JSON.stringify(json).slice(0, 800);
    throw new Error(
      `OpenRouter returned no completion text (model=${json?.model ?? model}, finish_reason=${finish}). ` +
      `Raw: ${rawSnippet}`
    );
  }

  // Extract tool_calls if present
  const toolCalls: ToolCall[] | undefined = message?.tool_calls?.length
    ? message.tool_calls.map((tc: any) => ({
        id:       tc.id ?? "",
        type:     tc.type ?? "function",
        function: {
          name:      tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "{}",
        },
      }))
    : undefined;

  return {
    text,
    model: json?.model ?? model,
    usage: json?.usage
      ? {
          promptTokens:     Number(json.usage.prompt_tokens ?? 0),
          completionTokens: Number(json.usage.completion_tokens ?? 0),
          totalTokens:      Number(json.usage.total_tokens ?? 0),
        }
      : undefined,
    toolCalls,
  };
}
