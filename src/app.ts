import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { requestIdMiddleware } from "@/middleware/request-id.ts";
import { apiRateLimit } from "@/middleware/rate-limit.ts";
import { errorMiddleware } from "@/middleware/error.ts";
import { auditMiddleware } from "@/middleware/audit.ts";

import { authRouter } from "@/routes/auth.route.ts";
import { employeesRouter } from "@/routes/employees.route.ts";
import { tasksRouter } from "@/routes/tasks.route.ts";
import { rolesRouter } from "@/routes/roles.route.ts";
import { positionsRouter } from "@/routes/positions.route.ts";
import { workSchedulesRouter } from "@/routes/work-schedules.route.ts";
import { holidaysRouter } from "@/routes/holidays.route.ts";
import { taskTypesRouter } from "@/routes/task-types.route.ts";
import { spacesRouter }  from "@/routes/spaces.route.ts";
import { foldersRouter } from "@/routes/folders.route.ts";
import { listsRouter }             from "@/routes/lists.route.ts";
import { extensionRequestsRouter } from "@/routes/extension-requests.route.ts";
import { searchRouter }            from "@/routes/search.route.ts";
import { leaveRequestsRouter }     from "@/routes/leave-requests.route.ts";
import { leaveQuotasRouter }       from "@/routes/leave-quotas.route.ts";
import { attendanceRouter }        from "@/routes/attendance.route.ts";
import { performanceConfigRouter } from "@/routes/performance-config.route.ts";
import { analyticsRouter }         from "@/routes/analytics.route.ts";
import { reportsRouter }           from "@/routes/reports.route.ts";
import { profileRouter }           from "@/routes/profile.route.ts";
import { notificationsRouter }     from "@/routes/notifications.route.ts";
import { auditLogsRouter }         from "@/routes/audit-logs.route.ts";
import { aiRouter }                from "@/routes/ai.route.ts";
import { standupsRouter }          from "@/routes/standups.route.ts";
import { lineRouter }              from "@/routes/line.route.ts";
import { lineWebhookRouter }       from "@/routes/line-webhook.route.ts";
import { botSchedulesRouter }      from "@/routes/bot-schedules.route.ts";
import { healthRouter }            from "@/routes/health.route.ts";

export const app = new Hono()

  // ── Global middleware (ลำดับสำคัญ) ──────────────────────────
  .use(requestIdMiddleware) // inject X-Request-ID + log ทุก request
  .use(secureHeaders()) // security headers (CSP, HSTS ฯลฯ)
  .use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(",") ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
      exposeHeaders: [
        "X-Request-ID",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
      ],
    }),
  )
  .use("/api/*", apiRateLimit) // 100 req/min ทุก API endpoint
  .use("/api/*", auditMiddleware) // log mutations to audit_logs

  // ── Routes ───────────────────────────────────────────────────
  .route("/health", healthRouter)
  .route("/api/auth", authRouter)
  .route("/api/employees", employeesRouter)
  .route("/api/tasks", tasksRouter)
  .route("/api/roles", rolesRouter)
  .route("/api/positions", positionsRouter)
  .route("/api/work-schedules", workSchedulesRouter)
  .route("/api/holidays", holidaysRouter)
  .route("/api/task-types", taskTypesRouter)
  .route("/api/spaces",  spacesRouter)
  .route("/api/folders", foldersRouter)
  .route("/api/lists",              listsRouter)
  .route("/api/extension-requests", extensionRequestsRouter)
  .route("/api/search",             searchRouter)
  .route("/api/leave-requests",      leaveRequestsRouter)
  .route("/api/leave-quotas",        leaveQuotasRouter)
  .route("/api/attendance",          attendanceRouter)
  .route("/api/performance-config",  performanceConfigRouter)
  .route("/api/analytics",           analyticsRouter)
  .route("/api/reports",             reportsRouter)
  .route("/api/profile",             profileRouter)
  .route("/api/notifications",       notificationsRouter)
  .route("/api/audit-logs",          auditLogsRouter)
  .route("/api/ai",                  aiRouter)
  .route("/api/standups",            standupsRouter)
  .route("/api/line",                lineRouter)
  .route("/api/webhooks/line",       lineWebhookRouter)
  .route("/api/bot-schedules",       botSchedulesRouter)
  // ── Error handler (must be last) ─────────────────────────────
  .onError(errorMiddleware);

export type AppType = typeof app;
