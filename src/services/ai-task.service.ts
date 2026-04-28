import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { chatComplete, type ChatMessage } from "@/lib/openrouter.ts";
import type { ExtractedTaskDraft, ExtractTasksResult } from "@/validators/ai.validator.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Smart Task Creation from Notes
// 1. Build context: list + statuses + task_types + employees in scope
// 2. Ask LLM to extract tasks as strict JSON
// 3. Resolve raw names → IDs (fuzzy matching)
// 4. Return drafts (NO DB insert — caller will bulk-create after preview)
// ─────────────────────────────────────────────────────────────────────────────

interface ListContext {
  listId:       string;
  listName:     string;
  spaceId:      string;
  spaceName:    string | null;
}

interface EmployeeRow { id: string; name: string; code: string | null; role: string | null; }
interface TaskTypeRow { id: string; name: string; color: string | null; }

async function loadListContext(listId: string): Promise<ListContext> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT l.id, l.name, l.space_id, s.name AS space_name
    FROM lists l
    LEFT JOIN spaces s ON l.space_id = s.id
    WHERE l.id = '${listId}'::uuid
    LIMIT 1
  `));
  const r = ((rows as any).rows ?? rows)[0];
  if (!r) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ list", 404);
  return {
    listId:    String(r.id),
    listName:  String(r.name),
    spaceId:   String(r.space_id),
    spaceName: r.space_name ? String(r.space_name) : null,
  };
}

async function loadAssignableEmployees(): Promise<EmployeeRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT e.id::text, e.name, e.employee_code AS code, r.name AS role_name
    FROM employees e
    LEFT JOIN roles r ON e.role_id = r.id
    WHERE e.is_active = true
    ORDER BY e.name ASC
  `));
  const arr = (rows as any).rows ?? rows;
  return (arr as any[]).map((e) => ({
    id:   String(e.id),
    name: String(e.name),
    code: e.code ? String(e.code) : null,
    role: e.role_name ? String(e.role_name) : null,
  }));
}

async function loadTaskTypes(): Promise<TaskTypeRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT id::text, name, color FROM task_types ORDER BY name ASC
  `));
  const arr = (rows as any).rows ?? rows;
  return (arr as any[]).map((t) => ({
    id:    String(t.id),
    name:  String(t.name),
    color: t.color ? String(t.color) : null,
  }));
}

// ── Fuzzy matching: lowercase + strip + exact then substring ────────────────
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

function matchEmployee(rawName: string, employees: EmployeeRow[]): {
  emp: EmployeeRow | null;
  match: "exact" | "fuzzy" | "none";
} {
  if (!rawName?.trim()) return { emp: null, match: "none" };
  const target = normalize(rawName);

  // 1. Exact full-name match (case-insensitive, whitespace-stripped)
  const exact = employees.find((e) => normalize(e.name) === target);
  if (exact) return { emp: exact, match: "exact" };

  // 2. Employee code match
  const byCode = employees.find((e) => e.code && normalize(e.code) === target);
  if (byCode) return { emp: byCode, match: "exact" };

  // 3. Substring (raw is contained in name OR vice versa)
  const substr = employees.find(
    (e) => normalize(e.name).includes(target) || target.includes(normalize(e.name)),
  );
  if (substr) return { emp: substr, match: "fuzzy" };

  // 4. First-name only (split on whitespace)
  const firstNameTarget = rawName.split(/\s+/)[0];
  if (firstNameTarget) {
    const fnNorm = normalize(firstNameTarget);
    const byFirst = employees.find((e) => {
      const first = e.name.split(/\s+/)[0];
      return first ? normalize(first) === fnNorm : false;
    });
    if (byFirst) return { emp: byFirst, match: "fuzzy" };
  }

  return { emp: null, match: "none" };
}

function matchTaskType(rawName: string, types: TaskTypeRow[]): TaskTypeRow | null {
  if (!rawName?.trim()) return null;
  const target = normalize(rawName);
  const exact = types.find((t) => normalize(t.name) === target);
  if (exact) return exact;
  const substr = types.find(
    (t) => normalize(t.name).includes(target) || target.includes(normalize(t.name)),
  );
  return substr ?? null;
}

// ── Prompt builder ───────────────────────────────────────────────────────────
function buildExtractPrompt(params: {
  text:        string;
  list:        ListContext;
  employees:   EmployeeRow[];
  taskTypes:   TaskTypeRow[];
  language:    "th" | "en";
  todayIsoDate: string;
}): ChatMessage[] {
  const { text, list, employees, taskTypes, language, todayIsoDate } = params;

  const empList = employees
    .slice(0, 100)
    .map((e) => `- ${e.name}${e.code ? ` (${e.code})` : ""}${e.role ? ` · ${e.role}` : ""}`)
    .join("\n");

  const typeList = taskTypes.map((t) => `- ${t.name}`).join("\n") || "(ไม่มี)";

  const systemTh = `คุณเป็น AI ช่วยสร้าง task จากบันทึกประชุม/อีเมล/ข้อความใด ๆ ของหัวหน้า
หน้าที่: อ่านข้อความที่ผู้ใช้ส่งมา แล้วสกัด "งานที่ต้องทำ" ออกมาเป็นรายการ task

ข้อกำหนดสำคัญ:
- คืนผลเป็น **JSON เท่านั้น** ห้ามมี text/markdown ใด ๆ ก่อนหรือหลัง JSON
- ทุก task ต้องมี title สั้น กระชับ (≤ 80 ตัวอักษร)
- description: ใส่บริบท/เงื่อนไข เพิ่มเติม (อาจ null)
- assignee: ใส่ "ชื่อที่กล่าวถึงในข้อความ" — ระบบจะ match กับฐานข้อมูลเอง
- ถ้าผู้พูดไม่ระบุชื่อชัด ให้ใส่ null
- priority: low / normal / high / urgent (ค่า default = normal)
- date fields: ใช้รูปแบบ YYYY-MM-DD เท่านั้น
- วันนี้คือ ${todayIsoDate} (ใช้คำนวณคำพูดเชิงสัมพัทธ์ เช่น "พรุ่งนี้", "ศุกร์นี้", "สิ้นเดือน")
- dependsOnIndex: ถ้า task A ต้องเสร็จก่อน task B → ใน B ใส่ index ของ A (เริ่มที่ 0)
- reasoning: 1 ประโยคสั้น ๆ บอกว่าทำไมเลือกแบบนี้ (debug)

ใช้ taskType จากรายการที่ให้มาเท่านั้น (ตรงตามชื่อ) ถ้าไม่ตรงเลย ใส่ null`;

  const systemEn = systemTh.replace(/[ก-๙]+/g, ""); // fallback: simple

  const userTh = `## บริบท
- List: "${list.listName}"${list.spaceName ? ` (Space: ${list.spaceName})` : ""}
- วันที่อ้างอิง: ${todayIsoDate}

## พนักงานที่ assign ได้
${empList}

## Task types ที่มี
${typeList}

## ข้อความที่ต้องวิเคราะห์
\`\`\`
${text}
\`\`\`

## Output schema (JSON เท่านั้น)
{
  "drafts": [
    {
      "title": "string",
      "description": "string | null",
      "assignee": "string | null",
      "taskType": "string | null",
      "priority": "low|normal|high|urgent",
      "planStart": "YYYY-MM-DD | null",
      "durationDays": "number | null",
      "deadline": "YYYY-MM-DD | null",
      "dependsOnIndex": "number | null",
      "reasoning": "string | null"
    }
  ],
  "notes": "string | null"
}

ส่ง JSON เท่านั้น`;

  return [
    { role: "system", content: language === "th" ? systemTh : systemEn },
    { role: "user",   content: userTh },
  ];
}

// Try multiple strategies to extract a JSON object from LLM output.
// Free / reasoning models often wrap JSON in prose, code fences, or chain-of-thought.
function extractJsonObject(rawText: string): any {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("AI ไม่ได้ส่งข้อความใด ๆ กลับมา");
  }

  let text = rawText.trim();

  // Strategy 1: strip ```json ... ``` (or ```...```) fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }

  // Strategy 2: full text is already valid JSON
  try { return JSON.parse(text); } catch { /* fall through */ }

  // Strategy 3: find balanced { ... } block (largest match)
  // Walks through the string finding the outermost {...} that parses.
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch { /* fall through */ }

    // Strategy 4: trim trailing junk byte-by-byte
    for (let i = end; i > start; i--) {
      if (text[i] !== "}") continue;
      const sub = text.slice(start, i + 1);
      try { return JSON.parse(sub); } catch { /* keep trying */ }
    }
  }

  // Give up — surface diagnostic
  const preview = text.slice(0, 400).replace(/\s+/g, " ");
  throw new Error(
    `AI ไม่ได้ส่ง JSON กลับมา (preview: ${preview}${text.length > 400 ? "..." : ""})`,
  );
}

function safeParseDrafts(rawText: string): { drafts: any[]; notes?: string } {
  const parsed = extractJsonObject(rawText);
  // Some models put result under `result`, `response`, or `data`. Be lenient.
  const candidate =
    parsed?.drafts ? parsed :
    parsed?.result?.drafts ? parsed.result :
    parsed?.response?.drafts ? parsed.response :
    parsed?.data?.drafts ? parsed.data :
    null;
  if (!candidate || !Array.isArray(candidate.drafts)) {
    // If top-level is an array, treat that as drafts
    if (Array.isArray(parsed)) return { drafts: parsed };
    throw new Error("AI response ไม่มี field 'drafts' (array). Got keys: " + Object.keys(parsed ?? {}).join(", "));
  }
  return {
    drafts: candidate.drafts,
    notes:  typeof candidate.notes === "string" ? candidate.notes : undefined,
  };
}

// ─── Main service ────────────────────────────────────────────────────────────
export const aiTaskService = {
  async extractTasks(input: { text: string; listId: string; language: "th" | "en" }): Promise<ExtractTasksResult> {
    const list      = await loadListContext(input.listId);
    const employees = await loadAssignableEmployees();
    const taskTypes = await loadTaskTypes();

    const today = new Date();
    const todayIsoDate = today.toISOString().slice(0, 10);

    const messages = buildExtractPrompt({
      text:      input.text,
      list,
      employees,
      taskTypes,
      language:  input.language,
      todayIsoDate,
    });

    const ai = await chatComplete({
      messages,
      temperature:    0.2,
      maxTokens:      3000,
      responseFormat: "json_object", // hint for OpenAI-compatible providers
    });

    let rawDrafts: any[];
    let notes: string | undefined;
    try {
      const parsed = safeParseDrafts(ai.text);
      rawDrafts = parsed.drafts;
      notes     = parsed.notes;
    } catch (firstErr: any) {
      // One retry with stricter "JSON ONLY" instruction prepended
      const retryMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: ai.text },
        {
          role: "user",
          content:
            "ตอบกลับมาเป็น JSON object เท่านั้น (เริ่มด้วย { และจบด้วย }) — ห้ามมี markdown, ห้ามมี text นำหรือต่อท้าย, ห้ามมี code fence",
        },
      ];
      const retry = await chatComplete({
        messages:       retryMessages,
        temperature:    0,
        maxTokens:      3000,
        responseFormat: "json_object",
      });
      const parsed = safeParseDrafts(retry.text);
      rawDrafts = parsed.drafts;
      notes     = parsed.notes;
    }

    const drafts: ExtractedTaskDraft[] = rawDrafts.map((d: any) => {
      const rawAssignee = typeof d.assignee === "string" ? d.assignee : null;
      const rawTaskType = typeof d.taskType === "string" ? d.taskType : null;

      const empMatch  = rawAssignee ? matchEmployee(rawAssignee, employees) : { emp: null, match: "none" as const };
      const ttMatched = rawTaskType ? matchTaskType(rawTaskType, taskTypes)  : null;

      const allowedPriority = ["low", "normal", "high", "urgent"];
      const priority = allowedPriority.includes(d.priority) ? d.priority : "normal";

      return {
        title:          String(d.title ?? "").slice(0, 200),
        description:    typeof d.description === "string" ? d.description : null,
        rawAssignee,
        rawTaskType,
        priority,
        planStart:      typeof d.planStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.planStart) ? d.planStart : null,
        durationDays:   Number.isFinite(d.durationDays) && d.durationDays > 0 ? Math.floor(d.durationDays) : null,
        deadline:       typeof d.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.deadline) ? d.deadline : null,
        dependsOnIndex: Number.isInteger(d.dependsOnIndex) && d.dependsOnIndex >= 0 ? d.dependsOnIndex : null,
        reasoning:      typeof d.reasoning === "string" ? d.reasoning : null,

        assigneeId:    empMatch.emp?.id ?? null,
        assigneeName:  empMatch.emp?.name ?? null,
        assigneeMatch: empMatch.match,
        taskTypeId:    ttMatched?.id ?? null,
        taskTypeName:  ttMatched?.name ?? null,
      };
    }).filter((d: ExtractedTaskDraft) => d.title.trim().length > 0);

    return { drafts, notes, model: ai.model };
  },
};
