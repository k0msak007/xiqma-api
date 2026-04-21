import { notificationRepository, type ListNotificationsParams } from "@/repositories/notification.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

export const notificationService = {
  async list(params: ListNotificationsParams) {
    return notificationRepository.findAll(params);
  },

  async markRead(id: string, employeeId: string) {
    const notif = await notificationRepository.findById(id);
    if (!notif) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ notification id: ${id}`, 404);
    }
    if (notif.employeeId !== employeeId) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์อ่าน notification ของผู้อื่น", 403);
    }
    return notificationRepository.markRead(id);
  },

  async markAllRead(employeeId: string) {
    return notificationRepository.markAllRead(employeeId);
  },
};
