import { z } from "zod";

// ─── POST /ai/tasks/extract — body ───────────────────────────────────────────
export const extractTasksBodySchema = z.object({
  text:     z.string().min(10, "ข้อความสั้นเกินไป (ต้องอย่างน้อย 10 ตัวอักษร)").max(20000, "ข้อความยาวเกินไป"),
  listId:   z.string().uuid(),
  language: z.enum(["th", "en"]).optional().default("th"),
});
export type ExtractTasksInput = z.infer<typeof extractTasksBodySchema>;

// ─── Output shape returned to client ─────────────────────────────────────────
export interface ExtractedTaskDraft {
  // ที่ AI generate (raw)
  title:           string;
  description?:    string | null;
  rawAssignee?:    string | null;     // ชื่อที่ AI เขียน (สำหรับโชว์ให้ user เห็น)
  rawTaskType?:    string | null;
  priority?:       "low" | "normal" | "high" | "urgent";
  planStart?:      string | null;     // YYYY-MM-DD
  durationDays?:   number | null;
  deadline?:       string | null;     // YYYY-MM-DD
  dependsOnIndex?: number | null;     // index ใน drafts array
  reasoning?:      string | null;     // เหตุผลที่ AI เลือก (debug aid)

  // ที่ service resolve ให้ (matched ตอน server-side)
  assigneeId?:     string | null;
  assigneeName?:   string | null;     // ชื่อจริงในระบบ
  assigneeMatch:   "exact" | "fuzzy" | "none";
  taskTypeId?:     string | null;
  taskTypeName?:   string | null;
}

export interface ExtractTasksResult {
  drafts: ExtractedTaskDraft[];
  notes?: string;
  model:  string;
}
