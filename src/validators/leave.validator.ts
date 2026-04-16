import { z } from "zod";

// ── Leave Request Validators ──────────────────────────────────────────────────

export const createLeaveRequestSchema = z.object({
  leaveType: z.enum(["annual", "sick", "personal", "maternity", "ordain", "unpaid"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().optional(),
  medicalCertificateUrl: z.string().url().optional(),
});

export const approveLeaveRequestSchema = z.object({});

export const rejectLeaveRequestSchema = z.object({
  rejectReason: z.string().min(1),
});

export const cancelLeaveRequestSchema = z.object({});

export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;
export type ApproveLeaveRequestInput = z.infer<typeof approveLeaveRequestSchema>;
export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>;
export type CancelLeaveRequestInput = z.infer<typeof cancelLeaveRequestSchema>;

// ── Leave Quota Validators ─────────────────────────────────────────────────────

export const updateLeaveQuotaSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  leaveType: z.enum(["annual", "sick", "personal", "maternity", "ordain", "unpaid"]),
  quotaDays: z.number().int().min(0),
});

export type UpdateLeaveQuotaInput = z.infer<typeof updateLeaveQuotaSchema>;

// ── Attendance Validators ──────────────────────────────────────────────────────

export const checkInSchema = z.object({});

export const checkOutSchema = z.object({});

export type CheckInInput = z.infer<typeof checkInSchema>;
export type CheckOutInput = z.infer<typeof checkOutSchema>;