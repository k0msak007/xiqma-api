import { folderRepository } from "@/repositories/folder.repository.ts";
import { spaceRepository } from "@/repositories/space.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { CreateFolderInput, UpdateFolderInput, ListFoldersInput } from "@/validators/folder.validator.ts";

export const folderService = {
  async list(params: ListFoldersInput, userId: string, isAdmin: boolean) {
    if (!isAdmin) {
      const isMember = await spaceRepository.isMember(params.spaceId, userId);
      if (!isMember) {
        throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่ได้เป็นสมาชิกของ space นี้", 403);
      }
    }
    return folderRepository.findAll(params);
  },

  async create(data: CreateFolderInput, userId: string, isAdmin: boolean) {
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
    return folderRepository.create(data);
  },

  async update(id: string, data: UpdateFolderInput) {
    const folder = await folderRepository.findById(id);
    if (!folder) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ folder id: ${id}`, 404);
    }
    return folderRepository.update(id, data);
  },

  async archive(id: string) {
    const folder = await folderRepository.findById(id);
    if (!folder) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ folder id: ${id}`, 404);
    }
    return folderRepository.archive(id);
  },

  async restore(id: string) {
    const folder = await folderRepository.findById(id);
    if (!folder) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ folder id: ${id}`, 404);
    }
    return folderRepository.restore(id);
  },

  async delete(id: string) {
    const folder = await folderRepository.findById(id);
    if (!folder) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ folder id: ${id}`, 404);
    }
    // Cascade: soft-delete tasks → delete list_statuses → delete lists → delete folder
    await folderRepository.delete(id);
  },
};
