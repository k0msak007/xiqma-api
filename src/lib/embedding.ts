// ─────────────────────────────────────────────────────────────────────────────
// Embedding helper — wraps OpenRouter embeddings API.
// Uses: openai/text-embedding-3-small (1536 dimensions).
// Configurable via env:
//   OPENROUTER_API_KEY  (required, shared with chatComplete)
//   OPENROUTER_BASE_URL (default: "https://openrouter.ai/api/v1")
// ─────────────────────────────────────────────────────────────────────────────

const API_KEY  = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const MODEL    = "openai/text-embedding-3-small";

/** Build the text that will be embedded for a task. */
export function embedText(input: { title: string; description?: string | null }): string {
  const parts = [input.title ?? ""];
  if (input.description) parts.push(input.description);
  return parts.join(" ").trim();
}

/**
 * Generate an embedding vector for the given text.
 * Returns a 1536-dimensional float array.
 */
export async function createEmbedding(text: string): Promise<number[]> {
  if (!text) throw new Error("Cannot embed empty text");
  if (!API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      "HTTP-Referer":  "https://xiqma.app",
      "X-Title":       process.env.OPENROUTER_APP_NAME ?? "Xiqma",
    },
    body: JSON.stringify({
      model: MODEL,
      input: text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding API ${res.status}: ${body.slice(0, 500)}`);
  }

  const json: any = await res.json();
  const embedding = json?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Embedding API returned no embedding data");
  }
  return embedding;
}

/**
 * Serialize an embedding array to a Postgres vector literal string.
 * e.g. [0.1, 0.2, 0.3] → "'[0.1,0.2,0.3]'::vector"
 */
export function toVectorLiteral(embedding: number[]): string {
  const s = embedding.map((n) => Number(n).toFixed(8)).join(",");
  return `'[${s}]'::vector`;
}
