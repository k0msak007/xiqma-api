/**
 * Seed script — idempotent (รันกี่ครั้งก็ได้ ไม่ error)
 * Usage: bun run db:seed
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema/index.ts";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env แล้วกรอกค่า");
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

async function seed() {
  console.log("🌱 Starting seed...\n");

  // ── 1. Work Schedule ──────────────────────────────────────────────────────
  console.log("  → work_schedules");
  await db.execute(sql`
    INSERT INTO work_schedules (name, days_per_week, hours_per_day, work_days, work_start_time, work_end_time, is_default)
    VALUES ('จันทร์–ศุกร์ 09:00–18:00', 5, 8, '{1,2,3,4,5}', '09:00', '18:00', true)
    ON CONFLICT DO NOTHING
  `);

  // ── 2. Roles ──────────────────────────────────────────────────────────────
  console.log("  → roles");
  await db.execute(sql`
    INSERT INTO roles (name, description, color, permissions) VALUES
      ('admin',    'ผู้ดูแลระบบทั้งหมด',     '#ef4444',
       '["view_tasks","create_tasks","edit_tasks","delete_tasks","assign_tasks","manage_users","manage_roles","manage_workspace","view_analytics","admin"]'),
      ('manager',  'ผู้จัดการ ดูและจัดการทีม', '#f59e0b',
       '["view_tasks","create_tasks","edit_tasks","assign_tasks","view_analytics"]'),
      ('hr',       'HR ดูแลการลาและรายงาน',   '#8b5cf6',
       '["view_tasks","view_analytics","manage_users"]'),
      ('employee', 'พนักงานทั่วไป',           '#6b7280',
       '["view_tasks","create_tasks","edit_tasks"]')
    ON CONFLICT (name) DO NOTHING
  `);

  // ── 3. Task Types ─────────────────────────────────────────────────────────
  console.log("  → task_types");
  await db.execute(sql`
    INSERT INTO task_types (name, color, category, counts_for_points, fixed_points) VALUES
      ('Development',  '#3b82f6', 'organization', true,  NULL),
      ('Bug Fix',      '#ef4444', 'organization', true,  NULL),
      ('Code Review',  '#f59e0b', 'organization', true,  NULL),
      ('Documentation','#10b981', 'organization', true,  NULL),
      ('Meeting',      '#6b7280', 'private',      false, 2),
      ('Training',     '#8b5cf6', 'private',      false, 4),
      ('Planning',     '#ec4899', 'organization', true,  NULL),
      ('Testing / QA', '#14b8a6', 'organization', true,  NULL)
    ON CONFLICT DO NOTHING
  `);

  // ── 4. Admin User ─────────────────────────────────────────────────────────
  console.log("  → admin employee");

  // ดึง role_id ของ admin
  const adminRole = await db.execute<{ id: string }>(
    sql`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`
  );
  const adminRoleId = adminRole[0]?.id;

  await db.execute(sql`
    INSERT INTO employees (employee_code, name, email, password_hash, role, role_id, is_active)
    VALUES (
      'EMP-0001',
      'System Admin',
      'admin@company.com',
      crypt('Admin@1234', gen_salt('bf')),
      'admin',
      ${adminRoleId ?? null},
      true
    )
    ON CONFLICT (employee_code) DO NOTHING
  `);

  // ── 5. Leave Quotas สำหรับ admin ─────────────────────────────────────────
  console.log("  → leave_quotas for admin");
  const adminEmp = await db.execute<{ id: string }>(
    sql`SELECT id FROM employees WHERE employee_code = 'EMP-0001' LIMIT 1`
  );
  const adminId = adminEmp[0]?.id;

  if (adminId) {
    const currentYear = new Date().getFullYear();
    await db.execute(sql`
      INSERT INTO leave_quotas (employee_id, year, leave_type, quota_days, used_days) VALUES
        (${adminId}, ${currentYear}, 'annual',   10, 0),
        (${adminId}, ${currentYear}, 'sick',     30, 0),
        (${adminId}, ${currentYear}, 'personal',  3, 0)
      ON CONFLICT (employee_id, year, leave_type) DO NOTHING
    `);
  }

  // ── 6. Verify ─────────────────────────────────────────────────────────────
  const [roles, taskTypes, employees, schedules] = await Promise.all([
    db.execute<{ count: string }>(sql`SELECT COUNT(*)::int AS count FROM roles`),
    db.execute<{ count: string }>(sql`SELECT COUNT(*)::int AS count FROM task_types`),
    db.execute<{ count: string }>(sql`SELECT COUNT(*)::int AS count FROM employees`),
    db.execute<{ count: string }>(sql`SELECT COUNT(*)::int AS count FROM work_schedules`),
  ]);

  console.log("\n✅ Seed complete!\n");
  console.log(`   roles:          ${roles[0]?.count} rows`);
  console.log(`   task_types:     ${taskTypes[0]?.count} rows`);
  console.log(`   employees:      ${employees[0]?.count} rows`);
  console.log(`   work_schedules: ${schedules[0]?.count} rows`);
  console.log("\n⚠️  Admin credentials:");
  console.log("   email:    admin@company.com");
  console.log("   password: Admin@1234  ← เปลี่ยนทันทีหลัง deploy!\n");
}

seed()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => client.end());
