/**
 * Structured logger — ใช้ pino ถ้าอยู่ใน production
 * dev: pretty print พร้อมสี | prod: JSON บรรทัดเดียวต่อ log (เหมาะกับ Datadog/CloudWatch)
 *
 * Usage:
 *   import { logger } from '@/lib/logger.ts'
 *   logger.info({ userId: '123' }, 'User logged in')
 *   logger.error({ err }, 'Something went wrong')
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level:   LogLevel;
  time:    string;
  msg:     string;
  reqId?:  string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== "production";

function write(level: LogLevel, obj: Record<string, unknown>, msg: string) {
  const entry: LogEntry = {
    level,
    time: new Date().toISOString(),
    msg,
    ...obj,
  };

  const line = JSON.stringify(entry);

  if (isDev) {
    // pretty print สำหรับ development
    const colors: Record<LogLevel, string> = {
      debug: "\x1b[34m", // blue
      info:  "\x1b[32m", // green
      warn:  "\x1b[33m", // yellow
      error: "\x1b[31m", // red
    };
    const reset = "\x1b[0m";
    const label = `${colors[level]}[${level.toUpperCase()}]${reset}`;
    const extra = Object.entries(obj).length ? " " + JSON.stringify(obj) : "";
    console.log(`${entry.time} ${label} ${msg}${extra}`);
  } else {
    // JSON line สำหรับ production log aggregators
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

export const logger = {
  debug: (obj: Record<string, unknown>, msg: string) => write("debug", obj, msg),
  info:  (obj: Record<string, unknown>, msg: string) => write("info",  obj, msg),
  warn:  (obj: Record<string, unknown>, msg: string) => write("warn",  obj, msg),
  error: (obj: Record<string, unknown>, msg: string) => write("error", obj, msg),
};

// convenience overload สำหรับ error objects
export function logError(err: unknown, msg: string, extra?: Record<string, unknown>) {
  const errData = err instanceof Error
    ? { errMessage: err.message, stack: isDev ? err.stack : undefined }
    : { err };
  logger.error({ ...errData, ...extra }, msg);
}
