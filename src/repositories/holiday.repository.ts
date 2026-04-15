import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { companyHolidays } from "@/db/schema/hr.schema.ts";
import type { CreateHolidayInput, UpdateHolidayInput } from "@/validators/holiday.validator.ts";

export const holidayRepository = {
  async findAll(year?: number) {
    if (year !== undefined) {
      return db
        .select()
        .from(companyHolidays)
        .where(sql`EXTRACT(YEAR FROM ${companyHolidays.holidayDate}::date) = ${year}`)
        .orderBy(companyHolidays.holidayDate);
    }
    return db
      .select()
      .from(companyHolidays)
      .orderBy(companyHolidays.holidayDate);
  },

  async findById(id: string) {
    return db.query.companyHolidays.findFirst({
      where: eq(companyHolidays.id, id),
    });
  },

  async findByDate(date: string) {
    return db.query.companyHolidays.findFirst({
      where: eq(companyHolidays.holidayDate, date),
    });
  },

  async create(data: CreateHolidayInput) {
    const [holiday] = await db
      .insert(companyHolidays)
      .values({
        name:        data.name,
        holidayDate: data.holidayDate,
        isRecurring: data.isRecurring,
        note:        data.note ?? null,
      })
      .returning();
    return holiday;
  },

  async update(id: string, data: UpdateHolidayInput) {
    const [holiday] = await db
      .update(companyHolidays)
      .set({
        ...(data.name        !== undefined && { name:        data.name }),
        ...(data.holidayDate !== undefined && { holidayDate: data.holidayDate }),
        ...(data.isRecurring !== undefined && { isRecurring: data.isRecurring }),
        ...(data.note        !== undefined && { note:        data.note }),
      })
      .where(eq(companyHolidays.id, id))
      .returning();
    return holiday;
  },

  async delete(id: string) {
    await db.delete(companyHolidays).where(eq(companyHolidays.id, id));
  },

  async countWorkingDays(startDate: string, endDate: string) {
    const result = await db.execute<{ working_days: number }>(sql`
      SELECT COUNT(*)::int AS working_days
      FROM generate_series(
        ${startDate}::date,
        ${endDate}::date,
        '1 day'::interval
      ) AS day(d)
      WHERE EXTRACT(DOW FROM day.d) NOT IN (0, 6)
        AND NOT EXISTS (
          SELECT 1 FROM company_holidays ch
          WHERE 
            (ch.holiday_date = day.d)
            OR (ch.is_recurring = true AND 
                TO_CHAR(ch.holiday_date, 'MM-DD') = TO_CHAR(day.d, 'MM-DD'))
        )
    `);
    return result[0]?.working_days ?? 0;
  },
};
