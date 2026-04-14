import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { requestIdMiddleware } from "@/middleware/request-id.ts";
import { apiRateLimit } from "@/middleware/rate-limit.ts";
import { errorMiddleware } from "@/middleware/error.ts";

import { authRouter } from "@/routes/auth.route.ts";
import { employeesRouter } from "@/routes/employees.route.ts";
import { tasksRouter } from "@/routes/tasks.route.ts";
import { rolesRouter } from "@/routes/roles.route.ts";
import { positionsRouter } from "@/routes/positions.route.ts";
import { workSchedulesRouter } from "@/routes/work-schedules.route.ts";
import { holidaysRouter } from "@/routes/holidays.route.ts";
import { taskTypesRouter } from "@/routes/task-types.route.ts";

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

  // ── Health check ─────────────────────────────────────────────
  .get("/health", (c) =>
    c.json({ status: "ok", ts: new Date().toISOString(), version: "1.0.0" }),
  )

  // ── Routes ───────────────────────────────────────────────────
  .route("/api/auth", authRouter)
  .route("/api/employees", employeesRouter)
  .route("/api/tasks", tasksRouter)
  .route("/api/roles", rolesRouter)
  .route("/api/positions", positionsRouter)
  .route("/api/work-schedules", workSchedulesRouter)
  .route("/api/holidays", holidaysRouter)
  .route("/api/task-types", taskTypesRouter)
  // ── Error handler (must be last) ─────────────────────────────
  .onError(errorMiddleware);

export type AppType = typeof app;
