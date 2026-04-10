import { z } from "zod";

export const loginSchema = z.object({
  email:    z.string().email("Email ไม่ถูกต้อง"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "กรุณาส่ง refresh token"),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, "กรุณาส่ง refresh token"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
    newPassword:     z.string().min(8, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export type LoginInput          = z.infer<typeof loginSchema>;
export type RefreshInput        = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
