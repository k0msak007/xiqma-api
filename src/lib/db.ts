import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema/index.ts";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// postgres.js client — pool ให้อัตโนมัติ
const client = postgres(process.env.DATABASE_URL, {
  max: 10,          // max connections
  idle_timeout: 20, // วินาที
  connect_timeout: 10,
});

// drizzle instance พร้อม schema สำหรับ type inference
export const db = drizzle(client, { schema });

export type Database = typeof db;
