import ExcelJS from "exceljs";
import { reportsRepository, type EmployeeReportData } from "@/repositories/reports.repository.ts";
import { chatComplete } from "@/lib/openrouter.ts";

const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
};

export const employeeReportService = {
  getEmployeeReport(employeeId: string, from: string, to: string) {
    return reportsRepository.employeeReport(employeeId, from, to);
  },

  async exportEmployeeReportXlsx(employeeId: string, from: string, to: string): Promise<Buffer> {
    const data = await reportsRepository.employeeReport(employeeId, from, to);
    return await buildEmployeeXlsx(data);
  },

  // ── Team report (one click for everyone the caller can see) ────────────────
  async exportTeamReportXlsx(callerUserId: string, callerRole: string, from: string, to: string): Promise<Buffer> {
    const reports = await reportsRepository.getTeamReports(callerUserId, callerRole, from, to);
    return await buildTeamXlsx(reports, from, to);
  },

  async generateTeamAiSummary(params: {
    callerUserId: string;
    callerRole: string;
    from: string;
    to: string;
    language: "th" | "en";
    refresh: boolean;
  }): Promise<{ text: string; model: string; cached: boolean; memberCount: number }> {
    const { callerUserId, callerRole, from, to, language, refresh } = params;

    // Cache scope: keyed by caller (each manager has own team)
    if (!refresh) {
      const cached = await reportsRepository.findCachedSummary("team", callerUserId, from, to, language);
      if (cached) {
        return {
          text:        String(cached.summary_text),
          model:       String(cached.model),
          cached:      true,
          memberCount: 0, // unknown from cache row; UI doesn't depend on it
        };
      }
    } else {
      await reportsRepository.invalidateSummary("team", callerUserId, from, to);
    }

    const reports = await reportsRepository.getTeamReports(callerUserId, callerRole, from, to);
    if (reports.length === 0) {
      throw new Error("ไม่พบพนักงานในขอบเขตของคุณ");
    }
    const messages = buildTeamSummaryPrompt(reports, from, to, language);
    const result = await chatComplete({ messages, temperature: 0.4, maxTokens: 2000 });

    await reportsRepository.saveSummary({
      scopeType:   "team",
      scopeId:     callerUserId,
      from, to, language,
      model:       result.model,
      summaryText: result.text,
    });

    return { text: result.text, model: result.model, cached: false, memberCount: reports.length };
  },

  async generateEmployeeAiSummary(params: {
    employeeId: string;
    from: string;
    to: string;
    language: "th" | "en";
    refresh: boolean;
  }): Promise<{ text: string; model: string; cached: boolean }> {
    const { employeeId, from, to, language, refresh } = params;

    if (!refresh) {
      const cached = await reportsRepository.findCachedSummary("employee", employeeId, from, to, language);
      if (cached) {
        return {
          text:   String(cached.summary_text),
          model:  String(cached.model),
          cached: true,
        };
      }
    } else {
      await reportsRepository.invalidateSummary("employee", employeeId, from, to);
    }

    const data = await reportsRepository.employeeReport(employeeId, from, to);
    const messages = buildSummaryPrompt(data, language);
    const result = await chatComplete({ messages, temperature: 0.4, maxTokens: 1200 });

    await reportsRepository.saveSummary({
      scopeType:   "employee",
      scopeId:     employeeId,
      from, to, language,
      model:       result.model,
      summaryText: result.text,
    });

    return { text: result.text, model: result.model, cached: false };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Excel builder
// ─────────────────────────────────────────────────────────────────────────────
async function buildEmployeeXlsx(data: EmployeeReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Xiqma";
  wb.created = new Date();

  // Sheet 1 — Summary
  const s1 = wb.addWorksheet("สรุปผลงาน", { properties: { tabColor: { argb: "FFFB7185" } } });
  s1.columns = [
    { header: "หัวข้อ", key: "k", width: 32 },
    { header: "ค่า",   key: "v", width: 28 },
  ];
  s1.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  s1.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFB7185" } };

  const rows: Array<[string, string | number]> = [
    ["ชื่อพนักงาน",     data.employee.name],
    ["รหัสพนักงาน",     data.employee.code ?? "—"],
    ["ตำแหน่ง",         data.employee.role ?? "—"],
    ["ตารางทำงาน",      data.employee.workSchedule ?? "—"],
    ["ช่วงรายงาน",      `${data.range.from} ถึง ${data.range.to}`],
    ["", ""],
    ["งานทั้งหมด",       data.tasks.total],
    ["งานเสร็จ",         data.tasks.completed],
    ["กำลังดำเนินการ",   data.tasks.inProgress],
    ["เกินกำหนด",        data.tasks.overdue],
    ["ยกเลิก",           data.tasks.cancelled],
    ["เสร็จล่าช้า",      data.tasks.completedLate],
    ["ล่าช้าเฉลี่ย (วัน)", data.tasks.avgLateDays],
    ["On-time rate",     `${data.tasks.onTimeRate}%`],
    ["Story Points เสร็จ", data.tasks.storyPointsCompleted],
    ["จำนวนการตีกลับ (rework)", data.tasks.reworkTotal],
    ["", ""],
    ["เวลาทำงานรวม",     fmtMin(data.time.totalMinutes)],
    ["จำนวน sessions",   data.time.sessions],
  ];
  rows.forEach(([k, v]) => s1.addRow({ k, v }));
  s1.getColumn(1).font = { bold: true };

  // Sheet 2 — Time per day
  const s2 = wb.addWorksheet("เวลาทำงานรายวัน");
  s2.columns = [
    { header: "วันที่",      key: "day",     width: 16 },
    { header: "นาที",       key: "minutes", width: 12 },
    { header: "ชั่วโมง",    key: "hours",   width: 14 },
  ];
  s2.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  s2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF59E0B" } };
  data.time.perDay.forEach((d) => {
    s2.addRow({ day: d.day, minutes: d.minutes, hours: (d.minutes / 60).toFixed(2) });
  });

  // Sheet 3 — Top tasks
  const s3 = wb.addWorksheet("งานที่ใช้เวลามากที่สุด");
  s3.columns = [
    { header: "ID",           key: "displayId",   width: 14 },
    { header: "ชื่องาน",      key: "title",       width: 40 },
    { header: "สถานะ",        key: "statusName",  width: 14 },
    { header: "เวลาที่ใช้",   key: "duration",    width: 14 },
    { header: "Rework",       key: "reworkCount", width: 10 },
    { header: "เสร็จเมื่อ",   key: "completedAt", width: 22 },
  ];
  s3.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  s3.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF10B981" } };
  data.topTasks.forEach((t) => {
    s3.addRow({
      displayId:   t.displayId ?? "",
      title:       t.title,
      statusName:  t.statusName ?? "",
      duration:    fmtMin(t.durationMin),
      reworkCount: t.reworkCount,
      completedAt: t.completedAt ? new Date(t.completedAt).toLocaleString("th-TH") : "",
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Excel builder — overview sheet + per-employee sheets in one workbook
// ─────────────────────────────────────────────────────────────────────────────
async function buildTeamXlsx(reports: EmployeeReportData[], from: string, to: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Xiqma";
  wb.created = new Date();

  // Sheet 0 — Overview (all members compared)
  const ov = wb.addWorksheet("ภาพรวมทีม", { properties: { tabColor: { argb: "FFFB7185" } } });
  ov.columns = [
    { header: "พนักงาน",         key: "name",          width: 24 },
    { header: "รหัส",             key: "code",          width: 12 },
    { header: "งานทั้งหมด",        key: "total",         width: 12 },
    { header: "เสร็จ",             key: "completed",     width: 10 },
    { header: "ค้าง",              key: "inProgress",    width: 10 },
    { header: "เกินกำหนด",          key: "overdue",       width: 12 },
    { header: "ยกเลิก",             key: "cancelled",     width: 10 },
    { header: "เสร็จล่าช้า",        key: "completedLate", width: 12 },
    { header: "ล่าช้าเฉลี่ย (วัน)",  key: "avgLateDays",   width: 16 },
    { header: "On-time %",          key: "onTimeRate",    width: 12 },
    { header: "Story Points",       key: "sp",            width: 14 },
    { header: "Rework",             key: "rework",        width: 10 },
    { header: "เวลารวม",            key: "hours",         width: 14 },
  ];
  ov.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ov.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFB7185" } };
  ov.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  // Header range / title row
  ov.spliceRows(1, 0, []);
  ov.mergeCells("A1:M1");
  ov.getCell("A1").value = `รายงานทีม · ${from} ถึง ${to} · สมาชิก ${reports.length} คน`;
  ov.getCell("A1").font = { bold: true, size: 13 };
  ov.getCell("A1").alignment = { horizontal: "center" };

  reports.forEach((r) => {
    ov.addRow({
      name:          r.employee.name,
      code:          r.employee.code ?? "",
      total:         r.tasks.total,
      completed:     r.tasks.completed,
      inProgress:    r.tasks.inProgress,
      overdue:       r.tasks.overdue,
      cancelled:     r.tasks.cancelled,
      completedLate: r.tasks.completedLate,
      avgLateDays:   r.tasks.avgLateDays,
      onTimeRate:    `${r.tasks.onTimeRate}%`,
      sp:            r.tasks.storyPointsCompleted,
      rework:        r.tasks.reworkTotal,
      hours:         (r.time.totalMinutes / 60).toFixed(2),
    });
  });

  // Team totals row
  const totals = reports.reduce(
    (acc, r) => ({
      total:         acc.total + r.tasks.total,
      completed:     acc.completed + r.tasks.completed,
      inProgress:    acc.inProgress + r.tasks.inProgress,
      overdue:       acc.overdue + r.tasks.overdue,
      cancelled:     acc.cancelled + r.tasks.cancelled,
      completedLate: acc.completedLate + r.tasks.completedLate,
      sp:            acc.sp + r.tasks.storyPointsCompleted,
      rework:        acc.rework + r.tasks.reworkTotal,
      minutes:       acc.minutes + r.time.totalMinutes,
    }),
    { total: 0, completed: 0, inProgress: 0, overdue: 0, cancelled: 0, completedLate: 0, sp: 0, rework: 0, minutes: 0 },
  );
  const teamOnTime = totals.completed > 0
    ? Math.round(((totals.completed - totals.completedLate) / totals.completed) * 100)
    : 0;
  const totalRow = ov.addRow({
    name:          "รวมทีม",
    code:          "",
    total:         totals.total,
    completed:     totals.completed,
    inProgress:    totals.inProgress,
    overdue:       totals.overdue,
    cancelled:     totals.cancelled,
    completedLate: totals.completedLate,
    avgLateDays:   "—",
    onTimeRate:    `${teamOnTime}%`,
    sp:            totals.sp,
    rework:        totals.rework,
    hours:         (totals.minutes / 60).toFixed(2),
  });
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE7E2" } };

  // Per-employee sheets
  for (const r of reports) {
    const sheetName = (r.employee.code ?? r.employee.name).slice(0, 28);
    const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: "FFFCD34D" } } });
    ws.columns = [
      { header: "หัวข้อ", key: "k", width: 26 },
      { header: "ค่า",   key: "v", width: 24 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFB7185" } };

    const fmtMinLocal = (m: number) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return h > 0 ? `${h}h ${min}m` : `${min}m`;
    };
    const rows: Array<[string, string | number]> = [
      ["ชื่อ", r.employee.name],
      ["รหัส", r.employee.code ?? "—"],
      ["ตำแหน่ง", r.employee.role ?? "—"],
      ["", ""],
      ["งานทั้งหมด", r.tasks.total],
      ["งานเสร็จ", r.tasks.completed],
      ["กำลังทำ", r.tasks.inProgress],
      ["เกินกำหนด", r.tasks.overdue],
      ["เสร็จล่าช้า", r.tasks.completedLate],
      ["On-time", `${r.tasks.onTimeRate}%`],
      ["Story Points", r.tasks.storyPointsCompleted],
      ["Rework", r.tasks.reworkTotal],
      ["", ""],
      ["เวลารวม", fmtMinLocal(r.time.totalMinutes)],
      ["จำนวน sessions", r.time.sessions],
    ];
    rows.forEach(([k, v]) => ws.addRow({ k, v }));
    ws.getColumn(1).font = { bold: true };

    if (r.topTasks.length > 0) {
      ws.addRow({});
      const topHeader = ws.addRow({ k: "งานที่ใช้เวลามากที่สุด", v: "" });
      topHeader.font = { bold: true, color: { argb: "FFFB7185" } };
      r.topTasks.slice(0, 5).forEach((t) => {
        ws.addRow({ k: `${t.displayId ?? ""} ${t.title}`, v: fmtMinLocal(t.durationMin) });
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// AI prompt builder
// ─────────────────────────────────────────────────────────────────────────────
function buildSummaryPrompt(data: EmployeeReportData, language: "th" | "en") {
  const dataJson = JSON.stringify({
    employee: data.employee.name,
    range:    data.range,
    tasks:    data.tasks,
    time: {
      totalHours:      Math.round(data.time.totalMinutes / 60 * 10) / 10,
      sessions:        data.time.sessions,
      activeDays:      data.time.perDay.length,
    },
    topTasks: data.topTasks.slice(0, 5).map((t) => ({
      title:       t.title,
      status:      t.statusName,
      hours:       Math.round(t.durationMin / 60 * 10) / 10,
      reworkCount: t.reworkCount,
      late:        t.completedAt && t.deadline
        ? new Date(t.completedAt) > new Date(t.deadline)
        : null,
    })),
  }, null, 2);

  const systemTh = `คุณเป็นที่ปรึกษาด้านการบริหารทีมในองค์กรไทย หน้าที่คือเขียนสรุปผลการทำงานของพนักงานให้หัวหน้าอ่านเข้าใจง่าย กระชับ ตรงประเด็น
- ใช้ภาษาไทยเป็นทางการแต่อ่านง่าย
- เน้นข้อมูลที่ actionable (สิ่งที่หัวหน้าควรทำ/พูดคุย)
- หลีกเลี่ยงการตัดสินคุณค่า แต่ชี้ pattern ที่น่าสนใจ
- ใช้ตัวเลขจริงประกอบ
- ถ้าข้อมูลน้อย/ไม่พอ ก็บอกตรงๆ ไม่ต้องเดา
- ความยาวประมาณ 4-6 ย่อหน้าสั้นๆ`;

  const systemEn = `You are a team performance advisor. Write a concise, actionable summary of an employee's work performance for their manager.
- Plain professional English, easy to scan
- Focus on actionable insights (what the manager should discuss or do)
- Avoid moral judgment, surface interesting patterns instead
- Cite real numbers
- If data is sparse, say so plainly — don't invent
- 4-6 short paragraphs`;

  const userTh = `กรุณาเขียนสรุปผลงานของพนักงานคนนี้ในช่วง ${data.range.from} ถึง ${data.range.to} ตามข้อมูลด้านล่าง

ข้อมูล:
\`\`\`json
${dataJson}
\`\`\`

โครงสร้างที่ต้องการ:
1. ภาพรวม (1-2 ประโยค)
2. จุดเด่น/สิ่งที่ทำได้ดี
3. ข้อสังเกต/ความเสี่ยง (เช่น rework สูง, ส่งช้า, workload ต่ำ)
4. คำแนะนำสำหรับหัวหน้า (1-2 ข้อปฏิบัติได้จริง)`;

  const userEn = `Summarize this employee's performance for ${data.range.from} to ${data.range.to}.

Data:
\`\`\`json
${dataJson}
\`\`\`

Structure:
1. Overview (1-2 sentences)
2. Highlights / what went well
3. Observations / risks (e.g. high rework, late delivery, low workload)
4. Manager recommendations (1-2 actionable items)`;

  const messages: import("@/lib/openrouter.ts").ChatMessage[] = [
    { role: "system", content: language === "th" ? systemTh : systemEn },
    { role: "user",   content: language === "th" ? userTh   : userEn },
  ];
  return messages;
}

function buildTeamSummaryPrompt(
  reports: EmployeeReportData[],
  from: string,
  to: string,
  language: "th" | "en",
) {
  // Compact dataset — one row per member
  const members = reports.map((r) => ({
    name:          r.employee.name,
    role:          r.employee.role,
    total:         r.tasks.total,
    completed:     r.tasks.completed,
    inProgress:    r.tasks.inProgress,
    overdue:       r.tasks.overdue,
    completedLate: r.tasks.completedLate,
    avgLateDays:   r.tasks.avgLateDays,
    onTimeRate:    r.tasks.onTimeRate,
    rework:        r.tasks.reworkTotal,
    sp:            r.tasks.storyPointsCompleted,
    hours:         Math.round(r.time.totalMinutes / 60 * 10) / 10,
  }));

  // Team totals
  const totals = reports.reduce(
    (acc, r) => ({
      total:     acc.total + r.tasks.total,
      completed: acc.completed + r.tasks.completed,
      overdue:   acc.overdue + r.tasks.overdue,
      late:      acc.late + r.tasks.completedLate,
      rework:    acc.rework + r.tasks.reworkTotal,
      hours:     acc.hours + r.time.totalMinutes / 60,
    }),
    { total: 0, completed: 0, overdue: 0, late: 0, rework: 0, hours: 0 },
  );
  const teamOnTime = totals.completed > 0
    ? Math.round(((totals.completed - totals.late) / totals.completed) * 100)
    : 0;

  const dataJson = JSON.stringify({
    range:     { from, to },
    teamSize:  reports.length,
    teamTotals: {
      tasks:        totals.total,
      completed:    totals.completed,
      overdue:      totals.overdue,
      completedLate: totals.late,
      reworkTotal:  totals.rework,
      hoursTotal:   Math.round(totals.hours * 10) / 10,
      onTimeRate:   teamOnTime,
    },
    members,
  }, null, 2);

  const systemTh = `คุณเป็นที่ปรึกษาด้านการบริหารทีมในองค์กรไทย หน้าที่คือเขียนสรุปผลการทำงานของ "ทีม" ให้หัวหน้า/ผู้บริหารอ่านเข้าใจง่าย กระชับ ตรงประเด็น
- ภาษาไทยทางการแต่อ่านลื่น
- เน้น insight ที่ actionable (ผู้บริหารจะตัดสินใจอะไรได้บ้าง)
- เปรียบเทียบสมาชิกได้แต่หลีกเลี่ยง "ตัดสิน" ใช้คำว่า "สังเกต" / "อาจ" แทน
- ใช้ตัวเลขจริงประกอบ
- ถ้ามีคนที่ stand out (ดีหรือต้องสนใจ) ระบุชื่อชัด ๆ
- ถ้าทีมเล็ก หรือข้อมูลน้อย ก็พูดตรง ๆ ไม่ต้องเดา`;

  const systemEn = `You are a team performance advisor. Write a concise, actionable team-level summary for the manager/exec.
- Plain professional English
- Highlight actionable insights, not just numbers
- Comparisons OK but avoid moral judgment ("notice" / "may" rather than "is bad at")
- Cite real numbers
- Name standout members (positive or concerning) explicitly
- If team is small/data sparse, say so plainly`;

  const userTh = `กรุณาเขียนสรุปผลงาน "ทีม" ในช่วง ${from} ถึง ${to} (${reports.length} คน) ตามข้อมูลด้านล่าง

ข้อมูล:
\`\`\`json
${dataJson}
\`\`\`

โครงสร้างที่ต้องการ:
1. **ภาพรวมทีม** (1-2 ประโยค: ทีมทำได้ดีระดับไหน on-time rate กี่ %)
2. **ผู้ที่โดดเด่น** (highlight 1-2 คนที่ผลงานดี + 1-2 คนที่อาจต้องพูดคุย — ระบุชื่อชัด ๆ)
3. **Pattern / ความเสี่ยง** (เช่น rework สูงในงานประเภทไหน, workload ไม่สมดุล, on-time rate ลดลง)
4. **คำแนะนำ** (2-3 ข้อปฏิบัติได้สำหรับสัปดาห์/เดือนถัดไป)

ความยาวรวมประมาณ 6-10 ย่อหน้าสั้น ๆ ใช้ bullet ได้ในข้อ 2-4`;

  const userEn = `Write a team-level performance summary for ${from} to ${to} (${reports.length} members).

Data:
\`\`\`json
${dataJson}
\`\`\`

Structure:
1. **Team overview** (1-2 sentences with on-time rate)
2. **Standouts** (1-2 strong + 1-2 to discuss — name them)
3. **Patterns / risks** (rework hotspots, workload balance, trends)
4. **Recommendations** (2-3 actionable items for next week/month)

Use bullets in 2-4. ~6-10 short paragraphs total.`;

  const messages: import("@/lib/openrouter.ts").ChatMessage[] = [
    { role: "system", content: language === "th" ? systemTh : systemEn },
    { role: "user",   content: language === "th" ? userTh   : userEn },
  ];
  return messages;
}
