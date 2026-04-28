import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ใช้รูปแบบ YYYY-MM-DD");

export const employeeReportQuerySchema = z.object({
  from: dateStr,
  to:   dateStr,
});
export type EmployeeReportQuery = z.infer<typeof employeeReportQuerySchema>;

export const exportReportQuerySchema = z.object({
  from:   dateStr,
  to:     dateStr,
  format: z.enum(["xlsx"]).optional().default("xlsx"),
});

export const aiSummaryBodySchema = z.object({
  from:     dateStr,
  to:       dateStr,
  language: z.enum(["th", "en"]).optional().default("th"),
  refresh:  z.boolean().optional().default(false),
});
export type AiSummaryBody = z.infer<typeof aiSummaryBodySchema>;
