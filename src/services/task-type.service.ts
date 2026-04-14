import { taskTypeRepository } from "@/repositories/task-type.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { CreateTaskTypeInput, UpdateTaskTypeInput } from "@/validators/task-type.validator.ts";

export const taskTypeService = {
  async list() {
    return taskTypeRepository.findAll();
  },

  async findById(id: string) {
    const taskType = await taskTypeRepository.findById(id);
    if (!taskType) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task type id: ${id}`, 404);
    }
    return taskType;
  },

  async create(data: CreateTaskTypeInput) {
    return taskTypeRepository.create(data);
  },

  async update(id: string, data: UpdateTaskTypeInput) {
    const taskType = await taskTypeRepository.findById(id);
    if (!taskType) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task type id: ${id}`, 404);
    }
    return taskTypeRepository.update(id, data);
  },

  async delete(id: string) {
    const taskType = await taskTypeRepository.findById(id);
    if (!taskType) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task type id: ${id}`, 404);
    }

    const usageCount = await taskTypeRepository.countUsage(id);
    if (usageCount > 0) {
      throw new AppError(
        ErrorCode.TASK_TYPE_IN_USE,
        `ไม่สามารถลบ task type นี้ได้ เนื่องจากมีงานใช้งานอยู่ ${usageCount} รายการ`,
        409
      );
    }

    await taskTypeRepository.delete(id);
  },
};
