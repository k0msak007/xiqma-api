import { holidayRepository } from "@/repositories/holiday.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import type { CreateHolidayInput, UpdateHolidayInput } from "@/validators/holiday.validator.ts";

export const holidayService = {
  async list(year?: number) {
    return holidayRepository.findAll(year);
  },

  async findById(id: string) {
    const holiday = await holidayRepository.findById(id);
    if (!holiday) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบวันหยุด id: ${id}`, 404);
    }
    return holiday;
  },

  async create(data: CreateHolidayInput) {
    const existing = await holidayRepository.findByDate(data.holidayDate);
    if (existing) {
      throw new AppError(
        ErrorCode.HOLIDAY_DATE_EXISTS,
        `วันที่ ${data.holidayDate} มีวันหยุดอยู่แล้ว`,
        409
      );
    }
    return holidayRepository.create(data);
  },

  async update(id: string, data: UpdateHolidayInput) {
    const holiday = await holidayRepository.findById(id);
    if (!holiday) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบวันหยุด id: ${id}`, 404);
    }

    // Check date uniqueness only if date is changing
    if (data.holidayDate && data.holidayDate !== holiday.holidayDate) {
      const existing = await holidayRepository.findByDate(data.holidayDate);
      if (existing) {
        throw new AppError(
          ErrorCode.HOLIDAY_DATE_EXISTS,
          `วันที่ ${data.holidayDate} มีวันหยุดอยู่แล้ว`,
          409
        );
      }
    }

    return holidayRepository.update(id, data);
  },

  async delete(id: string) {
    const holiday = await holidayRepository.findById(id);
    if (!holiday) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบวันหยุด id: ${id}`, 404);
    }
    await holidayRepository.delete(id);
  },

  async countWorkingDays(startDate: string, endDate: string) {
    if (startDate > endDate) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "วันเริ่มต้นต้องไม่มากว่าวันสิ้นสุด",
        400
      );
    }
    const workingDays = await holidayRepository.countWorkingDays(startDate, endDate);
    return { workingDays };
  },
};
