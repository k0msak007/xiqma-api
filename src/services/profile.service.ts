import { eq, and, ne } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { employees } from "@/db/schema/employees.schema.ts";
import { employeeService } from "@/services/employee.service.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { UpdateProfileInput } from "@/validators/profile.validator.ts";

export const profileService = {
  async getMe(userId: string) {
    return employeeService.findById(userId);
  },

  async updateMe(userId: string, data: UpdateProfileInput) {
    if (data.email) {
      const existing = await db.query.employees.findFirst({
        where: and(eq(employees.email, data.email), ne(employees.id, userId)),
      });
      if (existing) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Email "${data.email}" ถูกใช้แล้ว`, 409);
      }
    }

    const [updated] = await db
      .update(employees)
      .set({
        ...(data.name  !== undefined && { name:  data.name }),
        ...(data.email !== undefined && { email: data.email }),
        updatedAt: new Date(),
      })
      .where(eq(employees.id, userId))
      .returning();

    if (!updated) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${userId}`, 404);
    }
    return updated;
  },
};
