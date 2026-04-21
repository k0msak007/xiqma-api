-- ============================================================
-- Notification Logs — Polymorphic Refactor
-- Stack: PostgreSQL (Supabase)
-- Version: 1.0 — Phase 2 CRM prerequisite
--
-- Dependencies:
--   • 001_Initial_Database.sql  (notification_logs, notif_type)
--   • 003_CRM_Schema.sql        (crm_related_type ใช้ร่วมแนวคิดเดียวกัน)
--
-- Why:
--   • `notification_logs` เดิมผูกกับ `task_id` โดยตรง → CRM ส่ง noti ไม่ได้
--   • แก้เป็น polymorphic (related_type + related_id) เหมือน crm_activities
--   • เพิ่ม notif_type สำหรับ CRM events
--
-- Rollback plan:
--   1. DROP INDEX idx_notif_related;
--   2. ALTER TABLE notification_logs DROP COLUMN related_type, related_id;
--   3. (notif_type enum ลบค่าไม่ได้ — ต้อง recreate enum ถ้าจำเป็น)
-- ============================================================

-- ============================================================
-- ENUM: notif_related_type
-- ============================================================
-- superset ของ crm_related_type (003) + 'Task' + 'Quotation'
-- เหตุผลที่แยก 2 enum: crm_activities ห้าม relate ไป Task โดยตรง (กฎใน 2.8)
CREATE TYPE notif_related_type AS ENUM (
  'Task', 'Lead', 'Contact', 'Account', 'Opportunity', 'Quotation'
);

-- ============================================================
-- EXTEND ENUM: notif_type (เพิ่มค่า CRM)
-- ============================================================
-- หมายเหตุ: ALTER TYPE ... ADD VALUE ต้องอยู่นอก transaction (autocommit)
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_lead_assigned';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_sla_warning';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_quotation_pending_approval';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_quotation_approved';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_quotation_rejected';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_opportunity_won';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_opportunity_lost';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_activity_assigned';
ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'crm_activity_due';

-- ============================================================
-- ALTER TABLE: notification_logs
-- ============================================================

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS related_type notif_related_type,
  ADD COLUMN IF NOT EXISTS related_id   UUID;

-- backfill แถวเดิม: ทุก record ที่มี task_id → related_type='Task', related_id=task_id
UPDATE notification_logs
   SET related_type = 'Task',
       related_id   = task_id
 WHERE task_id IS NOT NULL
   AND related_type IS NULL;

-- หมายเหตุ: `task_id` column คงไว้ก่อนเพื่อ backward compat กับ handler Phase 1
--         เมื่อ handler ทั้งหมดเปลี่ยนไปใช้ related_* แล้ว ให้ drop ใน migration ถัดไป:
--   ALTER TABLE notification_logs DROP COLUMN task_id;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_notif_related
  ON notification_logs(related_type, related_id);
