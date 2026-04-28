import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// LINE Messaging API wrapper (minimal)
//   - verifySignature(rawBody, headerSig)  — HMAC-SHA256 with channel secret
//   - pushText(toUserId, text)
//   - pushFlex(toUserId, altText, contents)
//   - replyText(replyToken, text)
//
// Env:
//   LINE_CHANNEL_ACCESS_TOKEN   (required)
//   LINE_CHANNEL_SECRET         (required for webhook verify)
//   LINE_BOT_BASIC_ID           (optional, for QR/link helper, e.g. "@xiqma")
// ─────────────────────────────────────────────────────────────────────────────

const LINE_API = "https://api.line.me/v2/bot";

function token(): string {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  return t;
}

export function verifySignature(rawBody: string, headerSig: string | null | undefined): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return false;
  if (!headerSig) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  // Constant-time compare
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerSig));
  } catch {
    return false;
  }
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${LINE_API}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`LINE ${path} ${res.status}: ${txt.slice(0, 500)}`);
  }
  try { return await res.json(); } catch { return {}; }
}

export async function pushText(toLineUserId: string, text: string): Promise<void> {
  // LINE text limit ~5,000 chars. Truncate to be safe.
  const safe = text.length > 4900 ? text.slice(0, 4900) + "..." : text;
  await postJson("/message/push", {
    to:       toLineUserId,
    messages: [{ type: "text", text: safe }],
  });
}

export interface FlexPushOptions {
  /** Short text for push notifications (max 400 chars) */
  altText: string;
  /** Flex Message contents — see https://developers.line.biz/flex-simulator/ */
  contents: any;
}

export async function pushFlex(toLineUserId: string, opts: FlexPushOptions): Promise<void> {
  const altText = opts.altText.length > 380 ? opts.altText.slice(0, 380) + "..." : opts.altText;
  await postJson("/message/push", {
    to:       toLineUserId,
    messages: [{ type: "flex", altText, contents: opts.contents }],
  });
}

export async function replyText(replyToken: string, text: string): Promise<void> {
  await postJson("/message/reply", {
    replyToken,
    messages: [{ type: "text", text: text.slice(0, 4900) }],
  });
}

// ── Flex Message templates ─────────────────────────────────────────────────────

/**
 * A clean notification card with header color, title, body, and a CTA.
 * Used for all in-app notifications mirrored to LINE.
 */
export function buildNotificationFlex(params: {
  title:     string;
  body?:     string | null;
  headerColor?: string; // hex
  cta?: { label: string; uri: string };
}): any {
  const { title, body, headerColor = "#FB7185", cta } = params;
  const bodyContents: any[] = [
    {
      type: "text",
      text: title,
      weight: "bold",
      size: "md",
      color: "#1F2937",
      wrap: true,
    },
  ];
  if (body) {
    bodyContents.push({
      type: "text",
      text: body,
      size: "sm",
      color: "#6B7280",
      wrap: true,
      margin: "md",
      maxLines: 6,
    });
  }
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "md",
      backgroundColor: headerColor,
      contents: [
        { type: "text", text: "Xiqma", color: "#FFFFFF", size: "xs", weight: "bold" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      contents: bodyContents,
    },
    ...(cta
      ? {
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                color: headerColor,
                height: "sm",
                action: {
                  type:  "uri",
                  label: cta.label.slice(0, 20),
                  uri:   cta.uri,
                },
              },
            ],
          },
        }
      : {}),
  };
}
