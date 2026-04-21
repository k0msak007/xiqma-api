# 🚀 Phase 2 — CRM Backend API (Todo Checklist)

> **Stack:** Hono + TypeScript + Drizzle ORM + PostgreSQL (Supabase) — ต่อยอดจาก Phase 1
> **สัญลักษณ์:** 📌 ทำอะไร | 👤 ใครใช้ | 🔧 Handler logic | 📥 I/O shape
> **อ้างอิง FE:** ข้อมูล mock กลางอยู่ที่ `xiqma-client/lib/crm-mock.ts` — ใช้เป็น reference สำหรับ field shape

---

## 📊 ภาพรวม Sub-Phases

| Sub-phase | หัวข้อ | จำนวน endpoint | Dependency |
| --- | --- | --- | --- |
| 2.0 | Infrastructure & Permissions | setup + 0 endpoints | Phase 1 done |
| 2.0.5 | DB Patch (notification polymorphic, script 004) | — | 2.0 |
| 2.1 | Schema & Migrations (12 tables, script 003) | — | 2.0.5 |
| 2.2 | Master Data (Products + Config) | 12 endpoints | 2.1 |
| 2.3 | Leads API | 8 endpoints | 2.1, 2.2 |
| 2.4 | Accounts API | 8 endpoints | 2.1 |
| 2.5 | Contacts API | 9 endpoints | 2.4 |
| 2.6 | Opportunities API | 10 endpoints | 2.4, 2.5, 2.2 |
| 2.7 | Quotations API | 10 endpoints | 2.6 |
| 2.8 | Activities API | 8 endpoints | 2.3–2.6 |
| 2.9 | Dashboard & Analytics | 7 endpoints | ทุกอัน |
| 2.10 | Notifications & SLA | 3 endpoints | 2.3, 2.6 |
| 2.11 | FE Integration (replace mock) | — | ทุกอัน |
| 2.12 | Testing & Seed | — | ทุกอัน |
| **รวม** | | **~75 endpoints** | |

---

## 🎯 การตัดสินใจที่ล็อกไว้จาก Phase FE

- **Permissions:** 3 ระดับ → `crm_view` / `crm_manage` / `crm_admin` (admin เห็นทุกอย่างตามระบบเดิม)
- **PDF ใบเสนอราคา:** Puppeteer (server-side, render HTML → PDF)
- **SLA Alert:** ใช้ notification system เดิม (`bot_sessions` / `notifications`) + LINE bot เสริม
- **Activities ↔ Tasks:** แยก namespace ถาวร — ไม่ auto-sync. `crm_activities` = กิจกรรมที่ผูกกับ CRM entity, `tasks` = งานภายในองค์กร (kanban/time-tracking). ดู Sub-phase 2.8
- **Notification system:** ใช้ `notification_logs` เดิม แต่ refactor เป็น **polymorphic** (`related_type` + `related_id`) ใน Sub-phase 2.0.5 — รองรับทั้ง Task และ CRM entities
- **Row-level scope:** เห็นเฉพาะ `owner_id === user.id` หรืออยู่ใน manager chain; `crm_manage` เห็นทั้งทีม; admin เห็นหมด
- **Lead scoring:** manual ใน Phase 2 — auto-scoring ยก Phase 3

---

## ⚙️ Sub-phase 2.0 — Infrastructure & Permissions

> เตรียมพื้นฐานก่อนเขียน schema/handlers

### Permissions Seed

- [ ] เพิ่ม 3 permission keys ลง `roles.permissions` seed

  > `crm_view`, `crm_manage`, `crm_admin` — คล้าย pattern ของ `view_analytics`, `manage_users`

- [ ] สร้าง migration/seed script เพิ่ม role ใหม่ (ถ้ายังไม่มี)

  > Suggested roles: `sales_rep` (crm_view), `sales_manager` (crm_view + crm_manage), และเพิ่ม `crm_admin` ลง role `admin` อัตโนมัติ

- [ ] Update middleware `requirePermission(['crm_view'])` helper

  > ใช้ helper เดิม — แค่ยืนยันว่ารองรับ permission array

### Environment & Config

- [ ] เพิ่ม env vars:
  ```
  CRM_FILE_STORAGE_PATH=/crm-files   # หรือ bucket name ใน Supabase Storage
  CRM_PDF_TEMPLATE_PATH=./templates/quotation.html
  CRM_SLA_DEFAULT_MINUTES=60          # SLA default สำหรับ Lead ใหม่
  ```

- [ ] ติดตั้ง dependencies:
  ```bash
  bun add puppeteer-core @sparticuz/chromium   # ถ้า deploy บน serverless
  bun add nanoid                                # generate quotation number
  ```

### Utility helpers ที่ต้องมี

- [ ] `src/lib/crm-scope.ts` → function `scopeByOwner(userId, permission)` คืน Drizzle where-clause
- [ ] `src/lib/sla.ts` → คำนวณ `slaRemaining` จาก `created_at` + `sla_default_minutes`

---

## 🧩 Sub-phase 2.0.5 — DB Patch (prerequisite สำหรับ CRM)

> **ทำก่อน 2.1** — เป็น blocker ของ 2.10 (notifications) และทำให้ schema เดิม/ใหม่ทำงานร่วมกันได้

### Migration file: `src/db/scripts/004_Notification_Polymorphic.sql`

- [ ] Run script 004 (หลัง 001/003, ก่อน handler ใดๆ)
- [ ] เพิ่ม enum `notif_related_type` (`Task`, `Lead`, `Contact`, `Account`, `Opportunity`, `Quotation`)
- [ ] Extend `notif_type` enum ด้วย CRM values:
  `crm_lead_assigned`, `crm_sla_warning`, `crm_quotation_pending_approval`,
  `crm_quotation_approved`, `crm_quotation_rejected`,
  `crm_opportunity_won`, `crm_opportunity_lost`,
  `crm_activity_assigned`, `crm_activity_due`
- [ ] ALTER `notification_logs` → ADD `related_type`, `related_id`
- [ ] Backfill: ทุกแถวเดิมที่มี `task_id` → `related_type='Task'`, `related_id=task_id`
- [ ] Index `(related_type, related_id)`
- [ ] คง column `task_id` ไว้ชั่วคราว (backward compat) — drop ใน future migration หลัง Phase 1 handlers เปลี่ยนเสร็จ

### Handler impact

- [ ] เขียน notification helper ให้รับ `{ relatedType, relatedId }` แทน `taskId`
- [ ] Phase 1 task notification code: map `taskId` → `{ relatedType:'Task', relatedId:taskId }`
- [ ] อัปเดต Drizzle schema `notification_logs.ts` ให้มี 2 columns ใหม่

> ⚠️ **ทำไมต้อง polymorphic:** ถ้าไม่ทำ, CRM noti จะเขียนตาราง `notification_logs` ไม่ได้เลย (column `task_id` จะค้าง NULL ทุกแถว CRM → query/FK สับสน)

---

## 🗄️ Sub-phase 2.1 — Schema & Migrations (12 ตาราง)

> ทุกตาราง prefix `crm_` เพื่อ namespace แยกชัด

> **Source of truth:** `src/db/scripts/003_CRM_Schema.sql` — ตาราง/คอลัมน์/index/trigger ทั้งหมดอยู่ที่นั่น
> เอกสารนี้ไม่ลอก schema ซ้ำ (ป้องกัน stale) — ถ้าจะแก้ structure **แก้ที่ 003 เท่านั้น**

### Drizzle schema files (TypeScript mirror ของ 003)

- [ ] `src/schema/crm-leads.ts`
- [ ] `src/schema/crm-accounts.ts`
- [ ] `src/schema/crm-contacts.ts`
- [ ] `src/schema/crm-products.ts`
- [ ] `src/schema/crm-opportunities.ts`
- [ ] `src/schema/crm-quotations.ts`
- [ ] `src/schema/crm-activities.ts`
- [ ] `src/schema/crm-junction.ts` (M:N: contact-products, opp-products, activity-attachments, product-files, quotation-line-items)

### Key rules ที่ต้อง enforce ใน handler (ไม่มี DB constraint)

- [ ] `crm_activities.related_to_id` polymorphic → validate ว่ามีจริงใน table ตาม `related_to_type`
- [ ] `crm_opportunities.stage` เปลี่ยน → `probability` sync อัตโนมัติโดย trigger (ดู 003) → handler ไม่ต้อง set เอง
- [ ] `crm_quotations.quotation_number` auto-gen ผ่าน DEFAULT → handler แค่ INSERT RETURNING
- [ ] Soft-delete: ทุก SELECT ต้องมี `WHERE deleted_at IS NULL` (ยกเว้น admin audit views)
- [ ] **Cache columns — ใครเป็นคน update:**
  - `crm_contacts.last_activity_at` → handler `POST /activities/:id/complete` + `POST /activities` (update related contact ถ้า type='Contact')
  - `crm_opportunities.last_activity_date` + `has_next_activity` → handler เดียวกัน (ถ้า related_type='Opportunity') + recalc `has_next_activity` จาก `activity_date > today` AND `completed=false`
  - `crm_accounts.lifetime_value` → handler `POST /quotations/:id/accept` (sum ของ accepted quotations)
  - `crm_contacts.email_opens` / `web_visits` → Phase 3 (webhook จาก email/analytics tool)

### Migration Steps

- [ ] Run `003_CRM_Schema.sql` บน dev DB (หลัง 004 ของ 2.0.5 แล้ว)
- [ ] `bun drizzle-kit introspect` → generate TS schema จาก DB (แล้ว hand-tune เป็น 8 ไฟล์ข้างต้น)
- [ ] ตรวจ diff กับ 003 ให้ 1:1
- [ ] Commit ทั้ง `.sql` และ `.ts` schema ลง repo

---

## 📦 Sub-phase 2.2 — Master Data API

> Products + config ต้องมีก่อน เพราะ Opportunities/Quotations/Contacts ผูกกับ Product

### Products

- [ ] **GET** `/api/crm/products` — List

  > 📌 แสดงรายการสินค้าพร้อม filter
  > 👤 `crm_view`
  > 🔧 query params: `category`, `isActive`, `search`, `page`, `limit` (default 20)
  > 📥 Response: `{ data: Product[], pagination: { page, total, totalPages } }`

- [ ] **GET** `/api/crm/products/:id`

  > 👤 `crm_view` — รวม files ที่แนบด้วย

- [ ] **POST** `/api/crm/products`

  > 👤 `crm_admin` only
  > 🔧 validate: code unique, unit_price > 0
  > 📥 Body: `{ code, name, category, description?, unitPrice, unit? }`

- [ ] **PATCH** `/api/crm/products/:id` — 👤 `crm_admin`

- [ ] **DELETE** `/api/crm/products/:id`

  > 👤 `crm_admin` — soft delete (`is_active = false`) ถ้ามี reference ใน opportunities/quotations

### Product Files

- [ ] **POST** `/api/crm/products/:id/files`

  > 📌 upload image/catalog/document
  > 👤 `crm_admin`
  > 🔧 multipart form, validate mime type + size (max 50MB), upload ไป Supabase Storage
  > 📥 Body: file + `fileType` (image/catalog/document)

- [ ] **GET** `/api/crm/products/:id/files` — list — 👤 `crm_view`

- [ ] **DELETE** `/api/crm/products/:id/files/:fileId` — 👤 `crm_admin`

### Config / Master Data (static เก็บใน DB หรือ config file)

- [ ] **GET** `/api/crm/config/lead-sources` — รายการ source สำหรับ dropdown
- [ ] **GET** `/api/crm/config/pipeline-stages` — stage + probability mapping
- [ ] **GET** `/api/crm/config/industries` — รายการ industry
- [ ] **GET** `/api/crm/config/sla` — SLA rules ปัจจุบัน

> Note: Phase 2 hard-code ได้ก่อน, Phase 3 ย้ายไปตาราง `crm_config` ให้ admin แก้จาก `/crm/settings`

---

## 🎣 Sub-phase 2.3 — Leads API

### Endpoints

- [ ] **GET** `/api/crm/leads`

  > 👤 `crm_view`
  > 🔧 apply `scopeByOwner` (เว้นถ้ามี `crm_manage`)
  > query: `temperature`, `source`, `status`, `search`, `ownerId`, `page`, `limit`
  > 📥 Response: `{ data: Lead[], pagination, summary: { hot, warm, cold, slaBreached } }`

- [ ] **GET** `/api/crm/leads/:id` — detail + activities relation

- [ ] **POST** `/api/crm/leads`

  > 👤 `crm_view` (sales rep สร้าง lead ของตัวเองได้)
  > 🔧 set `owner_id = auth.userId`, init `sla_remaining = CRM_SLA_DEFAULT_MINUTES`
  > 📥 Body (Zod): discriminated union `leadType: 'individual' | 'company'`

- [ ] **PATCH** `/api/crm/leads/:id`

  > 👤 `crm_view` (ตัวเอง) หรือ `crm_manage` (ทั้งทีม)
  > 🔧 ห้ามแก้ `converted_to_contact_id` manual

- [ ] **DELETE** `/api/crm/leads/:id` — soft delete — 👤 `crm_manage`

- [ ] **POST** `/api/crm/leads/:id/convert` 🔥

  > 📌 แปลง Lead → Contact (+ Opportunity optional)
  > 👤 `crm_view` (owner) หรือ `crm_manage`
  > 🔧 transaction:
  >   1. สร้าง `crm_contacts` row จากข้อมูล lead (match fields)
  >   2. ถ้า `leadType = 'company'` + ไม่มี account — สร้าง `crm_accounts` ใหม่
  >   3. ถ้ามี `createOpportunity: true` — สร้าง opportunity stage='qualification'
  >   4. update `lead.converted_to_contact_id` + `lead.converted_at`
  >   5. update `lead.status = 'Qualified'`
  > 📥 Body: `{ accountId?: number, createOpportunity?: boolean, opportunityValue?: number }`
  > 📥 Response: `{ contact, account?, opportunity? }`

- [ ] **GET** `/api/crm/leads/:id/activities`

  > 👤 `crm_view` — dispatch ไป activities module with `relatedToType='Lead'`

- [ ] **POST** `/api/crm/leads/:id/score`

  > 👤 `crm_view` — manual scoring (0-100)

---

## 🏢 Sub-phase 2.4 — Accounts API

- [ ] **GET** `/api/crm/accounts`

  > query: `type`, `industry`, `ownerId`, `search`
  > response รวม count: `contactCount`, `opportunityCount`, `quotationCount`

- [ ] **GET** `/api/crm/accounts/:id` — detail + nested contacts + opportunities (LIMIT 5 each)

- [ ] **POST** `/api/crm/accounts` — 👤 `crm_view`, owner = self

- [ ] **PATCH** `/api/crm/accounts/:id`

- [ ] **DELETE** `/api/crm/accounts/:id`

  > 👤 `crm_manage` — check no active opportunities before delete; soft delete

- [ ] **GET** `/api/crm/accounts/:id/contacts`

- [ ] **GET** `/api/crm/accounts/:id/opportunities` — filter by stage

- [ ] **GET** `/api/crm/accounts/:id/quotations` — filter by status

---

## 👥 Sub-phase 2.5 — Contacts API

- [ ] **GET** `/api/crm/contacts`

  > query: `accountId`, `temperature`, `ownerId`, `isPrimary`, `search`, pagination

- [ ] **GET** `/api/crm/contacts/:id` — detail + interested products + opportunities

- [ ] **POST** `/api/crm/contacts`

  > 🔧 ถ้า `is_primary=true` → set เก่า (ใน account เดียวกัน) เป็น false

- [ ] **PATCH** `/api/crm/contacts/:id`

- [ ] **DELETE** `/api/crm/contacts/:id` — soft delete

- [ ] **PUT** `/api/crm/contacts/:id/primary`

  > 📌 ตั้งเป็น primary contact ของ account
  > 🔧 transaction: unset primary เก่า, set ใหม่

- [ ] **POST** `/api/crm/contacts/:id/interested-products`

  > 📥 Body: `{ productId: number }`
  > 🔧 insert ลง `crm_contact_interested_products`, ignore duplicate

- [ ] **DELETE** `/api/crm/contacts/:id/interested-products/:productId`

- [ ] **GET** `/api/crm/contacts/:id/engagement`

  > 📌 summary: last_activity_at, email_opens, web_visits, activity count 30 วัน

---

## 🎯 Sub-phase 2.6 — Opportunities API

- [ ] **GET** `/api/crm/opportunities`

  > query: `stage`, `ownerId`, `accountId`, `minValue`, `maxValue`, date range
  > response รวม `totalPipelineValue`

- [ ] **GET** `/api/crm/opportunities/:id` — detail + line products + activities + quotations

- [ ] **POST** `/api/crm/opportunities`

  > 🔧 default stage='qualification', probability=10
  > 📥 `{ name, contactId, accountId?, value, expectedCloseDate?, products?: [{productId, quantity, unitPrice}] }`

- [ ] **PATCH** `/api/crm/opportunities/:id`

- [ ] **PATCH** `/api/crm/opportunities/:id/stage** 🔥

  > 📌 change stage — เปลี่ยนแปลง probability อัตโนมัติ
  > 🔧 valid transitions: qualification ↔ proposal ↔ negotiation → closed_won/lost
  > 🔧 log เป็น activity type='note' (audit)
  > 🔧 ถ้า → closed_won/lost → block future edits unless `crm_admin`

- [ ] **DELETE** `/api/crm/opportunities/:id` — soft delete, 👤 `crm_manage`

- [ ] **POST** `/api/crm/opportunities/:id/products** — add product line

- [ ] **PATCH** `/api/crm/opportunities/:id/products/:lineId** — update qty/price

- [ ] **DELETE** `/api/crm/opportunities/:id/products/:lineId**

- [ ] **GET** `/api/crm/opportunities/:id/activities** — relay to activities module

---

## 📄 Sub-phase 2.7 — Quotations API

> **Quotation number generation:** DB-level ผ่าน `DEFAULT` + `crm_quotation_seq` (ดู 003)
> Handler แค่ `INSERT ... RETURNING quotation_number` — ไม่ต้อง generate เอง, atomic อยู่แล้ว

### CRUD + Workflow

- [ ] **POST** `/api/crm/quotations`

  > 📌 สร้าง draft quotation
  > 🔧 `quotation_number` ถูก generate อัตโนมัติโดย DB DEFAULT (ดู note ด้านบน) — handler INSERT แล้ว RETURNING เท่านั้น
  > 🔧 init status='draft', copy line items จาก opportunity (optional)
  > 📥 `{ opportunityId, lineItems?: [...], validUntil?, notes? }`

- [ ] **GET** `/api/crm/quotations` — filter status, opportunity, date

- [ ] **GET** `/api/crm/quotations/:id` — detail + line items + approvals log

- [ ] **PATCH** `/api/crm/quotations/:id`

  > 🔧 **editable เฉพาะ status=draft**, อื่นๆ 403

- [ ] **POST** `/api/crm/quotations/:id/submit`

  > 📌 ส่งไปรออนุมัติ: draft → pending_approval
  > 🔧 trigger notification ไปหา manager ของ owner

- [ ] **POST** `/api/crm/quotations/:id/approve`

  > 👤 `crm_manage`
  > 🔧 status → approved, set `approved_by`, `approved_date`

- [ ] **POST** `/api/crm/quotations/:id/reject` — 👤 `crm_manage`, ต้องใส่ reason

- [ ] **POST** `/api/crm/quotations/:id/send`

  > 📌 ส่งให้ลูกค้า (status: approved → sent)
  > 🔧 ถ้ามี contact email → ส่ง email พร้อม PDF (Phase 3)
  > 🔧 ตอนนี้แค่ update status + log

- [ ] **POST** `/api/crm/quotations/:id/accept` — บันทึกว่าลูกค้ารับ (sent → accepted) + auto-update opportunity → closed_won

- [ ] **POST** `/api/crm/quotations/:id/pdf`

  > 📌 generate PDF
  > 🔧 render `templates/quotation.html` ด้วย data จาก DB, Puppeteer → PDF buffer, อัปโหลดเก็บใน Supabase Storage, return signed URL
  > 📥 Response: `{ pdfUrl: string, expiresAt: ISO }`

### Line Items

- [ ] **POST** `/api/crm/quotations/:id/line-items** — add (editable เฉพาะ draft)
- [ ] **PATCH** `/api/crm/quotations/:id/line-items/:itemId**
- [ ] **DELETE** `/api/crm/quotations/:id/line-items/:itemId**

> 🔧 ทุกครั้งที่แก้ line item → recalc `subtotal/tax/total` ที่ quotation level

---

## 📞 Sub-phase 2.8 — Activities API

> **กฎ Tasks vs CRM Activity type='task':**
> - `tasks` (Phase 1) = **งานภายใน** ที่พนักงานต้องทำ (มี kanban, time tracking, extensions, SLA)
> - `crm_activities` type=`task` = **งานที่เกี่ยวข้องกับ CRM entity** (Lead/Contact/Opp/Account) เช่น "โทรตามลูกค้า X"
> - ❌ ไม่ auto-sync ระหว่าง 2 ระบบ (ต่างเจตนา, ต่าง workflow)
> - ✅ ถ้า user อยาก track CRM activity ใน kanban → สร้าง `task` แยก แล้ว reference activity_id ใน description (manual link)
> - เอกสารใน `docs/crm/tasks-vs-activities.md` ก่อนเปิด endpoint

### Core (polymorphic)

- [ ] **GET** `/api/crm/activities`

  > query: `relatedToType`, `relatedToId`, `type`, `assignedTo`, `dateFrom`, `dateTo`, `completed`
  > pagination

- [ ] **GET** `/api/crm/activities/:id`

- [ ] **POST** `/api/crm/activities`

  > 🔧 validate `related_to_id` exists ใน table ที่ตรงกับ `related_to_type`
  > 🔧 ถ้า type=meeting/call → default duration_minutes=30
  > 📥 `{ activityType, subject, notes?, relatedToType, relatedToId, activityDate, activityTime?, durationMinutes?, assignedTo? }`

- [ ] **PATCH** `/api/crm/activities/:id`

- [ ] **DELETE** `/api/crm/activities/:id`

- [ ] **POST** `/api/crm/activities/:id/complete**

  > 🔧 set completed=true, completed_date=NOW()
  > 🔧 update related entity `last_activity_at`

### Attachments

- [ ] **POST** `/api/crm/activities/:id/attachments** — multipart upload

- [ ] **DELETE** `/api/crm/activities/:id/attachments/:attachmentId**

---

## 📊 Sub-phase 2.9 — Dashboard & Analytics

- [ ] **GET** `/api/crm/dashboard/stats`

  > 📌 Total leads, Open opportunities, Pipeline value, Win rate
  > 👤 `crm_view` (scope by owner)
  > 🔧 aggregate queries; cache 5 นาที (in-memory หรือ Redis)

- [ ] **GET** `/api/crm/dashboard/recent-leads** — ล่าสุด 5 leads (by created_at)

- [ ] **GET** `/api/crm/dashboard/upcoming-activities** — activities 7 วันข้างหน้า

- [ ] **GET** `/api/crm/dashboard/sla-alerts**

  > 📌 leads ที่ SLA ใกล้หมด (<30 นาที) หรือเกินแล้ว
  > 🔧 calc `NOW() - lead.created_at` เทียบ sla_default

- [ ] **GET** `/api/crm/analytics/pipeline**

  > 📌 pipeline value แยกตาม stage
  > 🔧 `SUM(value) GROUP BY stage` + count

- [ ] **GET** `/api/crm/analytics/leads-by-source**

  > 🔧 `COUNT(*) GROUP BY source` + conversion rate per source

- [ ] **GET** `/api/crm/analytics/contact-temperature**

  > 🔧 count hot/warm/cold

---

## 🔔 Sub-phase 2.10 — Notifications & SLA

> **Prerequisite:** Sub-phase 2.0.5 (migration 004) ต้อง run แล้ว — เพิ่ม `related_type`/`related_id` + CRM enum values

- [ ] **Cron job** `sla-checker` (ทุก 5 นาที)

  > 🔧 query leads ที่ SLA ใกล้หมด → insert `notification_logs` (`notif_type='crm_sla_warning'`, `related_type='Lead'`, `related_id=lead.id`) + เรียก LINE bot ถ้า user มี LINE binding

- [ ] **POST** `/api/crm/notifications/test** — manual trigger สำหรับ debug (admin only)

- [ ] **GET** `/api/crm/notifications** — list CRM-related notifications สำหรับ user ปัจจุบัน

  > 🔧 WHERE `related_type IN ('Lead','Contact','Account','Opportunity','Quotation')` AND `employee_id = current_user`

- [ ] **Notification emitters** ใน handler ต่างๆ:
  - Lead assigned → `crm_lead_assigned`
  - Quotation submit → `crm_quotation_pending_approval` (ถึง manager)
  - Quotation approve/reject → `crm_quotation_approved` / `crm_quotation_rejected`
  - Opportunity closed_won/lost → `crm_opportunity_won` / `crm_opportunity_lost`
  - Activity assigned/due → `crm_activity_assigned` / `crm_activity_due`

> 💡 ใช้ `notification_logs` + `bot_sessions` ของ Phase 1 (polymorphic แล้วหลัง 2.0.5) — ไม่ต้องสร้าง table ใหม่

---

## 🔌 Sub-phase 2.11 — FE Integration (แทน mock ด้วย API จริง)

> ทำหลังจาก backend stable พอสมควร (หลัง 2.6 อย่างน้อย)

### สร้าง API client layer

- [ ] `xiqma-client/lib/api/crm-leads.ts` — `listLeads`, `getLead`, `createLead`, `updateLead`, `deleteLead`, `convertLead`
- [ ] `xiqma-client/lib/api/crm-accounts.ts`
- [ ] `xiqma-client/lib/api/crm-contacts.ts`
- [ ] `xiqma-client/lib/api/crm-opportunities.ts`
- [ ] `xiqma-client/lib/api/crm-quotations.ts`
- [ ] `xiqma-client/lib/api/crm-activities.ts`
- [ ] `xiqma-client/lib/api/crm-products.ts`
- [ ] `xiqma-client/lib/api/crm-dashboard.ts`

> ใช้ pattern เดียวกับ `lib/api/tasks.ts`, `lib/api/employees.ts` ที่มีอยู่

### Cross-system integrations

- [ ] **Notifications UI** — ส่วน bell/dropdown ต้อง render จาก `related_type` ใหม่ (ไม่ใช่แค่ task link)
  - Task → `/tasks/:id`
  - Lead → `/crm/leads/:id`
  - Opportunity → `/crm/opportunities/:id`
  - Quotation → `/crm/quotations/:id`
  - Activity → `/crm/activities?id=:id`
- [ ] **Global search** (ถ้ามี) — extend ให้ search `crm_leads.email`, `crm_accounts.name`, `crm_contacts.{first,last}_name`, `crm_opportunities.name`, `crm_quotations.quotation_number`

### React Query hooks

- [ ] `xiqma-client/lib/hooks/use-crm-leads.ts` (`useLeads`, `useLead`, `useCreateLead`, ฯลฯ)
- [ ] `...` ครบทุก entity
- [ ] สร้าง invalidation pattern: แก้ lead → invalidate `['leads']` + `['dashboard-stats']`

### แทน mock ใน 9 components

- [ ] `dashboard.tsx` — swap `mockDashboardStats` → `useDashboardStats()`
- [ ] `leads.tsx` — swap `mockLeads` → `useLeads()`, enable Create/Edit forms (wire ไป `useCreateLead`)
- [ ] `accounts.tsx`
- [ ] `contacts.tsx`
- [ ] `opportunities.tsx`
- [ ] `quotations.tsx`
- [ ] `activities.tsx`
- [ ] `products.tsx`
- [ ] `settings.tsx` — โหลดจาก config endpoints

### Cleanup

- [ ] ลบ `xiqma-client/lib/crm-mock.ts` เมื่อทุก component ไม่ใช้แล้ว
- [ ] ลบ inline mock mini-lists ที่เหลือใน `contacts.tsx`, `accounts.tsx`

### เพิ่ม detail pages (optional Phase 2.11.x)

- [ ] `/crm/leads/[id]/page.tsx`
- [ ] `/crm/accounts/[id]/page.tsx`
- [ ] `/crm/contacts/[id]/page.tsx`
- [ ] `/crm/opportunities/[id]/page.tsx`
- [ ] `/crm/quotations/[id]/page.tsx`

---

## 🧪 Sub-phase 2.12 — Testing & Seed

### Seed Data

- [ ] `src/seed/crm-seed.ts` — ใส่ข้อมูล test จาก `crm-mock.ts` ลง DB จริง (สำหรับ dev/staging)

  > 🔧 ใช้ `onConflictDoNothing` เพื่อ rerun ได้

### Unit Tests

- [ ] `src/services/crm-leads.service.test.ts` — convert logic, SLA calc
- [ ] `src/services/crm-opportunities.service.test.ts` — stage transition, probability sync
- [ ] `src/services/crm-quotations.service.test.ts` — number generation, total calc
- [ ] `src/lib/crm-scope.test.ts` — permission-based query scoping

### Integration Tests (Hono test client)

- [ ] `tests/crm/leads.test.ts` — CRUD + convert flow
- [ ] `tests/crm/opportunities.test.ts` — stage workflow + rollback
- [ ] `tests/crm/quotations.test.ts` — approval workflow + PDF generation (mock Puppeteer)
- [ ] `tests/crm/permissions.test.ts` — 403 สำหรับ non-CRM user, scope ถูกต้อง

### E2E Smoke (Playwright)

- [ ] Sales rep login → สร้าง lead → convert → สร้าง quotation → submit → manager approve

### Performance

- [ ] Benchmark `/api/crm/leads?limit=50` กับข้อมูล 10K records — target < 200ms
- [ ] Check ว่า indexes ทำงานจริง (`EXPLAIN ANALYZE`)

### Deployment checklist

- [ ] Migration ทำงานบน staging ไม่พัง
- [ ] env vars ครบบน prod (CRM_FILE_STORAGE_PATH, CRM_PDF_TEMPLATE_PATH, CRM_SLA_DEFAULT_MINUTES)
- [ ] Supabase Storage bucket สำหรับ CRM files + quotation PDFs
- [ ] Cron scheduler สำหรับ sla-checker (pg_cron หรือ external scheduler)

---

## 🔗 Dependency Graph (visual)

```
2.0 (perms) → 2.1 (schema) ──┬→ 2.2 (products) ──┬→ 2.3 (leads)
                             │                   ├→ 2.4 (accounts) → 2.5 (contacts) → 2.6 (opps) → 2.7 (quotations)
                             │                   └→ 2.8 (activities)
                             └───────────────────→ 2.9 (dashboard) → 2.10 (notifications)

                                      2.6+ → 2.11 (FE integration) → 2.12 (testing)
```

---

## ⏱️ ประมาณการเวลา

| Sub-phase | เวลา (คนเดียว) |
| --- | --- |
| 2.0 | 0.5 วัน |
| 2.1 | 1 วัน |
| 2.2 | 1 วัน |
| 2.3 | 1.5 วัน (convert logic ซับซ้อน) |
| 2.4 | 1 วัน |
| 2.5 | 1 วัน |
| 2.6 | 1.5 วัน (stage workflow) |
| 2.7 | 2 วัน (workflow + PDF) |
| 2.8 | 1 วัน |
| 2.9 | 1 วัน |
| 2.10 | 0.5 วัน |
| 2.11 | 3 วัน (wiring ทุก component + hooks) |
| 2.12 | 2 วัน |
| **รวม** | **~16-17 วัน (3 สัปดาห์)** |

---

## ✅ Definition of Done — Phase 2

- [ ] ทั้ง 75+ endpoints ผ่าน integration test
- [ ] FE 9 sections ทำงานกับ API จริง ไม่มี mock
- [ ] Permission scope ถูกต้อง: sales rep เห็นเฉพาะของตัวเอง, manager เห็นทีม, admin เห็นหมด
- [ ] Lead convert + Quotation workflow + Opportunity stage transition ทำงานครบ flow
- [ ] PDF quotation generate ได้ + upload เก็บถาวร
- [ ] SLA alerts ยิง notification ตามกำหนด
- [ ] Migration rollback ได้
- [ ] Seed data runnable on staging
- [ ] Performance baseline (<200ms @ 10K records) ผ่าน

---

## 🧭 แนะนำลำดับลงมือ

1. **สัปดาห์ 1:** 2.0 → 2.1 → 2.2 → 2.3 → 2.4 (foundation)
2. **สัปดาห์ 2:** 2.5 → 2.6 → 2.7 → 2.8 (core business logic)
3. **สัปดาห์ 3:** 2.9 → 2.10 → 2.11 → 2.12 (analytics + FE + QA)

> 💡 ทำ 2.11 (FE integration) แบบ progressive — ทันทีที่ 2.3 leads เสร็จ → wire FE leads ก่อน ไม่ต้องรอ backend เสร็จทุกอัน
