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

/** Reply with text + quick reply buttons (max 13 buttons) */
export async function replyTextWithQuickReplies(
  replyToken: string,
  text: string,
  buttons: Array<{ label: string; text: string }>,
): Promise<void> {
  await postJson("/message/reply", {
    replyToken,
    messages: [{
      type: "text",
      text: text.slice(0, 4800),
      quickReply: {
        items: buttons.slice(0, 13).map((b) => ({
          type: "action",
          action: { type: "message", label: b.label.slice(0, 20), text: b.text.slice(0, 300) },
        })),
      },
    }],
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

// ── LINE Bot 2-way Flex templates ─────────────────────────────────────────

/** Task list bubble — e.g. "งานวันนี้" response */
export function buildTaskListFlex(params: {
  headerText: string;
  tasks: Array<{
    display_id: string;
    title:      string;
    deadline?:  string | null;
    is_overdue: boolean;
    estimated_hours?: number | null;
  }>;
  maxTask?: number;
}): any {
  const { headerText, tasks, maxTask = 6 } = params;
  const shown = tasks.slice(0, maxTask);
  const taskContents: any[] = [];

  for (let i = 0; i < shown.length; i++) {
    const t = shown[i];
    const emoji = t.is_overdue ? "🔴" : t.deadline ? "⚠️" : "🟢";
    const deadlineText = t.is_overdue
      ? "เกินกำหนด"
      : t.deadline
        ? `⏰ ${t.deadline}`
        : "";
    const subtitle = deadlineText + (t.estimated_hours ? ` · ${t.estimated_hours} ชม.` : "");

    taskContents.push({
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      margin: i > 0 ? "md" : "none",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 1,
          contents: [
            { type: "text", text: `${emoji} [${t.display_id}] ${t.title}`, size: "sm", wrap: true, color: "#1F2937" },
            ...(subtitle ? [{ type: "text", text: subtitle, size: "xs", color: "#9CA3AF", margin: "xs" }] : []),
          ],
        },
        {
          type: "box",
          layout: "vertical",
          width: "50px",
          contents: [
            {
              type: "button",
              style: "primary",
              color: t.is_overdue ? "#EF4444" : "#10B981",
              height: "sm",
              action: { type: "postback", label: "✅", data: `done_${t.display_id}` },
            },
          ],
        },
      ],
    });
  }

  const bodyContents: any[] = [
    { type: "text", text: headerText, weight: "bold", size: "md", color: "#1F2937", wrap: true },
    { type: "separator", margin: "md" },
    ...taskContents,
  ];

  if (tasks.length > maxTask) {
    bodyContents.push({
      type: "text",
      text: `... และอีก ${tasks.length - maxTask} งาน`,
      size: "xs",
      color: "#9CA3AF",
      margin: "md",
      align: "center",
    });
  }

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "md",
      backgroundColor: "#FB7185",
      contents: [{ type: "text", text: "Xiqma", color: "#FFFFFF", size: "xs", weight: "bold" }],
    },
    body: { type: "box", layout: "vertical", paddingAll: "lg", contents: bodyContents },
  };
}

/** Task carousel bubble — e.g. "เลือกงานที่จะเริ่ม" */
export function buildTaskCarouselBubble(params: {
  task: {
    display_id: string;
    title:      string;
    deadline?:  string | null;
    is_overdue: boolean;
  };
}): any {
  const { task: t } = params;
  const emoji = t.is_overdue ? "🔴" : t.deadline ? "⚠️" : "🟢";
  return {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      contents: [
        { type: "text", text: `[${t.display_id}]`, size: "xs", color: "#9CA3AF" },
        { type: "text", text: `${emoji} ${t.title}`, size: "sm", weight: "bold", wrap: true, margin: "md" },
        ...(t.deadline
          ? [{ type: "text", text: `⏰ ${t.deadline}`, size: "xs", color: t.is_overdue ? "#EF4444" : "#6B7280", margin: "xs" }]
          : []),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#10B981",
          height: "sm",
          action: { type: "postback", label: "▶️ เริ่มงานนี้", data: `start_${t.display_id}` },
        },
      ],
    },
  };
}

/** Comprehensive help card — shows available commands per role */
export function buildHelpFlex(role?: string): any {
  const everyoneSection = {
    type: "box" as const, layout: "vertical" as const, margin: "md" as const,
    contents: [
      { type: "text" as const, text: "👤 สิ่งที่ทุกคนทำได้", weight: "bold" as const, size: "xs" as const, color: "#FB7185" },
      { type: "text" as const, text: "📋 ดูงาน — \"มีงานอะไรค้าง\" / \"งานเกินกำหนด\" / \"งานวันนี้\"\n✅ ปิดงาน — \"ปิด TK-001\" หรือ \"งาน logo เสร็จแล้ว\"\n▶️ จับเวลา — \"เริ่มงาน TK-001\" / \"เริ่ม\" / \"หยุด\"\n📊 ดูเวลา — \"วันนี้ทำไปกี่ชั่วโมง\"", size: "xs" as const, color: "#6B7280", wrap: true as const, margin: "sm" as const },
    ],
  };

  const managerSection = {
    type: "box" as const, layout: "vertical" as const, margin: "lg" as const,
    contents: [
      { type: "text" as const, text: "👥 หัวหน้าทำได้เพิ่ม", weight: "bold" as const, size: "xs" as const, color: "#10B981" },
      { type: "text" as const, text: "🔍 ดูงานลูกน้อง — \"Jane มีงานอะไรค้าง\"\n📊 ภาพรวมทีม — \"ทีมมีใครงานเยอะสุด\"\n📋 สรุป — \"Alice ทำงานอะไรเสร็จสัปดาห์นี้\"", size: "xs" as const, color: "#6B7280", wrap: true as const, margin: "sm" as const },
    ],
  };

  const adminSection = {
    type: "box" as const, layout: "vertical" as const, margin: "lg" as const,
    contents: [
      { type: "text" as const, text: "🛡️ Admin ดูได้ทั้งหมด", weight: "bold" as const, size: "xs" as const, color: "#8B5CF6" },
      { type: "text" as const, text: "🔍 ดูข้อมูลทุกคน — \"ใครงานเกินกำหนดเยอะสุด\"\n📊 ภาพรวมองค์กร — \"ภาพรวมงานทั้งหมด\"", size: "xs" as const, color: "#6B7280", wrap: true as const, margin: "sm" as const },
    ],
  };

  const bodyContents: any[] = [
    { type: "text", text: "🤖 ถามอะไรก็ได้ด้วยภาษาคน!", weight: "bold", size: "sm", wrap: true, color: "#1F2937" },
    { type: "separator", margin: "md" },
    everyoneSection,
  ];
  if (!role || role === "manager" || role === "admin") bodyContents.push(managerSection);
  if (!role || role === "admin") bodyContents.push(adminSection);

  return {
    type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", paddingAll: "md", backgroundColor: "#8B5CF6",
      contents: [{ type: "text", text: "🤖 Xiqma — วิธีใช้", color: "#FFFFFF", size: "sm", weight: "bold" }],
    },
    body: { type: "box", layout: "vertical", paddingAll: "lg", spacing: "none", contents: bodyContents },
  };
}

/** Confirmation bubble — e.g. after marking task done */
export function buildConfirmBubble(params: { emoji: string; message: string }): any {
  return {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "lg",
      contents: [
        { type: "text", text: params.emoji, size: "xl", align: "center" },
        { type: "text", text: params.message, size: "sm", color: "#1F2937", wrap: true, margin: "md", align: "center" },
      ],
    },
  };
}
