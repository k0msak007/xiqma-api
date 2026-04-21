import { Hono } from "hono";
import { getHealth, type HealthStatus } from "@/services/health.service.ts";

const health = new Hono();

// GET /health - Basic health check
health.get("/", async (c) => {
  const healthData = await getHealth();
  const statusCode = healthData.status === "ok" ? 200 : 503;
  return c.json(healthData, statusCode);
});

// GET /health/detailed - Verbose health check (for monitoring tools)
health.get("/detailed", async (c) => {
  const healthData = await getHealth();
  const statusCode = healthData.status === "ok" ? 200 : 503;
  
  return c.json({
    ...healthData,
    environment: process.env.NODE_ENV ?? "development",
    hostname: process.env.HOSTNAME ?? "unknown",
    memory: process.memoryUsage(),
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
    },
  }, statusCode);
});

// GET /health/ready - Kubernetes probe (returns 200 if ready)
health.get("/ready", async (c) => {
  const healthData = await getHealth();
  if (healthData.services.db.status === "disconnected") {
    return c.json({ ready: false, reason: "Database not connected" }, 503);
  }
  return c.json({ ready: true });
});

// GET /health/live - Kubernetes probe (always returns 200 if process is running)
health.get("/live", (c) => {
  return c.json({ alive: true });
});

export const healthRouter = health;