import { workScheduleRepository } from "@/repositories/work-schedule.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { CreateWorkScheduleInput, UpdateWorkScheduleInput } from "@/validators/work-schedule.validator.ts";

export const workScheduleService = {
  async list() {
    return workScheduleRepository.findAll();
  },

  async findById(id: string) {
    const schedule = await workScheduleRepository.findById(id);
    if (!schedule) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ work schedule id: ${id}`, 404);
    }
    return schedule;
  },

  async create(data: CreateWorkScheduleInput) {
    // If setting as default, unset all others first
    if (data.isDefault) {
      await workScheduleRepository.unsetDefault();
    }
    return workScheduleRepository.create(data);
  },

  async update(id: string, data: UpdateWorkScheduleInput) {
    const schedule = await workScheduleRepository.findById(id);
    if (!schedule) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ work schedule id: ${id}`, 404);
    }

    // If setting as default, unset all others first
    if (data.isDefault) {
      await workScheduleRepository.unsetDefault();
    }

    return workScheduleRepository.update(id, data);
  },

  async delete(id: string) {
    const schedule = await workScheduleRepository.findById(id);
    if (!schedule) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ work schedule id: ${id}`, 404);
    }

    const usageCount = await workScheduleRepository.countUsage(id);
    if (usageCount > 0) {
      throw new AppError(
        ErrorCode.WORK_SCHEDULE_IN_USE,
        `ไม่สามารถลบ work schedule นี้ได้ เนื่องจากมีพนักงานใช้งานอยู่ ${usageCount} คน`,
        409
      );
    }

    await workScheduleRepository.delete(id);
  },
};
