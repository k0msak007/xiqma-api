import { spaceRepository } from "@/repositories/space.repository.ts";
import { employeeRepository } from "@/repositories/employee.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { CreateSpaceInput, UpdateSpaceInput, AddMembersInput } from "@/validators/space.validator.ts";

export const spaceService = {
  async list(userId: string, isAdmin: boolean) {
    return spaceRepository.findAll(userId, isAdmin);
  },

  async findById(id: string, userId: string, isAdmin: boolean) {
    const space = await spaceRepository.findById(id);
    if (!space) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ space id: ${id}`, 404);
    }
    if (!isAdmin) {
      const isMember = await spaceRepository.isMember(id, userId);
      if (!isMember) {
        throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่ได้เป็นสมาชิกของ space นี้", 403);
      }
    }
    return space;
  },

  async create(data: CreateSpaceInput, creatorId: string) {
    return spaceRepository.create(data, creatorId);
  },

  async update(id: string, data: UpdateSpaceInput, userId: string, isAdmin: boolean) {
    const space = await spaceRepository.findById(id);
    if (!space) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ space id: ${id}`, 404);
    }
    if (!isAdmin) {
      const isMember = await spaceRepository.isMember(id, userId);
      if (!isMember) {
        throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่ได้เป็นสมาชิกของ space นี้", 403);
      }
    }
    return spaceRepository.update(id, data);
  },

  async delete(id: string) {
    const space = await spaceRepository.findById(id);
    if (!space) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ space id: ${id}`, 404);
    }
    // Cascade delete: tasks → list_statuses → lists → folders → members → space
    await spaceRepository.delete(id);
  },

  async addMembers(spaceId: string, data: AddMembersInput) {
    const space = await spaceRepository.findById(spaceId);
    if (!space) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ space id: ${spaceId}`, 404);
    }
    // Validate all employee IDs exist and are active
    for (const eid of data.employeeIds) {
      const emp = await employeeRepository.findById(eid);
      if (!emp || !emp.isActive) {
        throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${eid} หรือพนักงานไม่ได้ active`, 404);
      }
    }
    await spaceRepository.addMembers(spaceId, data.employeeIds);
  },

  async removeMember(spaceId: string, employeeId: string) {
    const space = await spaceRepository.findById(spaceId);
    if (!space) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ space id: ${spaceId}`, 404);
    }
    await spaceRepository.removeMember(spaceId, employeeId);
  },
};
