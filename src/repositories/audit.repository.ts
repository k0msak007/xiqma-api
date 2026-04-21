import { and, desc, eq, gte, lte, count, type SQL } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { auditLogs } from "@/db/schema/logs.schema.ts";
import { employees } from "@/db/schema/employees.schema.ts";

export interface ListAuditLogsParams {
  actorId?:   string;
  tableName?: string;
  action?:    string;
  from?:      string; // ISO date
  to?:        string;
  page:       number;
  limit:      number;
}

export const auditRepository = {
  async findAll(params: ListAuditLogsParams) {
    const { actorId, tableName, action, from, to, page, limit } = params;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (actorId)   conditions.push(eq(auditLogs.actorId, actorId));
    if (tableName) conditions.push(eq(auditLogs.tableName, tableName));
    if (action)    conditions.push(eq(auditLogs.action, action));
    if (from)      conditions.push(gte(auditLogs.createdAt, new Date(from)));
    if (to)        conditions.push(lte(auditLogs.createdAt, new Date(to)));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id:         auditLogs.id,
          actorId:    auditLogs.actorId,
          action:     auditLogs.action,
          tableName:  auditLogs.tableName,
          recordId:   auditLogs.recordId,
          beforeData: auditLogs.beforeData,
          afterData:  auditLogs.afterData,
          ipAddress:  auditLogs.ipAddress,
          createdAt:  auditLogs.createdAt,
          actorName:  employees.name,
          actorCode:  employees.employeeCode,
        })
        .from(auditLogs)
        .leftJoin(employees, eq(auditLogs.actorId, employees.id))
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),

      db.select({ count: count() }).from(auditLogs).where(whereClause),
    ]);

    return { rows, total: totalResult[0]?.count ?? 0 };
  },
};
