import { db } from "@/lib/db.ts";
import { sql } from "drizzle-orm";

const startTime = Date.now();

export interface ServiceStatus {
  status: "connected" | "disconnected";
  latency?: number;
  error?: string;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  uptime: number;
  version: string;
  timestamp: string;
  services: {
    db: ServiceStatus;
    storage: ServiceStatus;
  };
  stats: {
    requests_today: number;
    errors_today: number;
  };
}

export async function getHealth(): Promise<HealthStatus> {
  let dbStatus: ServiceStatus = { status: "connected" };
  let storageStatus: ServiceStatus = { status: "connected" };
  let dbLatency: number | undefined;

  // Check DB connection
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatency = Date.now() - start;
    dbStatus = { status: "connected", latency: dbLatency };
  } catch (e) {
    dbStatus = {
      status: "disconnected",
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // Check Supabase storage (optional - don't fail if unavailable)
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_KEY ?? ""
    );
    await supabase.storage.listBuckets();
    storageStatus = { status: "connected" };
  } catch {
    storageStatus = { status: "disconnected" };
  }

  // Determine overall status
  const overallStatus: "ok" | "degraded" | "down" =
    dbStatus.status === "disconnected" ? "down" : "ok";

  return {
    status: overallStatus,
    uptime: Date.now() - startTime,
    version: process.env.APP_VERSION ?? "1.0.0",
    timestamp: new Date().toISOString(),
    services: {
      db: dbStatus,
      storage: storageStatus,
    },
    stats: {
      requests_today: 0,
      errors_today: 0,
    },
  };
}