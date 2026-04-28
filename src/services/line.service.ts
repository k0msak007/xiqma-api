import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { pushText, replyText } from "@/lib/line.ts";
import { logger } from "@/lib/logger.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// LINE account linking & status service
//   1. createLinkToken(employeeId)           → 6-digit token (TTL 10 min)
//   2. handleWebhookEvent(event)              → process LINE webhook events
//   3. getLinkStatus(employeeId)              → current state (linked / not)
//   4. unlinkAccount(employeeId)              → remove pairing
// ─────────────────────────────────────────────────────────────────────────────

function gen6DigitToken(): string {
  // 6 random digits, leading zeros OK
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export const lineService = {
  async createLinkToken(employeeId: string): Promise<{ token: string; expiresAt: string; botBasicId?: string }> {
    // Reuse if active token exists (within last 8 minutes), else create fresh
    const existingRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT token, expires_at::text FROM line_link_tokens
      WHERE employee_id = '${employeeId}'::uuid
        AND used_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `));
    const existing = (((existingRows as any).rows ?? existingRows) as any[])[0];
    if (existing) {
      return {
        token:       String(existing.token),
        expiresAt:   String(existing.expires_at),
        botBasicId:  process.env.LINE_BOT_BASIC_ID,
      };
    }

    // Generate unique token (retry up to 5x in case of collision)
    let token = "";
    for (let i = 0; i < 5; i++) {
      token = gen6DigitToken();
      try {
        const result = await db.execute<Record<string, unknown>>(sql.raw(`
          INSERT INTO line_link_tokens (token, employee_id)
          VALUES ('${token}', '${employeeId}'::uuid)
          RETURNING expires_at::text
        `));
        const r = (((result as any).rows ?? result) as any[])[0];
        return {
          token,
          expiresAt:  String(r.expires_at),
          botBasicId: process.env.LINE_BOT_BASIC_ID,
        };
      } catch (err: any) {
        if (i === 4) throw err;
        // collision — retry
      }
    }
    throw new AppError(ErrorCode.INTERNAL_ERROR, "ไม่สามารถสร้าง link token ได้", 500);
  },

  async getLinkStatus(employeeId: string): Promise<{
    linked:    boolean;
    lineUserId: string | null;
    verifiedAt: string | null;
  }> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT identifier, verified_at::text FROM user_channels
      WHERE employee_id = '${employeeId}'::uuid AND channel = 'line'
      LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    if (!r) return { linked: false, lineUserId: null, verifiedAt: null };
    return {
      linked:     !!r.verified_at,
      lineUserId: r.identifier ? String(r.identifier) : null,
      verifiedAt: r.verified_at ? String(r.verified_at) : null,
    };
  },

  async unlinkAccount(employeeId: string): Promise<void> {
    await db.execute(sql.raw(`
      DELETE FROM user_channels
      WHERE employee_id = '${employeeId}'::uuid AND channel = 'line'
    `));
  },

  /** Look up a user's LINE user_id (for dispatcher). */
  async getLineUserId(employeeId: string): Promise<string | null> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT identifier FROM user_channels
      WHERE employee_id = '${employeeId}'::uuid
        AND channel = 'line'
        AND verified_at IS NOT NULL
      LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r?.identifier ? String(r.identifier) : null;
  },

  /**
   * Process a single LINE webhook event.
   * - "follow"  → friendly welcome, ask user to send their 6-digit token
   * - "message" with 6-digit text → match token, link account, reply success
   * - "unfollow" → log only (LINE deletes our access automatically)
   */
  async handleWebhookEvent(event: any): Promise<void> {
    const lineUserId = event?.source?.userId as string | undefined;
    const replyToken = event?.replyToken as string | undefined;

    if (!lineUserId) return;

    if (event.type === "follow") {
      if (replyToken) {
        await replyText(
          replyToken,
          "👋 ยินดีต้อนรับสู่ Xiqma!\n\nเพื่อรับการแจ้งเตือนทาง LINE กรุณาเปิดเว็บแล้วไปที่ Settings → Notifications แล้ว copy รหัส 6 หลักมาส่งใน chat นี้",
        ).catch((err) => logger.error({ err }, "line.replyText follow failed"));
      }
      return;
    }

    if (event.type === "message" && event.message?.type === "text") {
      const text = String(event.message.text ?? "").trim();
      const match = text.match(/^\d{6}$/);
      if (!match) {
        if (replyToken) {
          await replyText(
            replyToken,
            "❓ กรุณาส่งรหัส 6 หลักจากหน้า Settings → Notifications เพื่อผูกบัญชี",
          ).catch(() => {});
        }
        return;
      }
      const token = match[0];

      // Look up token + mark used (transactional)
      const tokRows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT t.employee_id::text AS employee_id, e.name AS name
        FROM line_link_tokens t
        JOIN employees e ON e.id = t.employee_id
        WHERE t.token = '${token}'
          AND t.used_at IS NULL
          AND t.expires_at > NOW()
        LIMIT 1
      `));
      const tok = (((tokRows as any).rows ?? tokRows) as any[])[0];

      if (!tok) {
        if (replyToken) {
          await replyText(
            replyToken,
            "🚫 รหัสไม่ถูกต้องหรือหมดอายุ\nกรุณา generate รหัสใหม่ใน Xiqma แล้วลองอีกครั้ง (รหัสมีอายุ 10 นาที)",
          ).catch(() => {});
        }
        return;
      }

      const empId = String(tok.employee_id);
      const empName = String(tok.name ?? "");

      // Save line_user_id in user_channels (upsert)
      await db.execute(sql.raw(`
        INSERT INTO user_channels (employee_id, channel, identifier, verified_at)
        VALUES ('${empId}'::uuid, 'line', '${lineUserId.replace(/'/g, "''")}', NOW())
        ON CONFLICT (employee_id, channel) DO UPDATE
          SET identifier = EXCLUDED.identifier, verified_at = NOW()
      `));

      // Mark token used
      await db.execute(sql.raw(`
        UPDATE line_link_tokens SET used_at = NOW() WHERE token = '${token}'
      `));

      if (replyToken) {
        await replyText(
          replyToken,
          `✅ ผูกบัญชีสำเร็จ!\nสวัสดีคุณ ${empName} — จากนี้คุณจะได้รับการแจ้งเตือนของ Xiqma ทาง LINE 🎉`,
        ).catch(() => {});
      }
      return;
    }

    // unfollow / other events: noop
  },

  /** Send a quick test message — used in Settings UI to verify pairing. */
  async sendTestMessage(employeeId: string): Promise<void> {
    const lineUserId = await this.getLineUserId(employeeId);
    if (!lineUserId) {
      throw new AppError(ErrorCode.NOT_FOUND, "ยังไม่ได้ผูกบัญชี LINE", 404);
    }
    await pushText(
      lineUserId,
      "🔔 นี่คือข้อความทดสอบจาก Xiqma\nหากคุณเห็นข้อความนี้ การตั้งค่า LINE ทำงานเรียบร้อย ✅",
    );
  },
};
