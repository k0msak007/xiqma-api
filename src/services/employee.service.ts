import { employeeRepository } from "@/repositories/employee.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import { db } from "@/lib/db.ts";
import { sql } from "drizzle-orm";
import { supabase, AVATARS_BUCKET } from "@/lib/supabase.ts";
import type { CreateEmployeeInput, UpdateEmployeeInput, ListEmployeesInput, ChangePasswordInput } from "@/validators/employee.validator.ts";

export const employeeService = {
  async list(params: ListEmployeesInput & { managerUserId?: string }) {
    return employeeRepository.findAll(params);
  },

  async findById(id: string) {
    const employee = await employeeRepository.findById(id);
    if (!employee) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${id}`, 404);
    }
    return employee;
  },

  async create(data: CreateEmployeeInput) {
    const existing = await employeeRepository.findByEmployeeCode(data.employeeCode);
    if (existing) {
      throw new AppError(
        ErrorCode.EMPLOYEE_CODE_EXISTS,
        `รหัสพนักงาน "${data.employeeCode}" ถูกใช้แล้ว`,
        409
      );
    }
    return employeeRepository.create(data);
  },

  async update(id: string, data: UpdateEmployeeInput) {
    const employee = await employeeRepository.findById(id);
    if (!employee) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${id}`, 404);
    }
    return employeeRepository.update(id, data);
  },

  async deactivate(id: string) {
    const employee = await employeeRepository.findById(id);
    if (!employee) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${id}`, 404);
    }

    // Last-admin protection: cannot deactivate the last active admin
    if (employee.role === "admin") {
      const activeAdminCount = await employeeRepository.countActiveAdmins();
      if (activeAdminCount <= 1) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          "ไม่สามารถปิดการใช้งาน admin คนสุดท้ายได้",
          403
        );
      }
    }

    return employeeRepository.deactivate(id);
  },

  async updateAvatar(id: string, file: File) {
    const employee = await employeeRepository.findById(id);
    if (!employee) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${id}`, 404);
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "อนุญาตเฉพาะไฟล์ JPEG, PNG, WebP เท่านั้น", 400);
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "ขนาดไฟล์ต้องไม่เกิน 5MB", 400);
    }

    const ext = file.name.split(".").pop();
    const fileName = `${id}/avatar.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const { error } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(fileName, buffer, { upsert: true, contentType: file.type });

    if (error) {
      throw new AppError(ErrorCode.UPLOAD_FAILED, `อัปโหลดไฟล์ล้มเหลว: ${error.message}`, 500);
    }

    const { data: urlData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(fileName);
    const avatarUrl = urlData.publicUrl;

    return employeeRepository.updateAvatar(id, avatarUrl);
  },

  async changePassword(userId: string, data: ChangePasswordInput) {
    const employee = await employeeRepository.findById(userId);
    if (!employee) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${userId}`, 404);
    }

    const isValid = await employeeRepository.verifyPassword(userId, data.currentPassword);
    if (!isValid) {
      throw new AppError(ErrorCode.WRONG_PASSWORD, "รหัสผ่านปัจจุบันไม่ถูกต้อง", 400);
    }

    const result = await db.execute<{ hash: string }>(sql`
      SELECT crypt(${data.newPassword}, gen_salt('bf')) AS hash
    `);
    const newPasswordHash = result[0]?.hash;
    
    if (!newPasswordHash) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "ไม่สามารถสร้างรหัสผ่านใหม่ได้", 500);
    }
    
    await employeeRepository.updatePassword(userId, newPasswordHash);
    return { success: true };
  },
};
