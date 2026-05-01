import { createMiddleware } from "hono/factory";
import { db } from "@/lib/db.ts";
import { auditLogs } from "@/db/schema/logs.schema.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Paths we skip entirely — tokens/passwords and high-volume noise
const SKIP_PREFIXES = [
  "/api/auth",
  "/api/notifications",
];

const SENSITIVE_FIELDS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "refreshToken",
  "accessToken",
  "apiToken",
  "apiKey",
]);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function tableFromPath(path: string): string | null {
  const m = /^\/api\/([a-z0-9-]+)/i.exec(path);
  return m?.[1] ?? null;
}

function recordIdFromPath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  for (const part of parts) {
    if (UUID_RE.test(part)) return part;
  }
  return null;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_FIELDS.has(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Global middleware — logs every successful mutating API call to `audit_logs`.
 * Runs AFTER downstream handlers so it can read c.get("user") (set by authMiddleware)
 * and the response status. Failures in audit writing never break the request.
 */
export const auditMiddleware = createMiddleware(async (c, next) => {
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const shouldLog =
    MUTATING.has(method) && !SKIP_PREFIXES.some((p) => path.startsWith(p));

  // Capture body BEFORE next() — the handler will consume the stream.
  // Skip multipart/file uploads — binary data can't be stored in JSONB.
  let body: unknown = null;
  if (shouldLog) {
    const contentType = c.req.header("content-type") ?? "";
    const isMultipart = contentType.startsWith("multipart/form-data");
    if (!isMultipart) {
      try {
        const clone = c.req.raw.clone();
        const text = await clone.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = { raw: text.slice(0, 500) };
          }
        }
      } catch {
        /* ignore — body not readable */
      }
    }
  }

  await next();

  if (!shouldLog) return;
  const status = c.res.status;
  if (status < 200 || status >= 300) return;

  // TokenPayload type claims non-undefined but public routes won't have it set
  const user = c.get("user" as never) as { userId?: string } | undefined;
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    null;

  try {
    await db.insert(auditLogs).values({
      actorId:    user?.userId ?? null,
      action:     `${method} ${path}`,
      tableName:  tableFromPath(path),
      recordId:   recordIdFromPath(path),
      beforeData: null,
      afterData:  body ? (redact(body) as object) : null,
      ipAddress:  ip,
    });
  } catch (err) {
    console.error("[audit] failed to write log:", err);
  }
});
