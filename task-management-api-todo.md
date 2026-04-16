# 🚀 Task Management API — Todo Checklist (พร้อมคำอธิบายแต่ละเส้น)

> **Stack:** Hono + TypeScript + Drizzle ORM + PostgreSQL (Supabase)
> **สัญลักษณ์:** 📌 ทำอะไร | 👤 ใครใช้ | 🔧 ต้องทำอะไรใน handler

---

## 📊 ภาพรวม Phases

| Phase   | หัวข้อ                         | จำนวน endpoint      |
| ------- | ------------------------------ | ------------------- |
| Phase 0 | Infrastructure & Auth          | 4 endpoints + setup |
| Phase 1 | Master Data                    | 26 endpoints        |
| Phase 2 | Workspace Hierarchy            | 23 endpoints        |
| Phase 3 | Task Management                | 35 endpoints        |
| Phase 4 | HR System                      | 14 endpoints        |
| Phase 5 | Performance & Analytics        | 14 endpoints        |
| Phase 6 | Profile, Notifications & Admin | 8 endpoints         |

---

## ⚙️ Phase 0 — Infrastructure & Auth

> เสร็จก่อนทำอะไรทั้งหมด — ไม่มี Phase นี้ Phase อื่นทำไม่ได้

### Project Setup

- [x] สร้าง Hono project + TypeScript

  > ติดตั้ง `hono`, `typescript`, `@hono/node-server` หรือใช้ bun runtime / `bun create hono`

- [x] ติดตั้ง `drizzle-orm` + `postgres.js` + `drizzle-kit`

  > ใช้ postgres.js เป็น driver, drizzle-kit สำหรับ migrate schema

- [x] ตั้ง `.env` ให้ครบ

  > ต้องมี: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_STORAGE_BUCKET`

- [x] วาง folder structure
  ```
  src/
    routes/       ← แยกไฟล์ตาม domain (auth.ts, tasks.ts ฯลฯ)
    middleware/   ← auth.ts, error.ts
    lib/          ← db.ts, response.ts, validate.ts, errors.ts
    schema/       ← drizzle schema ทุก table
  ```

### Database

- [x] รัน `schema.sql` ไฟล์เดียวจบ — ครอบคลุมทุกอย่างแล้ว:

  > extensions (`uuid-ossp`, `pgcrypto`) → ENUMs → sequences → tables → indexes → seed data

  ```bash
  psql $DATABASE_URL -f schema.sql
  ```

- [x] ตรวจว่า seed ครบ:
  - `SELECT * FROM roles` → ได้ 4 rows (admin, manager, hr, employee)
  - `SELECT * FROM task_types` → ได้ 8 rows
  - `SELECT * FROM work_schedules WHERE is_default = true` → ได้ 1 row
  - `SELECT * FROM employees WHERE role = 'admin'` → ได้ admin คนแรก
  - `SELECT nextval('task_display_seq')` → ได้ `2` (เพราะ schema seed ใช้ไป 1 แล้ว)

### Core Lib

- [x] `lib/response.ts` — format response มาตรฐาน

  > export `ok(data, meta?)` และ `fail(code, message, status)` ที่คืน `{ data, error, meta }` เสมอ

- [x] `lib/validate.ts` — Zod middleware wrapper

  > ใช้ `@hono/zod-validator` ครอบทุก route ที่รับ body/query เพื่อ return 400 พร้อม field errors อัตโนมัติ

- [x] `lib/db.ts` — database client singleton

  > `export const db = drizzle(postgres(process.env.DATABASE_URL))` — import ใช้ได้ทุก route

- [x] `lib/errors.ts` — custom error class
  > `class AppError extends Error { constructor(public code: string, public message: string, public status: number) }` ใช้ throw แทน return error ตรงๆ

### Auth Endpoints

---

#### `POST /auth/login`

📌 รับ email + password แล้วออก JWT ให้ใช้งาน API
👤 ทุกคน (public endpoint)

🔧 ต้องทำใน handler:

- [x] รับ `{ email, password }` ผ่าน Zod validate
- [x] query `employees` WHERE `email = ?` และ `is_active = true`
- [x] ตรวจ password ด้วย `crypt(password, password_hash) = password_hash` (pgcrypto)
- [x] ถ้าผิด → throw 401 `INVALID_CREDENTIALS`
- [x] sign `access_token` (expire 15m) และ `refresh_token` (expire 7d) ด้วย jose
- [x] return `{ access_token, refresh_token, expires_in, user: { id, name, role, permissions } }`

---

#### `POST /auth/logout`

📌 ยกเลิก session / refresh token ของ user
👤 user ที่ login อยู่

🔧 ต้องทำใน handler:

- [x] รับ `refresh_token` จาก body หรือ cookie
- [x] ลบหรือ blacklist token ในฐานข้อมูล (ถ้ามี refresh_token table) หรือ clear cookie
- [x] return 200 ok

---

#### `GET /auth/me`

📌 ดูข้อมูล user ที่ login อยู่ — ใช้ตรวจ session และโหลด permissions ตอน app เริ่ม
👤 user ที่มี token

🔧 ต้องทำใน handler:

- [x] middleware auth ตรวจ JWT → inject `ctx.user.id`
- [x] query `employees JOIN roles` WHERE `employee_id = ctx.user.id`
- [x] return ข้อมูล user พร้อม `permissions[]` จาก role

---

#### `POST /auth/refresh`

📌 ขอ access_token ใหม่โดยใช้ refresh_token (ไม่ต้อง login ซ้ำ)
👤 client ที่ access_token หมดอายุ

🔧 ต้องทำใน handler:

- [x] รับ `refresh_token` จาก body
- [x] verify ด้วย `JWT_REFRESH_SECRET`
- [x] ตรวจว่า token ไม่ถูก revoke
- [x] sign `access_token` และ `refresh_token` ใหม่ พร้อม payload เดิม
- [x] return `{ access_token, refresh_token, expires_in }`

---

#### `middleware/auth.ts`

📌 ตรวจ JWT ทุก request ที่ต้องการ auth — ถ้าไม่มี/หมดอายุ ให้ block ก่อนถึง handler
👤 ทุก protected route

🔧 ต้องทำใน middleware:

- [x] ดึง token จาก `Authorization: Bearer <token>` header
- [x] verify ด้วย `jose.jwtVerify`
- [x] ถ้าหมดอายุ → 401 `TOKEN_EXPIRED`
- [x] ถ้า invalid → 401 `INVALID_TOKEN`
- [x] inject `c.set('user', { id, role, permissions })` ให้ handler ใช้ต่อ

---

## 👥 Phase 1 — Master Data

> ข้อมูลพื้นฐานที่ทุก Phase ต้องอ้างอิง — ทำก่อน Phase อื่น

### Roles & Permissions

---

#### `GET /roles`

📌 ดึง roles ทั้งหมดในระบบ เพื่อแสดงใน dropdown เวลาสร้าง/แก้ user
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] query `roles` ORDER BY name
- [x] return `{ data: Role[] }`

---

#### `GET /roles/:id`

📌 ดูรายละเอียด role เดียว รวม permissions ทั้งหมด
👤 admin

🔧 ต้องทำใน handler:

- [x] query `roles` WHERE `id = :id`
- [x] ถ้าไม่เจอ → 404

---

#### `POST /roles`

📌 สร้าง role ใหม่พร้อมกำหนด permissions
👤 admin (ต้องมี permission `manage_roles`)

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, description?, color, permissions: string[] }`
- [x] ตรวจ name ซ้ำ → 409 `ROLE_NAME_EXISTS`
- [x] insert `roles`
- [x] return role ที่สร้าง

---

#### `PUT /roles/:id`

📌 แก้ชื่อ/สี/permissions ของ role
👤 admin

🔧 ต้องทำใน handler:

- [x] validate body ครบ (full update)
- [x] UPDATE `roles` WHERE `id = :id`
- [x] return role ที่อัปเดต

---

#### `DELETE /roles/:id`

📌 ลบ role ออกจากระบบ
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจว่ามี employee ใช้ role นี้อยู่ไหม (`COUNT(*) FROM employees WHERE role_id = :id AND is_active = true`)
- [x] ถ้ามี → 409 `ROLE_IN_USE` พร้อม count
- [x] ถ้าไม่มี → DELETE จริง

---

### Positions (ตำแหน่งงาน / Org Chart)

---

#### `GET /positions?department=`

📌 ดึงตำแหน่งทั้งหมดสำหรับ render org chart หรือ dropdown เลือกตำแหน่ง
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] query `positions LEFT JOIN employees` เพื่อได้ `employee_count`
- [x] JOIN parent position เพื่อได้ `parent_name`
- [x] filter `?department=` ถ้ามี
- [x] return พร้อม `parent_position_id` ให้ frontend จัด tree เอง

---

#### `GET /positions/:id`

📌 ดูรายละเอียดตำแหน่ง รวม list ของ employees ที่อยู่ในตำแหน่งนี้
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] query position + JOIN employees ที่ `is_active = true`
- [x] aggregate employees เป็น JSON array

---

#### `POST /positions`

📌 สร้างตำแหน่งงานใหม่ในระบบ (ใช้สร้าง org chart)
👤 admin (ต้องมี permission `manage_workspace`)

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, department?, level, job_level_code?, color?, parent_position_id? }`
- [x] insert `positions`

---

#### `PUT /positions/:id`

📌 แก้ชื่อ/สี/parent ของตำแหน่ง
👤 admin

🔧 ต้องทำใน handler:

- [x] validate body ครบ
- [x] UPDATE `positions` SET ... WHERE `id = :id`

---

#### `DELETE /positions/:id`

📌 ปิดการใช้งานตำแหน่ง (soft delete) — ไม่ลบจริงเพราะมี history
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจ employees ที่ `is_active = true` ในตำแหน่งนี้
- [x] ถ้ามี → 409 บอกว่ายังมีคนอยู่
- [x] UPDATE `is_active = false`

---

### Employees (Users)

---

#### `GET /employees?search=&role=&department=&page=&limit=`

📌 ดึงรายชื่อพนักงานทั้งหมด ใช้ใน User Management และ dropdown assign task
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] parse query params (search, role, department, is_active, page, limit)
- [x] query `employees JOIN roles JOIN positions JOIN manager` ด้วย LEFT JOIN
- [x] WHERE `is_active = true` (default) + filter ที่ส่งมา
- [x] ILIKE `%search%` บน name และ email
- [x] LIMIT/OFFSET pagination
- [x] return `{ data, meta: { total, page, limit } }`

---

#### `GET /employees/:id`

📌 ดูโปรไฟล์พนักงานคนเดียว รวม role, position, manager
👤 admin, manager, ตัวเอง

🔧 ต้องทำใน handler:

- [x] query employee + JOIN roles, positions, manager
- [x] ถ้าไม่เจอ หรือ `is_active = false` → 404

---

#### `POST /employees`

📌 สร้างบัญชี employee ใหม่ในระบบ
👤 admin (ต้องมี permission `manage_users`)

🔧 ต้องทำใน handler:

- [x] validate body: `{ employee_code, name, email, role, role_id, position_id?, manager_id?, department?, leave_quota_* }`
- [x] ตรวจ employee_code ซ้ำ → 409 `EMPLOYEE_CODE_EXISTS`
- [x] hash password เริ่มต้นด้วย `crypt(temp_password, gen_salt('bf'))`
- [x] INSERT `employees`
- [x] หลัง insert → INSERT `leave_quotas` 3 rows (annual/sick/personal) ปีปัจจุบัน ทันที
- [x] return id, name, email ที่สร้าง

---

#### `PUT /employees/:id`

📌 แก้ข้อมูลพนักงาน เช่น ย้ายแผนก เปลี่ยน role เปลี่ยน manager
👤 admin (manage_users) หรือตัวเองแก้เฉพาะ field ที่อนุญาต

🔧 ต้องทำใน handler:

- [x] ตรวจ permission — ถ้าแก้คนอื่นต้องมี `manage_users`
- [x] COALESCE update (ไม่ส่งมา = ไม่เปลี่ยน)
- [x] UPDATE `updated_at = now()`

---

#### `DELETE /employees/:id`

📌 ปิดบัญชีพนักงาน (soft delete) — ยังคง history ไว้ แต่ login ไม่ได้
👤 admin (manage_users) — ใช้ PATCH /:id/deactivate

🔧 ต้องทำใน handler:

- [x] UPDATE `is_active = false, updated_at = now()`
- [x] ห้ามลบ admin คนสุดท้าย (ตรวจก่อน)

---

#### `PATCH /employees/:id/avatar`

📌 เปลี่ยนรูปโปรไฟล์
👤 ตัวเอง หรือ admin

🔧 ต้องทำใน handler:

- [x] รับ multipart/form-data
- [x] validate type (image/jpeg, image/png, image/webp) + ขนาดไม่เกิน 5MB
- [x] upload ไปที่ Supabase Storage bucket `avatars/`
- [x] UPDATE `avatar_url` ในตาราง employees

---

#### `PUT /employees/me/password`

📌 เปลี่ยนรหัสผ่านของตัวเอง
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [x] รับ `{ current_password, new_password }`
- [x] ดึง `password_hash` จาก DB แล้วตรวจ current_password ถูกไหม
- [x] ถ้าผิด → 400 `WRONG_PASSWORD`
- [x] UPDATE password_hash ด้วย `crypt(new_password, gen_salt('bf'))`

---

### Work Schedules

---

#### `GET /work-schedules`

📌 ดึงตารางเวลาทำงานทั้งหมด ใช้ผูกกับ employee เพื่อคำนวณ performance
👤 admin, HR

🔧 ต้องทำใน handler:

- [x] query `work_schedules` ORDER BY `is_default DESC, name`

---

#### `POST /work-schedules`

📌 สร้างตารางเวลาทำงานใหม่ เช่น fulltime / parttime / shift
👤 admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, days_per_week, hours_per_day, work_days: int[], work_start_time, work_end_time, is_default? }`
- [x] คำนวณ `hours_per_week = days_per_week * hours_per_day` (GENERATED column ใน DB)
- [x] ถ้า `is_default = true` → UPDATE schedule เดิมทุก row ให้ `is_default = false` ก่อน
- [x] INSERT

---

#### `PUT /work-schedules/:id`

📌 แก้รายละเอียดตารางเวลาทำงาน
👤 admin

🔧 ต้องทำใน handler:

- [x] logic is_default เหมือน POST
- [x] UPDATE

---

#### `DELETE /work-schedules/:id`

📌 ลบตารางเวลาที่ไม่ใช้แล้ว
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจว่ามี `employee_performance_config` อ้างอิงอยู่ไหม → 409 ถ้ามี
- [x] DELETE

---

### Holidays (วันหยุดนักขัตฤกษ์)

---

#### `GET /holidays?year=`

📌 ดึงวันหยุดของปีที่ระบุ ใช้คำนวณวันทำงานจริง และแสดงบน calendar
👤 ทุกคน

🔧 ต้องทำใน handler:

- [x] parse `?year=` (default ปีปัจจุบัน)
- [x] query วันหยุดที่ year ตรงกัน + วันที่ `is_recurring = true` (วันหยุดวนซ้ำทุกปี เช่น วันปีใหม่)
- [x] return เรียงตาม `holiday_date`

---

#### `POST /holidays`

📌 เพิ่มวันหยุดใหม่ (ราชการประกาศ หรือวันหยุดพิเศษบริษัท)
👤 admin, HR

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, holiday_date, is_recurring?, note? }`
- [x] ตรวจ `holiday_date` ซ้ำ → 409
- [x] INSERT

---

#### `PUT /holidays/:id`

📌 แก้ชื่อหรือวันหยุด
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจ id มีอยู่จริง
- [x] UPDATE

---

#### `DELETE /holidays/:id`

📌 ลบวันหยุดที่ตั้งผิดหรือยกเลิก
👤 admin

🔧 ต้องทำใน handler:

- [x] DELETE จริง (ไม่ soft delete)

---

#### `GET /holidays/working-days?start=&end=`

📌 นับวันทำงานจริงในช่วงที่กำหนด (ไม่รวม weekend + วันหยุด) ใช้คำนวณวันลา
👤 ระบบใช้ภายใน + HR

🔧 ต้องทำใน handler:

- [x] validate `start` และ `end` เป็น date และ `start <= end`
- [x] ใช้ `generate_series` นับวันทีละวัน
- [x] กรอง DOW 0 (อาทิตย์) และ 6 (เสาร์) ออก
- [x] กรองวันที่ตรงกับ `company_holidays` ออก
- [x] return `{ working_days: number }`

---

### Task Types

---

#### `GET /task-types?category=`

📌 ดึงประเภท task ใช้ใน dropdown ตอนสร้าง task
👤 ทุกคน

🔧 ต้องทำใน handler:

- [x] query `task_types` filter `?category=private|organization` ถ้ามี
- [x] return เรียงตาม category → name

---

#### `POST /task-types`

📌 สร้างประเภท task ใหม่ เช่น Bug Fix, Meeting, Training
👤 admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, description?, color, category, counts_for_points, fixed_points? }`
- [x] ตรวจ name ซ้ำ → 409
- [x] INSERT

---

#### `PUT /task-types/:id`

📌 แก้รายละเอียด task type
👤 admin

🔧 ต้องทำใน handler:

- [x] validate logic เดียวกับ POST
- [x] UPDATE

---

#### `DELETE /task-types/:id`

📌 ลบ task type ที่ไม่ใช้แล้ว
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจว่ามี task ใช้ type นี้อยู่ไหม → 409 `TASK_TYPE_IN_USE`
- [x] DELETE

---

## 🏢 Phase 2 — Workspace Hierarchy

> ต้องมี Phase 1 (employees) ก่อน

### Spaces

---

#### `GET /spaces`

📌 ดึง space ทั้งหมดที่ user เข้าถึงได้ ใช้แสดง sidebar ซ้ายของ app
👤 ทุกคน (เห็นเฉพาะที่ตัวเองเป็น member / admin เห็นทั้งหมด)

🔧 ต้องทำใน handler:

- [x] query `spaces LEFT JOIN space_members LEFT JOIN lists` นับ member_count + list_count
- [x] WHERE `space_members.employee_id = ctx.user.id` (ถ้าไม่ใช่ admin)
- [x] ORDER BY `display_order`

---

#### `GET /spaces/:id`

📌 ดูรายละเอียด space เดียว รวม member list
👤 member ของ space, admin

🔧 ต้องทำใน handler:

- [x] ตรวจ user เป็น member หรือ admin → 403 ถ้าไม่ใช่
- [x] query space + aggregate members เป็น JSON array

---

#### `POST /spaces`

📌 สร้าง space ใหม่ เช่น "Engineering", "Marketing"
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, color, icon?, member_ids?: string[] }`
- [x] INSERT `spaces` พร้อมคำนวณ `display_order = MAX + 1`
- [x] INSERT `space_members` สำหรับ creator + member_ids ที่ส่งมา (ON CONFLICT DO NOTHING)
- [x] return space ที่สร้าง

---

#### `PUT /spaces/:id`

📌 แก้ชื่อ/สี/icon/ลำดับของ space
👤 admin, manager ที่เป็น member

🔧 ต้องทำใน handler:

- [x] validate body
- [x] COALESCE update

---

#### `DELETE /spaces/:id`

📌 ลบ space ออกจากระบบ
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจ folders/lists ที่ `is_archived = false` ข้างใน → 409 ถ้ายังมี
- [x] ลบ `space_members` ก่อน แล้วค่อย soft delete children

---

#### `POST /spaces/:id/members`

📌 เพิ่มสมาชิกเข้า space
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] validate body: `{ employee_ids: string[] }`
- [x] ตรวจว่า employee_ids ทุกคนมีอยู่จริงและ `is_active = true`
- [x] INSERT `space_members` batch (ON CONFLICT DO NOTHING)

---

#### `DELETE /spaces/:id/members/:employee_id`

📌 เอาสมาชิกออกจาก space
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] ตรวจว่า space_id + employee_id มีอยู่
- [x] DELETE จาก `space_members`

---

### Folders

---

#### `GET /folders?space_id=&include_archived=`

📌 ดึง folder ทั้งหมดใน space ใช้แสดง sidebar
👤 member ของ space

🔧 ต้องทำใน handler:

- [x] require `?space_id=`
- [x] query `folders LEFT JOIN lists` นับ list_count
- [x] filter `is_archived = false` โดย default, เปิดด้วย `?include_archived=true`
- [x] ORDER BY `is_archived ASC, display_order`

---

#### `POST /folders`

📌 สร้าง folder ใหม่ใน space สำหรับจัดกลุ่ม list
👤 member ของ space, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, space_id, color? }`
- [x] ตรวจว่า space_id มีอยู่จริงและ user เป็น member
- [x] INSERT พร้อม `display_order = MAX + 1` ใน space นั้น

---

#### `PUT /folders/:id`

📌 แก้ชื่อ/สี/ลำดับ folder
👤 member, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ name?, color?, display_order? }`
- [x] COALESCE update

---

#### `PATCH /folders/:id/archive`

📌 ซ่อน folder และ list/task ข้างใน ไม่ลบถาวร (เหมือน archive ใน Gmail)
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] UPDATE `is_archived = true, archived_at = now()`

---

#### `PATCH /folders/:id/restore`

📌 เอา folder กลับขึ้นมาจาก archive
👤 admin, manager

🔧 ต้องทำใน handler:

- [x] UPDATE `is_archived = false, archived_at = NULL`

---

#### `DELETE /folders/:id`

📌 ลบ folder ถาวร (ทำได้เฉพาะหลัง archive แล้ว)
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจ `is_archived = true` ก่อน → 400 ถ้ายังไม่ archive
- [x] soft delete lists ข้างใน + tasks ใน lists นั้นด้วย
- [x] DELETE folder

---

### Lists & Statuses

---

#### `GET /lists?space_id=&folder_id=`

📌 ดึง list ทั้งหมดใน space/folder พร้อม statuses และ task count ใช้แสดง board
👤 member ของ space

🔧 ต้องทำใน handler:

- [x] require `?space_id=`
- [x] query `lists LEFT JOIN tasks LEFT JOIN list_statuses`
- [x] aggregate statuses เป็น JSON array เรียงตาม `display_order`
- [x] นับ `task_count` + `done_count`

---

#### `POST /lists`

📌 สร้าง list ใหม่ (เทียบได้กับ board ใน Trello หรือ sprint ใน Jira)
👤 member, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, space_id, folder_id?, color? }`
- [x] INSERT `lists`
- [x] หลัง insert → INSERT `list_statuses` default 5 รายการทันที:
  ```
  Open (gray) → In Progress (blue) → Review (amber) → Done (green) → Closed (purple)
  ```

---

#### `PUT /lists/:id`

📌 แก้ชื่อ/สี/ลำดับ list
👤 member, admin

🔧 ต้องทำใน handler:

- [x] COALESCE update

---

#### `DELETE /lists/:id`

📌 ลบ list และ task ข้างใน
👤 admin

🔧 ต้องทำใน handler:

- [x] ตรวจว่ามี task ที่ยังไม่ completed/cancelled อยู่ → แจ้งเตือน
- [x] soft delete tasks ทั้งหมดใน list ก่อน
- [x] DELETE list

---

#### `GET /lists/:id/statuses`

📌 ดึง status columns ของ list นั้น ใช้ render Kanban columns
👤 member

🔧 ต้องทำใน handler:

- [x] query `list_statuses` WHERE `list_id = :id` ORDER BY `display_order`

---

#### `POST /lists/:id/statuses`

📌 เพิ่ม status column ใหม่ใน list เช่น "QA", "Staging"
👤 member, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ name, color, type }`
- [x] `display_order = MAX + 1`
- [x] INSERT

---

#### `PUT /lists/:id/statuses/:status_id`

📌 แก้ชื่อ/สี/ประเภทของ status column
👤 member, admin

🔧 ต้องทำใน handler:

- [x] validate ว่า status_id อยู่ใน list_id นี้จริง
- [x] UPDATE

---

#### `DELETE /lists/:id/statuses/:status_id`

📌 ลบ status column ออก (ทำได้เฉพาะถ้าไม่มี task อยู่)
👤 admin

🔧 ต้องทำใน handler:

- [x] COUNT tasks ที่ใช้ status นี้ → 409 `STATUS_IN_USE` ถ้ามี
- [x] DELETE

---

#### `PUT /lists/:id/statuses/reorder`

📌 เรียงลำดับ status columns ใหม่ (drag & drop บน UI)
👤 member, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ ordered_ids: string[] }` — array ของ status_id ตามลำดับใหม่
- [x] ตรวจว่าทุก id อยู่ใน list นี้จริง
- [x] loop UPDATE `display_order = index` ทุก row ใน **transaction เดียว**

---

## ✅ Phase 3 — Task Management

> หัวใจของระบบ — ต้องการ Phase 1 + 2 ครบก่อน

### Tasks CRUD

---

#### `GET /tasks?list_id=&status_id=&assignee_id=&priority=&search=&page=&limit=&sort=`

📌 ดึง task ใน list นั้น ใช้ render Kanban view และ Table view
👤 member ของ space

🔧 ต้องทำใน handler:

- [x] require `?list_id=`
- [x] query tasks + JOIN statuses, task_types, assignee, creator
- [x] subquery count subtasks, comments
- [x] filter ตาม query params ทั้งหมด
- [x] default sort: `display_order ASC`
- [x] LIMIT/OFFSET pagination + return meta

---

#### `GET /tasks/my?range=today|week|month`

📌 ดึง task ที่ assign ให้ตัวเอง ใช้แสดงหน้า "My Tasks" ส่วนตัว
👤 ทุกคน (เห็นเฉพาะของตัวเอง)

🔧 ต้องทำใน handler:

- [x] WHERE `assignee_id = ctx.user.id` + `status NOT IN ('completed','cancelled')`
- [x] filter deadline ตาม `?range=` (today/week/month)
- [x] ORDER BY `deadline ASC NULLS LAST`

---

#### `GET /tasks/calendar?start=&end=`

📌 ดึง task ที่มี deadline หรือ plan อยู่ในช่วงนั้น ใช้แสดง calendar view
👤 ทุกคน (manager/admin เห็นทีม)

🔧 ต้องทำใน handler:

- [x] validate `start` และ `end` เป็น date
- [x] WHERE `deadline BETWEEN start AND end` OR `plan_start BETWEEN start AND end`
- [x] employee ธรรมดา → filter `assignee_id = ctx.user.id`
- [x] manager/admin → เห็นทีม

---

#### `GET /tasks/:id`

📌 ดูรายละเอียด task เต็ม รวม subtasks, ผู้รับผิดชอบ, comment count, attachment count
👤 member ของ space

🔧 ต้องทำใน handler:

- [x] query task + JOIN ทั้งหมด (status, type, assignee, creator, list)
- [x] aggregate subtasks เป็น JSON array
- [x] COUNT comments + attachments
- [x] ถ้าไม่เจอ → 404

---

#### `POST /tasks`

📌 สร้าง task ใหม่
👤 member ของ space

🔧 ต้องทำใน handler:

- [x] validate body: `{ title, list_id, list_status_id, priority, assignee_id, ... }`
- [x] generate `display_id = 'TK-' + LPAD(nextval('task_display_seq'), 6, '0')`
- [x] คำนวณ `plan_finish = plan_start + (duration_days - 1)` ถ้ามีทั้งคู่
- [x] INSERT `tasks` พร้อม `creator_id = ctx.user.id`, `status = 'pending'`
- [x] return task ที่สร้าง

---

#### `PUT /tasks/:id`

📌 แก้รายละเอียด task ทั้งหมด (full update)
👤 assignee, creator, manager, admin

🔧 ต้องทำใน handler:

- [x] validate body ครบ
- [x] recalculate `plan_finish` ถ้า plan_start หรือ duration_days เปลี่ยน
- [x] UPDATE + `updated_at = now()`

---

#### `PATCH /tasks/:id/status`

📌 เปลี่ยน status column ของ task (Kanban drag & drop หรือกด button)
👤 assignee, member, manager

🔧 ต้องทำใน handler:

- [x] validate body: `{ list_status_id, status? }`
- [x] UPDATE `list_status_id` + `status`
- [x] ถ้า status เปลี่ยนเป็น `in_progress` → set `started_at = now()` (เฉพาะครั้งแรก)
- [x] ถ้า status เปลี่ยนเป็น `completed` → set `completed_at = now()` (เฉพาะครั้งแรก)

---

#### `PUT /tasks/reorder`

📌 เรียงลำดับ task ใน column ใหม่ (drag & drop บน Kanban)
👤 member, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ list_id, status_id, ordered_task_ids: string[] }`
- [x] ตรวจว่า task ทุกตัวอยู่ใน list_id นั้น
- [x] loop UPDATE `display_order = index` ทุก task ใน **db.transaction()** ครอบทั้งหมด
- [x] rollback ถ้า error ตรงกลาง

---

#### `DELETE /tasks/:id`

📌 ยกเลิก task (soft delete — ไม่ลบจริง)
👤 creator, admin

🔧 ต้องทำใน handler:

- [x] UPDATE `status = 'cancelled', updated_at = now()`

---

### Subtasks

---

#### `GET /tasks/:id/subtasks`

📌 ดึง subtask ทั้งหมดของ task ใช้แสดงรายการ checklist ใน task detail
👤 member

🔧 ต้องทำใน handler:

- [x] query `subtasks LEFT JOIN employees (assignee)` WHERE `parent_task_id = :id`
- [x] ORDER BY `display_order`

---

#### `POST /tasks/:id/subtasks`

📌 เพิ่ม subtask (checklist item) ใน task
👤 member, assignee

🔧 ต้องทำใน handler:

- [x] validate body: `{ title, assignee_id? }`
- [x] `display_order = MAX + 1` ใน task นั้น
- [x] INSERT `subtasks`

---

#### `PUT /tasks/:id/subtasks/:subtask_id`

📌 แก้ชื่อ/ผู้รับผิดชอบ/ลำดับ subtask
👤 member

🔧 ต้องทำใน handler:

- [x] ตรวจว่า subtask_id อยู่ใน task_id นั้น
- [x] UPDATE

---

#### `PATCH /tasks/:id/subtasks/:subtask_id/toggle`

📌 ติ๊ก/ยกเลิกติ๊ก subtask ว่าเสร็จแล้วหรือยัง
👤 member

🔧 ต้องทำใน handler:

- [x] UPDATE `is_completed = NOT is_completed`
- [x] return state ใหม่

---

#### `DELETE /tasks/:id/subtasks/:subtask_id`

📌 ลบ subtask ออก
👤 member, admin

🔧 ต้องทำใน handler:

- [x] ตรวจว่า subtask_id อยู่ใน task_id นั้น
- [x] DELETE จริง

---

### Comments

---

#### `GET /tasks/:id/comments`

📌 ดึงความคิดเห็นทั้งหมดของ task เรียงจากเก่าไปใหม่
👤 member

🔧 ต้องทำใน handler:

- [x] query `task_comments JOIN employees (author)` WHERE `task_id = :id`
- [x] ORDER BY `created_at ASC`

---

#### `POST /tasks/:id/comments`

📌 เพิ่มความคิดเห็นใน task
👤 member

🔧 ต้องทำใน handler:

- [x] validate body: `{ comment_text }` (ห้ามว่าง)
- [x] INSERT พร้อม `author_id = ctx.user.id`

---

#### `PUT /tasks/:id/comments/:comment_id`

📌 แก้ความคิดเห็น (เฉพาะเจ้าของ comment)
👤 author ของ comment เท่านั้น

🔧 ต้องทำใน handler:

- [x] ตรวจว่า `author_id = ctx.user.id` → 403 ถ้าไม่ใช่
- [x] UPDATE `comment_text, updated_at = now()`

---

#### `DELETE /tasks/:id/comments/:comment_id`

📌 ลบความคิดเห็น
👤 author หรือ admin

🔧 ต้องทำใน handler:

- [x] ตรวจ permission (author หรือ role = admin)
- [x] DELETE

---

### Attachments

---

#### `GET /tasks/:id/attachments`

📌 ดูไฟล์แนบทั้งหมดของ task
👤 member

🔧 ต้องทำใน handler:

- [x] query `task_attachments JOIN employees (uploaded_by)` WHERE `task_id = :id`
- [x] ORDER BY `created_at DESC`

---

#### `POST /tasks/:id/attachments`

📌 แนบไฟล์เข้า task เช่น รูปภาพ, PDF, spec doc
👤 member

🔧 ต้องทำใน handler:

- [x] รับ `multipart/form-data`
- [x] validate: ขนาด ≤ 20MB, mime_type อยู่ใน whitelist (image/\*, application/pdf ฯลฯ)
- [x] upload ไปที่ Supabase Storage `task-attachments/{task_id}/{filename}`
- [x] INSERT `task_attachments` พร้อม url, size, mime, uploaded_by

---

#### `DELETE /tasks/:id/attachments/:attachment_id`

📌 ลบไฟล์แนบ
👤 ผู้อัปโหลด หรือ admin

🔧 ต้องทำใน handler:

- [x] ตรวจ permission
- [x] ลบไฟล์จาก Supabase Storage ก่อน
- [x] DELETE row จาก `task_attachments`

---

### Time Tracking

---

#### `POST /tasks/:id/time/start`

📌 เริ่มจับเวลาทำงานของ task นี้
👤 assignee

🔧 ต้องทำใน handler:

- [x] ตรวจว่ามี session ค้างอยู่ (ended_at IS NULL) สำหรับ user นี้ → 409 `SESSION_ALREADY_RUNNING` พร้อมบอก task_id ที่กำลังทำ
- [x] INSERT `task_time_sessions` พร้อม `started_at = now()`
- [x] UPDATE task `status = 'in_progress'`, set `started_at` ถ้ายังไม่มีค่า

---

#### `POST /tasks/:id/time/pause`

📌 หยุดพักชั่วคราว — บันทึกเวลาที่ทำไปแล้วสะสม
👤 assignee

🔧 ต้องทำใน handler:

- [x] UPDATE session ที่ `ended_at IS NULL` → set `ended_at = now()`, คำนวณ `duration_min`
- [x] UPDATE task `accumulated_minutes += duration_min`, recalculate `actual_hours`
- [x] UPDATE task `status = 'paused'`

---

#### `POST /tasks/:id/time/complete`

📌 ปิด task และบันทึกเวลาสุดท้าย
👤 assignee

🔧 ต้องทำใน handler:

- [x] ถ้ามี session ค้าง → ปิดก่อน (logic เหมือน pause)
- [x] UPDATE task `status = 'completed'`, `completed_at = now()`, คำนวณ `actual_hours` สุดท้าย

---

#### `GET /tasks/:id/time`

📌 ดูประวัติ time sessions ทั้งหมด เพื่อ audit หรือดู breakdown ว่าทำตอนไหนบ้าง
👤 assignee, manager, admin

🔧 ต้องทำใน handler:

- [x] query `task_time_sessions` WHERE `task_id = :id` ORDER BY `started_at DESC`

---

### Extension Requests (ขอขยายกำหนดส่ง)

---

#### `GET /tasks/:id/extension-requests`

📌 ดูรายการขอเลื่อนกำหนดส่งของ task นี้
👤 assignee, manager, admin

🔧 ต้องทำใน handler:

- [x] query `due_extension_requests JOIN employees (requester + reviewer)`
- [x] ORDER BY `created_at DESC`

---

#### `POST /tasks/:id/extension-requests`

📌 ขอเลื่อนกำหนดส่ง task พร้อมระบุเหตุผล
👤 assignee

🔧 ต้องทำใน handler:

- [x] validate body: `{ new_deadline, reason }`
- [x] ตรวจว่ามี request pending อยู่แล้วไหม → 409
- [x] ตรวจว่า `new_deadline > deadline` ปัจจุบัน → 400 ถ้าไม่ใช่
- [x] generate `display_id = 'EX-' + LPAD(nextval, 6, '0')`
- [x] INSERT

---

#### `PATCH /extension-requests/:id/approve`

📌 อนุมัติคำขอเลื่อนกำหนดส่ง — deadline ของ task จะอัปเดตทันที
👤 manager ของ assignee หรือ admin

🔧 ต้องทำใน handler:

- [x] ตรวจ permission
- [x] UPDATE `extension_requests` SET `status = 'approved', reviewed_by, reviewed_at`
- [x] UPDATE `tasks` SET `deadline = new_deadline` จาก extension request นั้น

---

#### `PATCH /extension-requests/:id/reject`

📌 ปฏิเสธคำขอเลื่อนกำหนดส่ง พร้อมระบุเหตุผล
👤 manager, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ reject_reason }`
- [x] UPDATE `status = 'rejected'` + เหตุผล

---

#### `GET /extension-requests?status=pending`

📌 ดูรายการ extension requests ทั้งหมดที่รออนุมัติ (inbox ของ manager)
👤 manager, admin

🔧 ต้องทำใน handler:

- [x] query `due_extension_requests JOIN tasks JOIN employees`
- [x] filter `?status=` ถ้ามี
- [x] manager → filter เฉพาะ task ที่ assignee อยู่ในทีมตัวเอง

---

### Search

---

#### `GET /search?q=&types=task,space,employee&limit=`

📌 ค้นหาข้ามทุก entity ใช้สำหรับ global search bar ด้านบนของ app
👤 ทุกคน

🔧 ต้องทำใน handler:

- [x] validate `?q=` ต้องมีและยาวอย่างน้อย 2 ตัวอักษร
- [x] UNION query: tasks (ILIKE title) + employees (ILIKE name) + spaces (ILIKE name)
- [x] filter ตาม `?types=` ที่ส่งมา (ถ้าไม่ส่ง = ค้นทุก type)
- [x] return รวมกัน จำกัด `?limit=` (default 10)
- [x] ต้องเร็ว < 300ms — ใช้ index ที่ทำไว้

---

## 🏖️ Phase 4 — HR System ✅ (Completed)

> ต้องการ Phase 1 (employees, holidays) ก่อน

### Leave Requests (การลา)

---

#### `GET /leave-requests?employee_id=&status=&year=&month=`

📌 ดูรายการขอลาทั้งหมด ใช้สำหรับหน้า HR Dashboard และประวัติการลาของตัวเอง
👤 ตัวเอง (เห็นแค่ของตัวเอง) / manager, admin (เห็นได้ตาม filter)

🔧 ต้องทำใน handler:

- [x] ถ้า role = employee → force `employee_id = ctx.user.id`
- [x] filter status, year, month ถ้ามี
- [x] JOIN employees + reviewer
- [x] LIMIT/OFFSET pagination

---

#### `GET /leave-requests/:id`

📌 ดูรายละเอียดการลา 1 รายการ
👤 เจ้าของ, manager, admin

🔧 ต้องทำใน handler:

- [x] ตรวจ permission
- [x] query + JOIN

---

#### `POST /leave-requests`

📌 ยื่นขอลา — ระบบจะตรวจโควตาและนับวันทำงานจริงให้อัตโนมัติ
👤 ทุกคน (ขอลาเอง)

🔧 ต้องทำใน handler:

- [x] validate body: `{ leave_type, start_date, end_date, reason, medical_certificate_url? }`
- [x] ตรวจ `start_date <= end_date`
- [x] เรียก working-days logic นับวันทำงานจริงในช่วงนั้น (ข้าม weekend + วันหยุด)
- [x] query โควตาคงเหลือ → ถ้าไม่พอ → 400 `QUOTA_EXCEEDED`
- [x] generate `display_id = 'LR-' + LPAD(nextval, 6, '0')`
- [x] INSERT `leave_requests` พร้อม `total_days = working_days, status = 'pending'`

---

#### `PATCH /leave-requests/:id/approve`

📌 อนุมัติการลา — ตัดโควตาและสร้าง attendance log ทันที
👤 manager, admin

🔧 ต้องทำใน handler:

- [x] ตรวจ permission + status ต้องเป็น 'pending'
- [x] UPDATE `leave_requests` status = 'approved'
- [x] UPDATE `leave_quotas` → `used_days += total_days`
- [x] loop INSERT `attendance_logs` ทุกวันทำงานในช่วงลา (ข้าม weekend + วันหยุด) พร้อม `status = 'leave'`

---

#### `PATCH /leave-requests/:id/reject`

📌 ปฏิเสธการลา พร้อมระบุเหตุผล
👤 manager, admin

🔧 ต้องทำใน handler:

- [x] validate body: `{ reject_reason }`
- [x] UPDATE status = 'rejected' + เหตุผล + reviewer

---

#### `PATCH /leave-requests/:id/cancel`

📌 ยกเลิกการขอลา
👤 เจ้าของ (ก่อนอนุมัติ), admin (หลังอนุมัติ — ต้องคืนโควตาด้วย)

🔧 ต้องทำใน handler:

- [x] ถ้า status = 'pending' → employee ยกเลิกเองได้
- [x] ถ้า status = 'approved' → ต้องเป็น admin + UPDATE `leave_quotas` คืน `used_days`
- [x] UPDATE status = 'cancelled'

---

### Leave Quotas (โควตาการลา)

---

#### `GET /leave-quotas/me?year=`

📌 ดูโควตาการลาคงเหลือของตัวเอง ใช้แสดงในหน้าขอลา
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [x] query `leave_quotas` WHERE `employee_id = ctx.user.id AND year = ?`
- [x] return `{ leave_type, quota_days, used_days, remaining_days }` ทุก type

---

#### `GET /leave-quotas?employee_id=&year=`

📌 ดูโควตาการลาของพนักงานทุกคน สำหรับ HR วางแผนและตรวจสอบ
👤 HR, admin

🔧 ต้องทำใน handler:

- [x] query `leave_quotas JOIN employees`
- [x] filter employee_id ถ้ามี, default year = ปีปัจจุบัน

---

#### `PUT /leave-quotas/:employee_id`

📌 ตั้งหรือแก้โควตาการลาของพนักงาน (ใช้ต้นปีหรือกรณีพิเศษ)
👤 admin, HR

🔧 ต้องทำใน handler:

- [x] validate body: `{ year, leave_type, quota_days }`
- [x] INSERT ... ON CONFLICT (employee_id, year, leave_type) DO UPDATE SET quota_days

---

### Attendance (บันทึกเข้า-ออกงาน)

---

#### `POST /attendance/check-in`

📌 บันทึกเข้างานประจำวัน — ระบบตรวจว่าสายหรือไม่อัตโนมัติ
👤 ทุกคน (บันทึกของตัวเอง)

🔧 ต้องทำใน handler:

- [x] ตรวจว่าวันนี้ check-in ไปแล้วไหม → 409 `ALREADY_CHECKED_IN`
- [x] เปรียบ `now()::time > '09:00'` → status = 'late' หรือ 'present'
- [x] INSERT หรือ UPDATE `attendance_logs` (ON CONFLICT work_date)

---

#### `POST /attendance/check-out`

📌 บันทึกออกงาน
👤 ทุกคน

🔧 ต้องทำใน handler:

- [x] ตรวจว่ามี check-in วันนี้ → 400 ถ้าไม่มี
- [x] ตรวจว่ายัง check-out ไม่ → 409 ถ้า check-out แล้ว
- [x] UPDATE `check_out = now()`
- [x] return รวม `total_hours`

---

#### `GET /attendance/today`

📌 ดูสถานะวันนี้ของตัวเอง (check-in แล้วยัง / กี่โมง)
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [x] query `attendance_logs` WHERE `employee_id = ctx.user.id AND work_date = CURRENT_DATE`

---

#### `GET /attendance?employee_id=&month=&year=` ✅

📌 ดูประวัติการเข้างานรายเดือน สำหรับ HR ออกรายงานหรือตรวจสอบ
👤 HR, admin (เห็นทุกคน) / employee (เห็นของตัวเอง)

🔧 ต้องทำใน handler:

- [x] ถ้า role = employee → force `employee_id = ctx.user.id`
- [x] query JOIN employees, filter month + year
- [x] return เรียงตาม work_date DESC

---

#### `GET /attendance/team?date=` ✅

📌 ดูสถานะการเข้างานของทีม วันที่ระบุ (default วันนี้) สำหรับ manager ดูภาพรวม
👤 manager

🔧 ต้องทำใน handler:

- [x] WHERE `employees.manager_id = ctx.user.id`
- [x] LEFT JOIN `attendance_logs` วันที่ระบุ
- [x] LEFT JOIN `leave_requests` ที่ approved และวันนั้นอยู่ในช่วงลา
- [x] return พร้อมสถานะแต่ละคน (present / late / leave / absent)

---

## 📊 Phase 5 — Performance & Analytics

> ต้องการ Phase 1, 3, 4 ครบก่อน

### Performance Config

---

#### `GET /performance-config/me`

📌 ดู config ประสิทธิภาพของตัวเอง เช่น schedule, target points ที่ถูกกำหนดไว้
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] query `employee_performance_config JOIN work_schedules` WHERE `employee_id = ctx.user.id`

---

#### `GET /performance-config/:employee_id`

📌 ดู config ของพนักงานคนใดคนหนึ่ง
👤 manager, admin

🔧 ต้องทำใน handler:

- [ ] ตรวจ permission
- [ ] query เหมือน `/me`

---

#### `POST /performance-config`

📌 ตั้งค่า performance config ให้พนักงาน (สร้างใหม่หรืออัปเดตถ้ามีอยู่แล้ว)
👤 admin, manager

🔧 ต้องทำใน handler:

- [ ] validate body: `{ employee_id, work_schedule_id, expected_ratio, pointed_work_percent, point_target?, point_period? }`
- [ ] INSERT ... ON CONFLICT (employee_id) DO UPDATE — upsert

---

### Analytics

---

#### `GET /analytics/performance?employee_id=&period=&start=&end=`

📌 ดูสรุปผลงาน — งานที่ได้รับ / กำลังทำ / เสร็จแล้ว / points
👤 ตัวเอง, manager (ดูทีม), admin

🔧 ต้องทำใน handler:

- [ ] aggregate COUNT และ SUM จาก `tasks` ในช่วงเวลานั้น
- [ ] filter `employee_id` ถ้ามี (employee เห็นแค่ตัวเอง)

---

#### `GET /analytics/velocity?employee_id=&weeks=`

📌 ดู velocity ย้อนหลัง N สัปดาห์ — ใช้ render กราฟแนวโน้ม
👤 manager, admin

🔧 ต้องทำใน handler:

- [ ] query `weekly_reports` ย้อนหลัง `?weeks=` สัปดาห์
- [ ] return `week_start, tasks_done, expected_points, actual_points, performance_ratio`

---

#### `GET /analytics/efficiency?period=`

📌 วิเคราะห์ความแม่นยำในการ estimate เวลาของแต่ละคน
👤 manager, admin

🔧 ต้องทำใน handler:

- [ ] query tasks ที่ `status = 'completed'` และมี `time_estimate_hours > 0`
- [ ] GROUP BY employee คำนวณ `avg_estimate`, `avg_actual`, `accuracy_pct`
- [ ] filter ตาม period (default เดือนปัจจุบัน)

---

#### `GET /analytics/bottleneck`

📌 หา status column ที่ task ค้างอยู่นานที่สุด เพื่อหา bottleneck ใน workflow
👤 manager, admin

🔧 ต้องทำใน handler:

- [ ] query tasks ที่ยัง active JOIN list_statuses
- [ ] GROUP BY status คำนวณ `AVG(days since updated_at)`
- [ ] ORDER BY avg_days DESC

---

#### `GET /analytics/team-workload`

📌 ดู workload ของแต่ละคนในทีม ว่าใครแบกงานอยู่เท่าไร
👤 manager, admin

🔧 ต้องทำใน handler:

- [ ] query employees ในทีม LEFT JOIN tasks ที่ active
- [ ] GROUP BY employee นับ `active_tasks`, sum `active_points`, sum `estimate_hours`
- [ ] ORDER BY active_points DESC

---

### Reports

---

#### `GET /reports/weekly?employee_id=&week=`

📌 ดูรายงานประจำสัปดาห์ (สร้างโดยระบบอัตโนมัติ) — เห็น rank และ actual vs expected
👤 ตัวเอง, manager, admin

🔧 ต้องทำใน handler:

- [ ] query `weekly_reports JOIN employees` สำหรับสัปดาห์ที่ระบุ
- [ ] default `week = DATE_TRUNC('week', now())`

---

#### `GET /reports/weekly/team?week=`

📌 ดูรายงานสัปดาห์ของทีม เรียงตาม rank
👤 manager

🔧 ต้องทำใน handler:

- [ ] query `weekly_reports JOIN employees` WHERE `employees.manager_id = ctx.user.id`
- [ ] default สัปดาห์ที่แล้ว (เพราะสัปดาห์นี้ยังไม่จบ)
- [ ] ORDER BY rank ASC NULLS LAST

---

#### `POST /reports/weekly/generate`

📌 trigger สร้างรายงานสัปดาห์ด้วยตนเอง (ปกติ cron job ทำให้ทุกจันทร์)
👤 admin

🔧 ต้องทำใน handler:

- [ ] validate body: `{ week_start?, employee_id? }`
- [ ] aggregate ข้อมูลจาก tasks + attendance ของสัปดาห์นั้น
- [ ] INSERT หรือ UPSERT `weekly_reports`

---

#### `GET /reports/monthly-hr?employee_id=&year=&month=`

📌 ดูรายงาน HR รายเดือน — วันลา, วันเข้างาน, late count สำหรับ payroll
👤 HR, admin

🔧 ต้องทำใน handler:

- [ ] query `monthly_hr_reports JOIN employees`
- [ ] filter ตาม employee_id, year, month

---

## 🔧 Phase 6 — Profile, Notifications & Admin

### Profile

---

#### `GET /profile`

📌 ดูโปรไฟล์ตัวเอง — เหมือน `/employees/:id` แต่ใช้ token แทน id
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] ดึง `id` จาก `ctx.user.id`
- [ ] query เหมือน `GET /employees/:id`

---

#### `PUT /profile`

📌 แก้ชื่อหรือ email ของตัวเอง
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] อนุญาตแก้แค่ `name` และ `email` (ไม่ให้แก้ role/department ตัวเอง)
- [ ] ถ้าแก้ email → ตรวจซ้ำกับคนอื่น

---

#### `GET /profile/my-tasks`

📌 shortcut หน้า My Tasks — ใช้ logic เดียวกับ `/tasks/my`
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] เรียก logic เดียวกับ `GET /tasks/my` โดยใช้ `ctx.user.id` เป็น assignee

---

#### `GET /profile/performance`

📌 shortcut หน้า performance ส่วนตัว — ใช้ logic เดียวกับ `/analytics/performance`
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] เรียก logic เดียวกับ `GET /analytics/performance?employee_id=ctx.user.id`

---

### Notifications

---

#### `GET /notifications?unread=&page=`

📌 ดูการแจ้งเตือน เช่น task ถูก assign / leave request อนุมัติ / deadline ใกล้
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] query `notification_logs LEFT JOIN tasks` WHERE `employee_id = ctx.user.id`
- [ ] filter `?unread=true` → WHERE `is_read = false`
- [ ] ORDER BY `created_at DESC`

---

#### `PATCH /notifications/:id/read`

📌 mark notification ว่าอ่านแล้ว
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] ตรวจว่า `employee_id = ctx.user.id` → 403 ถ้าไม่ใช่
- [ ] UPDATE `is_read = true`

---

#### `PATCH /notifications/read-all`

📌 mark ทุก notification ว่าอ่านแล้วในคลิกเดียว
👤 ตัวเอง

🔧 ต้องทำใน handler:

- [ ] UPDATE `is_read = true` WHERE `employee_id = ctx.user.id AND is_read = false`

---

### Audit Logs

---

#### `GET /audit-logs?actor_id=&table_name=&action=&from=&to=`

📌 ดู log การกระทำทุกอย่างในระบบ เพื่อ audit และ debug
👤 admin เท่านั้น

🔧 ต้องทำใน handler:

- [ ] ตรวจ role = admin → 403 ถ้าไม่ใช่
- [ ] query `audit_logs LEFT JOIN employees (actor)` พร้อม filter ทุก param
- [ ] return พร้อม before_data + after_data (JSON diff)
- [ ] LIMIT/OFFSET pagination

---

## 🧪 Phase 7 — Testing Checklist

### Auth & Security

- [ ] Login ด้วย email/password ผิด → 401 `INVALID_CREDENTIALS`
- [ ] เรียก API โดยไม่มี token → 401 `MISSING_TOKEN`
- [ ] Token หมดอายุ → 401 `TOKEN_EXPIRED`
- [ ] User ไม่มี permission `manage_users` สร้าง employee → 403
- [ ] User ดูข้อมูล employee นอกทีม → 403

### Master Data

- [ ] สร้าง role + assign permission → login แล้วมี permission ถูกต้อง
- [x] สร้าง employee → `leave_quotas` 3 rows สร้างอัตโนมัติ
- [ ] ลบ role ที่มี employee ใช้ → 409 `ROLE_IN_USE`
- [ ] ลบ task_type ที่มี task ใช้ → 409 `TASK_TYPE_IN_USE`
- [ ] `GET /holidays/working-days` ช่วงที่มีวันหยุด → นับถูกต้อง

### Workspace

- [ ] สร้าง list → default 5 statuses สร้างอัตโนมัติ
- [ ] Reorder status → display_order ถูกต้องทุก row
- [ ] ลบ status ที่มี task → 409 `STATUS_IN_USE`

### Tasks

- [ ] สร้าง task → display_id เรียงลำดับถูก (TK-000001, TK-000002...)
- [ ] `plan_start` + `duration_days` → `plan_finish` คำนวณถูก
- [ ] `PATCH /status` → `started_at` / `completed_at` อัปเดตถูกต้อง
- [ ] Reorder tasks → ใช้ transaction, rollback ถ้า error กลางทาง
- [ ] Time: start → pause → start → complete → `accumulated_minutes` สะสมถูก
- [ ] Start task ที่มี session ค้าง → 409 `SESSION_ALREADY_RUNNING`

### HR

- [ ] ขอลาเกินโควตา → 400 `QUOTA_EXCEEDED`
- [ ] อนุมัติลา → `used_days` อัปเดต + `attendance_logs` ครบทุกวันทำงาน
- [ ] ลาช่วงที่มีวันหยุดราชการ → ไม่นับวันนั้น
- [ ] Check-in ซ้ำในวันเดียวกัน → 409 `ALREADY_CHECKED_IN`
- [ ] Check-in หลัง 09:00 → `status = 'late'`

### Analytics

- [ ] `GET /analytics/performance` → ตัวเลข aggregate ตรงกับ tasks จริง
- [ ] `GET /analytics/velocity` → ได้ข้อมูลย้อนหลัง N สัปดาห์
- [ ] `GET /reports/weekly/team` → เรียง rank ถูก

---

## 📅 Timeline แนะนำ (8 สัปดาห์)

| Week   | งาน                                                                                     |
| ------ | --------------------------------------------------------------------------------------- |
| Week 1 | Phase 0: DB + Sequences + Seed + Auth endpoints + response.ts + validate.ts             |
| Week 2 | Phase 1: Roles → Positions → Employees → Work Schedules → Holidays → Task Types         |
| Week 3 | Phase 2: Spaces + Members → Folders → Lists + Statuses                                  |
| Week 4 | Phase 3-A: Tasks CRUD + Phase 3-G: Search                                               |
| Week 5 | Phase 3-B–F: Subtasks → Comments → Attachments → Time Tracking → Extension Requests     |
| Week 6 | Phase 4: Leave Requests → Leave Quotas → Attendance                                     |
| Week 7 | Phase 5: Performance Config → Analytics ทุกเส้น → Reports                               |
| Week 8 | Phase 6: Profile + Notifications + Audit Logs → Phase 7: Testing ครบ → Load test → Docs |

---

> **Tips สำหรับ Hono:**
>
> - ใช้ `@hono/zod-validator` validate body/query ก่อนถึง handler: `app.post('/tasks', zValidator('json', schema), handler)`
> - ใช้ `c.get('user')` ดึง user หลัง auth middleware inject
> - ใช้ `db.transaction(async (tx) => { ... })` ของ Drizzle ครอบ operation ที่ต้องทำพร้อมกัน
> - แยกไฟล์ตาม domain: `const tasks = new Hono(); app.route('/tasks', tasks)`
> - ใช้ `HTTPException` ของ Hono throw error แทน return: `throw new HTTPException(404, { message: 'Not found' })`

---

_Last updated: April 2026 | Stack: Hono + Drizzle ORM + PostgreSQL_
