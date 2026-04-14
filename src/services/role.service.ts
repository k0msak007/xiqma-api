import { roleRepository } from "@/repositories/role.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { CreateRoleInput, UpdateRoleInput } from "@/validators/role.validator.ts";

export const roleService = {
  async list() {
    return roleRepository.findAll();
  },

  async findById(id: string) {
    const role = await roleRepository.findById(id);
    if (!role) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ role id: ${id}`, 404);
    }
    return role;
  },

  async create(data: CreateRoleInput) {
    const existing = await roleRepository.findByName(data.name);
    if (existing) {
      throw new AppError(ErrorCode.ROLE_NAME_EXISTS, `ชื่อ role "${data.name}" ถูกใช้แล้ว`, 409);
    }
    return roleRepository.create(data);
  },

  async update(id: string, data: UpdateRoleInput) {
    const role = await roleRepository.findById(id);
    if (!role) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ role id: ${id}`, 404);
    }

    // Check name uniqueness only if name is changing
    if (data.name && data.name !== role.name) {
      const existing = await roleRepository.findByName(data.name);
      if (existing) {
        throw new AppError(ErrorCode.ROLE_NAME_EXISTS, `ชื่อ role "${data.name}" ถูกใช้แล้ว`, 409);
      }
    }

    return roleRepository.update(id, data);
  },

  async delete(id: string) {
    const role = await roleRepository.findById(id);
    if (!role) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ role id: ${id}`, 404);
    }

    const employeeCount = await roleRepository.countEmployeesByRoleId(id);
    if (employeeCount > 0) {
      throw new AppError(
        ErrorCode.ROLE_IN_USE,
        `ไม่สามารถลบ role นี้ได้ เนื่องจากมีพนักงานใช้งานอยู่ ${employeeCount} คน`,
        409
      );
    }

    await roleRepository.delete(id);
  },
};
