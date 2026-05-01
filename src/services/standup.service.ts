import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import {
  standupRepository,
  type StandupContext,
  type StandupRow,
  type StandupSettings,
} from "@/repositories/standup.repository.ts";
import { chatComplete, type ChatMessage } from "@/lib/openrouter.ts";
import { logger } from "@/lib/logger.ts";
import { emitNotification } from "@/lib/notification/dispatcher.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Daily Standup service
//   - generateForEmployee(empId, opts) — gather data → AI → save draft
//   - generateForAll(opts) — used by cron (skip those that already have today's row)
//   - getMine(empId) — return today's standup or generate on demand
//   - sendStandup(id, empId) — mark sent + notify in-app
//   - skipStandup / updateDraft
// ─────────────────────────────────────────────────────────────────────────────

const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
};

/** Strip chain-of-thought — keep only the actual standup starting from **📝 */
function extractStandup(raw: string): string {
  const match = raw.match(/(\*\*📝.+)$/s);
  return match ? match[1].trim() : raw.trim();
}

function buildPrompt(ctx: StandupContext): ChatMessage[] {
  // Trim data to what AI needs (avoid bloated prompts)
  const data = {
    employee:        ctx.employee.name,
    yesterdayDate:   ctx.yesterday.date,
    todayDate:       ctx.today.date,
    yesterday: {
      completedTasks:  ctx.yesterday.completedTasks.map((t) => ({
        id: t.displayId, title: t.title, hours: Math.round(t.minutes / 60 * 10) / 10,
      })),
      timeHoursTotal:  Math.round(ctx.yesterday.timeMinutes / 60 * 10) / 10,
      timeSessions:    ctx.yesterday.timeSessions,
      commentsLeft:    ctx.yesterday.commentsLeft,
      inProgressCount: ctx.yesterday.inProgressTasks.length,
    },
    today: {
      onLeave:      ctx.today.onLeave,
      plannedTasks: ctx.today.plannedTasks.slice(0, 6).map((t) => ({
        id: t.displayId, title: t.title, priority: t.priority, deadline: t.deadline,
      })),
    },
    blockers: {
      overdue:           ctx.blockers.overdueCount,
      pendingExtensions: ctx.blockers.pendingExtensions,
    },
  };

  const system = `คุณคือเลขาที่เขียน daily standup — ผู้ใช้เห็นทุกคำที่คุณพิมพ์

⚠️ กฎข้อ 0: ห้ามคิดในใจ ห้ามใช้ "ผู้ใช้ถาม" "ฉันจะ" "มาดูกัน" "ก่อนอื่น" "ดูข้อมูล" — ตอบผลลัพธ์ตรง ๆ

โครงสร้าง:
**📝 เมื่อวาน**
- bullet ของงานที่ปิด พร้อมจำนวนชั่วโมง ถ้ามี
- รวมเวลาทำงานทั้งวัน

**🎯 วันนี้**
- bullet ของงานที่วางแผน (เรียงตาม priority)
- ระบุ priority ถ้า high/urgent

**⚠️ ติดขัด**
- ถ้ามี overdue หรือ pending — ระบุ
- ถ้าไม่มี ให้เขียนว่า "ไม่มี"

**💬 หมายเหตุ**
- คำขอ/คำถาม/อื่น ๆ (ถ้าไม่มี ให้ข้ามส่วนนี้)

ข้อกำหนด:
- ภาษาไทยเท่านั้น
- ใช้ข้อมูลจริง อย่าเดา
- ถ้าข้อมูลว่าง ให้พูดตรง ๆ เช่น "เมื่อวานไม่ได้ปิดงาน"
- ความยาวรวมไม่เกิน 200 คำ`;

  const user = `กรุณาเขียน daily standup ของฉัน

\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

เขียนได้เลย ไม่ต้องอธิบายเพิ่ม ส่งผลลัพธ์เป็น text ปกติ (ห้ามใส่ markdown code block)`;

  return [
    { role: "system", content: system },
    { role: "user",   content: user },
  ];
}

export const standupService = {
  async getOrGenerateMine(employeeId: string): Promise<StandupRow & { context: StandupContext }> {
    const ctx = await standupRepository.buildContext(employeeId);
    const today = ctx.today.date;

    let row = await standupRepository.findByEmployeeAndDate(employeeId, today);
    if (!row) {
      // Delay background generation so it runs after response is sent
      setTimeout(() => {
        this.generateForEmployee(employeeId).catch((err) =>
          logger.error({ err, employeeId }, "background standup generation failed"),
        );
      }, 1000);
      // Return placeholder immediately
      row = await standupRepository.upsert({
        employeeId, date: today,
        draftText: "⏳ กำลังสร้างสรุปประจำวัน... ลอง刷新ใน 30 วิ",
        model: "pending",
      });
    }
    return { ...row, context: ctx };
  },

  async getPlaceholder(employeeId: string): Promise<StandupRow> {
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" })).toISOString().slice(0, 10);
    return await standupRepository.upsert({
      employeeId, date: today,
      draftText: "⏳ กำลังสร้างสรุปประจำวัน... ลอง刷新ใน 30 วิ",
      model: "pending",
    });
  },

  async generateForEmployee(employeeId: string): Promise<StandupRow> {
    const ctx = await standupRepository.buildContext(employeeId);
    const messages = buildPrompt(ctx);
    const ai = await chatComplete({ messages, temperature: 0.4, maxTokens: 3000 });

    const text = extractStandup(ai.text) || "ไม่สามารถสร้างได้ ลองใหม่อีกครั้ง";
    return await standupRepository.upsert({
      employeeId,
      date:      ctx.today.date,
      draftText: text,
      model:     ai.model,
    });
  },

  async generateForAll(opts?: { force?: boolean }): Promise<{ generated: number; skipped: number; failed: number; reason?: string }> {
    const settings = await standupRepository.getSettings();
    if (!settings.enabled && !opts?.force) {
      return { generated: 0, skipped: 0, failed: 0, reason: "standup disabled in settings" };
    }

    // Determine today's ISO weekday in Bangkok
    const bkkDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const jsDow   = bkkDate.getDay();          // 0=Sun..6=Sat
    const isoDow  = jsDow === 0 ? 7 : jsDow;   // 1=Mon..7=Sun

    if (!opts?.force && !settings.sendDays.includes(isoDow)) {
      return { generated: 0, skipped: 0, failed: 0, reason: `not in send_days (today ISO=${isoDow})` };
    }

    const employees = await standupRepository.listEligibleEmployees();
    let generated = 0, skipped = 0, failed = 0;

    for (const emp of employees) {
      try {
        // Per-employee work_days check (if respectWorkDays enabled)
        if (settings.respectWorkDays) {
          const wd = await standupRepository.getEmployeeWorkDays(emp.id);
          if (wd && !wd.includes(isoDow)) { skipped++; continue; }
        }

        const ctx = await standupRepository.buildContext(emp.id);
        const existing = await standupRepository.findByEmployeeAndDate(emp.id, ctx.today.date);
        if (existing) { skipped++; continue; }
        await this.generateForEmployee(emp.id);
        generated++;
      } catch (err) {
        console.error(`[standup.generate] ${emp.name} failed:`, err);
        failed++;
      }
    }
    return { generated, skipped, failed };
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings(): Promise<StandupSettings> {
    return standupRepository.getSettings();
  },

  updateSettings(s: Partial<StandupSettings>): Promise<StandupSettings> {
    // Validate
    if (s.sendTime !== undefined && !/^\d{2}:\d{2}(:\d{2})?$/.test(s.sendTime)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "sendTime ต้องเป็นรูปแบบ HH:MM", 400);
    }
    if (s.sendDays !== undefined) {
      const valid = s.sendDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
      if (!valid || s.sendDays.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "sendDays ต้องเป็น 1..7 อย่างน้อย 1 ค่า", 400);
      }
    }
    return standupRepository.updateSettings(s);
  },

  async updateDraft(id: string, employeeId: string, draftText: string): Promise<StandupRow> {
    const updated = await standupRepository.updateDraft(id, employeeId, draftText);
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ standup", 404);
    return updated;
  },

  async send(id: string, employeeId: string): Promise<StandupRow> {
    const updated = await standupRepository.setStatus(id, employeeId, "sent");
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ standup", 404);

    // 🔔 Notify the employee's manager + admins (audit-style; skip the actor)
    try {
      const empRows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT e.name, e.manager_id::text AS manager_id
        FROM employees e WHERE e.id = '${employeeId}'::uuid LIMIT 1
      `));
      const r = (((empRows as any).rows ?? empRows) as any[])[0];
      const recipients: string[] = [];
      if (r?.manager_id) recipients.push(String(r.manager_id));

      const adminRows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT e.id::text AS id FROM employees e
        LEFT JOIN roles ro ON e.role_id = ro.id
        WHERE e.is_active = true AND ro.name = 'admin'
      `));
      for (const a of ((adminRows as any).rows ?? adminRows) as any[]) {
        const aid = String(a.id);
        if (aid !== employeeId && !recipients.includes(aid)) recipients.push(aid);
      }

      if (recipients.length > 0) {
        emitNotification({
          type:        "daily_summary",
          recipients,
          actorId:     employeeId,
          title:       `${r?.name ?? "พนักงาน"} ส่ง standup ของวันนี้`,
          body:        updated.draftText.length > 200 ? updated.draftText.slice(0, 200) + "..." : updated.draftText,
          relatedType: null,
          relatedId:   null,
          deepLink:    "/standups",
        });
      }
    } catch (err) {
      console.error("[standup.send.notify] failed:", err);
    }

    return updated;
  },

  async skip(id: string, employeeId: string): Promise<StandupRow> {
    const updated = await standupRepository.setStatus(id, employeeId, "skipped");
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ standup", 404);
    return updated;
  },

  async listForTeam(callerUserId: string, callerRole: string, date: string): Promise<StandupRow[]> {
    return standupRepository.listForTeam(callerUserId, callerRole, date);
  },
};
