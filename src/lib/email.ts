// ─────────────────────────────────────────────────────────────────────────────
// Email wrapper — uses Resend (https://resend.com) by default.
//
// Env:
//   RESEND_API_KEY        (required to send)
//   EMAIL_FROM            (e.g. "Xiqma <noreply@yourdomain.com>")
//   APP_BASE_URL          (used in CTA buttons)
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_API = "https://api.resend.com";

export interface SendEmailOptions {
  to:       string;
  subject:  string;
  html:     string;
  text?:    string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");

  const from = process.env.EMAIL_FROM ?? "Xiqma <noreply@xiqma.app>";

  const res = await fetch(`${RESEND_API}/emails`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to:      [opts.to],
      subject: opts.subject,
      html:    opts.html,
      ...(opts.text ? { text: opts.text } : {}),
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.log("email provider res", res.status, txt);
    throw new Error(`Resend ${res.status}: ${txt.slice(0, 500)}`);
  }
}

// Soft-Sunrise themed HTML notification template.
export function buildNotificationEmail(params: {
  title:        string;
  body?:        string | null;
  headerColor?: string;
  cta?:        { label: string; uri: string };
}): { html: string; text: string } {
  const { title, body, headerColor = "#FB7185", cta } = params;
  const safeTitle = escapeHtml(title);
  const safeBody  = body ? escapeHtml(body).replace(/\n/g, "<br>") : "";
  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>${safeTitle}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Sukhumvit Set','Noto Sans Thai',sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
        <tr><td style="padding:14px 20px;background:${headerColor};color:#fff;font-size:13px;font-weight:600;letter-spacing:0.5px;">XIQMA</td></tr>
        <tr><td style="padding:24px 24px 8px 24px;font-size:18px;font-weight:600;line-height:1.4;color:#111827;">${safeTitle}</td></tr>
        ${safeBody ? `<tr><td style="padding:0 24px 24px 24px;font-size:14px;line-height:1.6;color:#4b5563;">${safeBody}</td></tr>` : ""}
        ${cta ? `
        <tr><td style="padding:0 24px 24px 24px;">
          <a href="${escapeAttr(cta.uri)}" style="display:inline-block;background:${headerColor};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(cta.label)}</a>
        </td></tr>` : ""}
        <tr><td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">
          คุณได้รับอีเมลนี้เพราะตั้งค่าให้รับการแจ้งเตือนจาก Xiqma — แก้การตั้งค่าได้ที่ <a href="${escapeAttr(appBase())}/settings/notifications" style="color:#9ca3af;text-decoration:underline;">/settings/notifications</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = body ? `${title}\n\n${body}\n${cta ? `\n${cta.label}: ${cta.uri}` : ""}` : title;
  return { html, text };
}

function appBase(): string {
  return process.env.APP_BASE_URL ?? "https://xiqma.app";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
