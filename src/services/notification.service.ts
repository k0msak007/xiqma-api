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

  // ── Preferences ──────────────────────────────────────────────────────────────
  async getPrefs(employeeId: string) {
    return notificationRepository.getPrefs(employeeId);
  },

  async updatePrefs(employeeId: string, items: Array<{ eventType: string; channel: string; enabled: boolean }>) {
    for (const it of items) {
      await notificationRepository.upsertPref(employeeId, it.eventType, it.channel, it.enabled);
    }
    return notificationRepository.getPrefs(employeeId);
  },

  async getQuietHours(employeeId: string) {
    return notificationRepository.getQuietHours(employeeId);
  },

  async setQuietHours(employeeId: string, start: string, end: string) {
    // Validate HH:MM
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "ใช้รูปแบบ HH:MM", 400);
    }
    await notificationRepository.setQuietHours(employeeId, start, end);
    return notificationRepository.getQuietHours(employeeId);
  },
};
