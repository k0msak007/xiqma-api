import { positionRepository } from "@/repositories/position.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { CreatePositionInput, UpdatePositionInput } from "@/validators/position.validator.ts";

export const positionService = {
  async list(department?: string) {
    return positionRepository.findAll(department);
  },

  async findById(id: string) {
    const position = await positionRepository.findById(id);
    if (!position) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบตำแหน่ง id: ${id}`, 404);
    }
    return position;
  },

  async create(data: CreatePositionInput) {
    return positionRepository.create(data);
  },

  async update(id: string, data: UpdatePositionInput) {
    const position = await positionRepository.findById(id);
    if (!position) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบตำแหน่ง id: ${id}`, 404);
    }
    return positionRepository.update(id, data);
  },

  async delete(id: string) {
    const position = await positionRepository.findById(id);
    if (!position) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบตำแหน่ง id: ${id}`, 404);
    }

    const activeCount = await positionRepository.countActiveEmployees(id);
    if (activeCount > 0) {
      throw new AppError(
        ErrorCode.POSITION_IN_USE,
        `ไม่สามารถลบตำแหน่งนี้ได้ เนื่องจากมีพนักงานอยู่ในตำแหน่งนี้ ${activeCount} คน`,
        409
      );
    }

    await positionRepository.setInactive(id);
  },
};
