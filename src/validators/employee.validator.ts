import { z } from "zod";

export const createEmployeeSchema = z.object({
  employeeCode:       z.string().min(1, "กรุณากรอกรหัสพนักงาน"),
  name:               z.string().min(1, "กรุณากรอกชื่อ"),
  email:              z.string().email("Email ไม่ถูกต้อง").optional(),
  password:           z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"),
  role:               z.enum(["employee", "manager", "hr", "admin"]).default("employee"),
  roleId:             z.string().uuid().optional(),
  positionId:         z.string().uuid().optional(),
  managerId:          z.string().uuid().optional(),
  department:         z.string().optional(),
  leaveQuotaAnnual:   z.number().int().min(0).default(10),
  leaveQuotaSick:     z.number().int().min(0).default(30),
  leaveQuotaPersonal: z.number().int().min(0).default(3),
});

export const updateEmployeeSchema = z.object({
  name:       z.string().min(1).optional(),
  email:      z.string().email().optional(),
  roleId:     z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  managerId:  z.string().uuid().optional(),
  department: z.string().optional(),
  isActive:   z.boolean().optional(),
});

export const listEmployeesSchema = z.object({
  search:     z.string().optional(),
  department: z.string().optional(),
  isActive:   z.coerce.boolean().default(true),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ListEmployeesInput  = z.infer<typeof listEmployeesSchema>;
