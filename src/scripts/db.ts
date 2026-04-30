// ─────────────────────────────────────────────────────────────────────────────
// DB helper — run ad-hoc SELECT queries against Supabase.
// Usage:   bun run src/scripts/db.ts "<SQL>"
// Example: bun run src/scripts/db.ts "SELECT name, enabled FROM bot_schedules ORDER BY name"
// Security: ONLY SELECT queries are allowed — INSERT/UPDATE/DELETE/DROP rejected.
// ─────────────────────────────────────────────────────────────────────────────
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const query = process.argv[2];
if (!query) {
  console.log("Usage: bun run src/scripts/db.ts \"<SELECT query>\"");
  process.exit(0);
}

const trimmed = query.trim();
const upper = trimmed.slice(0, 7).toUpperCase();
if (upper !== "SELECT " && upper !== "SELECT\n" && upper !== "SELECT\t") {
  console.error("❌ Only SELECT queries are allowed");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  const rows = await sql.unsafe(trimmed);
  if (Array.isArray(rows) && rows.length > 0) {
    console.table(rows);
  } else if (Array.isArray(rows)) {
    console.log("(0 rows)");
  } else {
    console.log(rows);
  }
} catch (e: any) {
  console.error("❌", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
