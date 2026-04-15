import { listRepository } from "@/repositories/list.repository.ts";
import { spaceRepository } from "@/repositories/space.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type {
  CreateListInput, UpdateListInput,
  CreateStatusInput, UpdateStatusInput, ReorderStatusInput
} from "@/validators/list.validator.ts";

export const listService = {
  async list(spaceId: string, folderId: string | undefined, userId: string, isAdmin: boolean) {
    if (!isAdmin) {
      const isMember = await spaceRepository.isMember(spaceId, userId);
      if (!isMember) {
        throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่ได้เป็นสมาชิกของ space นี้", 403);
      }
    }
    return listRepository.findAll(spaceId, folderId);
  },

  async create(data: CreateListInput, userId: string, isAdmin: boolean) {
    const space = await spaceRepository.findById(data.spaceId);
    if (!space) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ space id: ${data.spaceId}`, 404);
    }
    if (!isAdmin) {
      const isMember = await spaceRepository.isMember(data.spaceId, userId);
      if (!isMember) {
        throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่ได้เป็นสมาชิกของ space นี้", 403);
      }
    }
    return listRepository.create(data);
  },

  async update(id: string, data: UpdateListInput) {
    const list = await listRepository.findById(id);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${id}`, 404);
    }
    return listRepository.update(id, data);
  },

  async delete(id: string) {
    const list = await listRepository.findById(id);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${id}`, 404);
    }
    // Cascade: soft-delete tasks → delete list_statuses → delete list
    await listRepository.delete(id);
  },

  // ── Statuses ──
  async listStatuses(listId: string) {
    const list = await listRepository.findById(listId);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${listId}`, 404);
    }
    return listRepository.findStatuses(listId);
  },

  async createStatus(listId: string, data: CreateStatusInput) {
    const list = await listRepository.findById(listId);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${listId}`, 404);
    }
    return listRepository.createStatus(listId, data);
  },

  async updateStatus(listId: string, statusId: string, data: UpdateStatusInput) {
    const status = await listRepository.findStatusById(statusId);
    if (!status || status.listId !== listId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ status id: ${statusId} ใน list นี้`, 404);
    }
    return listRepository.updateStatus(statusId, data);
  },

  async deleteStatus(listId: string, statusId: string) {
    const status = await listRepository.findStatusById(statusId);
    if (!status || status.listId !== listId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ status id: ${statusId} ใน list นี้`, 404);
    }
    const inUse = await listRepository.countTasksInStatus(statusId);
    if (inUse > 0) {
      throw new AppError(ErrorCode.STATUS_IN_USE, "ยังมี task ที่ใช้ status นี้อยู่", 409);
    }
    await listRepository.deleteStatus(statusId);
  },

  async reorderStatuses(listId: string, data: ReorderStatusInput) {
    const list = await listRepository.findById(listId);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${listId}`, 404);
    }
    // Validate all IDs belong to this list
    const existingStatuses = await listRepository.findStatuses(listId);
    const existingIds = new Set(existingStatuses.map(s => s.id));
    for (const sid of data.orderedIds) {
      if (!existingIds.has(sid)) {
        throw new AppError(ErrorCode.NOT_FOUND, `status id: ${sid} ไม่อยู่ใน list นี้`, 404);
      }
    }
    await listRepository.reorderStatuses(listId, data.orderedIds);
    return listRepository.findStatuses(listId);
  },
};
