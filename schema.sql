-- ============================================================
-- UNIFIED SYSTEM — Full Schema SQL
-- Stack: PostgreSQL (Supabase)
-- Version: 1.2 — Phase 3 soft-delete support
--
-- Changes from v1.0:
--   [FIX-1] employees          + password_hash (auth ต้องใช้)
--   [FIX-2] tasks              + display_order (kanban reorder)
--   [FIX-3] notification_logs  + is_read, read_at (mark read API)
--   [FIX-4] leave_requests     total_days = plain integer (ไม่ใช่ generated)
--   [FIX-5] refresh_tokens     ตารางใหม่ (revoke JWT ได้จริง)
-- Changes from v1.1:
--   [FIX-6] tasks              + deleted_at (soft-delete cascade จาก list/folder/space delete)
--   [ADD]   indexes เพิ่มเติม + index บน notification_logs, attendance
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'employee', 'manager', 'hr', 'admin'
);

CREATE TYPE task_status AS ENUM (
  'pending', 'in_progress', 'paused', 'review',
  'completed', 'cancelled', 'blocked', 'overdue'
);

CREATE TYPE status_type AS ENUM (
  'open', 'in_progress', 'review', 'done', 'closed'
);

CREATE TYPE task_priority AS ENUM (
  'low', 'normal', 'high', 'urgent'
);

CREATE TYPE task_category AS ENUM (
  'private', 'organization'
);

CREATE TYPE due_extension_status AS ENUM (
  'pending', 'approved', 'rejected'
);

CREATE TYPE leave_type AS ENUM (
  'annual', 'sick', 'personal', 'maternity', 'ordain', 'unpaid'
);

CREATE TYPE leave_status AS ENUM (
  'pending', 'approved', 'rejected', 'cancelled'
);

CREATE TYPE attendance_status AS ENUM (
  'present', 'late', 'absent', 'leave', 'holiday'
);

CREATE TYPE notif_type AS ENUM (
  'assigned', 'due_reminder', 'overdue',
  'extension_request', 'extension_approved', 'extension_rejected',
  'leave_request', 'leave_approved', 'leave_rejected',
  'daily_summary', 'announcement'
);

CREATE TYPE point_period AS ENUM (
  'day', 'week', 'month', 'year'
);

-- ============================================================
-- SEQUENCES (display IDs)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS task_display_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS leave_request_seq  START 1;
CREATE SEQUENCE IF NOT EXISTS extension_seq      START 1;

-- ============================================================
-- GROUP: Organization & Users
-- ============================================================

CREATE TABLE positions (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT        NOT NULL,
  department         TEXT,
  -- 1=Executive 2=C-Level 3=VP/Director 4=Manager 5=Senior 6=Staff
  level              INTEGER     NOT NULL DEFAULT 6,
  -- C1, M1, S1, J1
  job_level_code     TEXT,
  color              TEXT        NOT NULL DEFAULT '#6b7280',
  parent_position_id UUID        REFERENCES positions(id),
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL UNIQUE,
  description TEXT,
  color       TEXT        NOT NULL DEFAULT '#6b7280',
  -- ['view_tasks','create_tasks','edit_tasks','delete_tasks',
  --  'assign_tasks','manage_users','manage_roles',
  --  'manage_workspace','view_analytics','admin']
  permissions JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employees (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_code        TEXT        NOT NULL UNIQUE,
  name                 TEXT        NOT NULL,
  email                TEXT        UNIQUE,
  -- [FIX-1] เพิ่ม password_hash — ต้องใช้สำหรับ /auth/login และ change password
  password_hash        TEXT,
  avatar_url           TEXT,
  role                 user_role   NOT NULL DEFAULT 'employee',
  -- role_id สำหรับ frontend RBAC (permissions jsonb)
  role_id              UUID        REFERENCES roles(id),
  -- 1 position ต่อคน
  position_id          UUID        REFERENCES positions(id),
  manager_id           UUID        REFERENCES employees(id),
  department           TEXT,
  line_user_id         TEXT        UNIQUE,
  line_access_token    TEXT,
  clickup_user_id      TEXT,
  leave_quota_annual   INTEGER     NOT NULL DEFAULT 10,
  leave_quota_sick     INTEGER     NOT NULL DEFAULT 30,
  leave_quota_personal INTEGER     NOT NULL DEFAULT 3,
  is_active            BOOLEAN     NOT NULL DEFAULT false,
  registered_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE work_schedules (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT        NOT NULL,
  days_per_week    NUMERIC     NOT NULL DEFAULT 5,
  hours_per_day    NUMERIC     NOT NULL DEFAULT 8,
  -- GENERATED: days_per_week * hours_per_day
  hours_per_week   NUMERIC     GENERATED ALWAYS AS (days_per_week * hours_per_day) STORED,
  -- ISO DOW: 1=จันทร์ ... 7=อาทิตย์
  work_days        INTEGER[]   NOT NULL DEFAULT '{1,2,3,4,5}',
  work_start_time  TIME        NOT NULL DEFAULT '09:00',
  work_end_time    TIME        NOT NULL DEFAULT '18:00',
  is_default       BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employee_performance_config (
  id                       UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id              UUID         NOT NULL UNIQUE REFERENCES employees(id),
  work_schedule_id         UUID         NOT NULL REFERENCES work_schedules(id),
  -- 0 < ratio <= 2
  expected_ratio           NUMERIC      NOT NULL DEFAULT 0.80,
  -- 0-100
  pointed_work_percent     INTEGER      NOT NULL DEFAULT 80,
  -- GENERATED: 100 - pointed_work_percent
  non_pointed_work_percent INTEGER      GENERATED ALWAYS AS (100 - pointed_work_percent) STORED,
  -- เป้าหมาย points เช่น 40
  point_target             INTEGER,
  point_period             point_period NOT NULL DEFAULT 'week',
  effective_from           DATE         NOT NULL DEFAULT CURRENT_DATE,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- [FIX-5] ตารางเก็บ refresh token เพื่อให้ revoke ได้จริงตอน logout
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- เก็บ hash ของ token ไม่เก็บ plain text
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  -- NULL = ยังใช้ได้, มีค่า = revoked แล้ว
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- GROUP: Workspace Hierarchy
-- ============================================================

CREATE TABLE spaces (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT        NOT NULL,
  color         TEXT        NOT NULL DEFAULT '#3b82f6',
  -- Code | Rocket | Briefcase | Heart ...
  icon          TEXT,
  display_order INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE space_members (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id    UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, employee_id)
);

CREATE TABLE folders (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT        NOT NULL,
  space_id      UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  color         TEXT,
  display_order INTEGER     NOT NULL DEFAULT 0,
  is_archived   BOOLEAN     NOT NULL DEFAULT false,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lists (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT        NOT NULL,
  -- optional: list อาจอยู่ใต้ space โดยตรง ไม่ต้องมี folder
  folder_id     UUID        REFERENCES folders(id) ON DELETE SET NULL,
  space_id      UUID        NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  color         TEXT,
  display_order INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE list_statuses (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id       UUID        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  color         TEXT        NOT NULL DEFAULT '#6b7280',
  display_order INTEGER     NOT NULL DEFAULT 0,
  type          status_type NOT NULL DEFAULT 'open'
);

CREATE TABLE task_types (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT          NOT NULL,
  description       TEXT,
  color             TEXT          NOT NULL DEFAULT '#6b7280',
  category          task_category NOT NULL DEFAULT 'organization',
  counts_for_points BOOLEAN       NOT NULL DEFAULT true,
  -- สำหรับ private task: Meeting=2, Training=4
  fixed_points      INTEGER,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ============================================================
-- GROUP: Tasks
-- ============================================================

CREATE TABLE tasks (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- AUTO: TK-000001
  display_id     TEXT          UNIQUE,
  title          TEXT          NOT NULL,
  description    TEXT,

  -- Workspace
  list_id        UUID          NOT NULL REFERENCES lists(id),
  list_status_id UUID          REFERENCES list_statuses(id),
  task_type_id   UUID          REFERENCES task_types(id),
  priority       task_priority NOT NULL DEFAULT 'normal',

  -- Assignments
  assignee_id    UUID          NOT NULL REFERENCES employees(id),
  creator_id     UUID          NOT NULL REFERENCES employees(id),

  -- External Sync
  clickup_task_id TEXT         UNIQUE,
  -- manager_assigned | self_assigned
  source         TEXT          NOT NULL DEFAULT 'manager_assigned',

  -- Story Points & Estimation
  -- 1|2|3|5|8|13|21
  story_points   INTEGER,
  manday_estimate       NUMERIC,
  time_estimate_hours   NUMERIC,

  -- Time Tracking
  accumulated_minutes   INTEGER NOT NULL DEFAULT 0,
  -- อัปเดตทุกครั้งที่ pause/complete
  actual_hours          NUMERIC NOT NULL DEFAULT 0,

  -- Planning
  plan_start     DATE,
  duration_days  INTEGER,
  -- GENERATED: plan_start + (duration_days - 1)
  plan_finish    DATE GENERATED ALWAYS AS (
    CASE
      WHEN plan_start IS NOT NULL AND duration_days IS NOT NULL
      THEN plan_start + (duration_days - 1)
      ELSE NULL
    END
  ) STORED,

  -- Actual Dates
  deadline       TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,

  -- Status
  status         task_status NOT NULL DEFAULT 'pending',
  -- [FIX-2] เพิ่ม display_order สำหรับ kanban drag & drop reorder
  display_order  INTEGER     NOT NULL DEFAULT 0,
  score          NUMERIC,
  blocked_note   TEXT,
  blocked_at     TIMESTAMPTZ,
  tags           JSONB       NOT NULL DEFAULT '[]',

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = active, มีค่า = ถูกลบ (cascade จาก list/folder/space delete)
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE subtasks (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_task_id UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  is_completed   BOOLEAN     NOT NULL DEFAULT false,
  assignee_id    UUID        REFERENCES employees(id),
  display_order  INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_time_sessions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES employees(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = กำลังทำงานอยู่
  ended_at    TIMESTAMPTZ,
  -- GENERATED: EXTRACT(epoch FROM ended_at - started_at) / 60
  duration_min INTEGER,
  note        TEXT
);

CREATE TABLE task_comments (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id      UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id    UUID        NOT NULL REFERENCES employees(id),
  comment_text TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ
);

CREATE TABLE task_attachments (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id          UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by      UUID        NOT NULL REFERENCES employees(id),
  file_url         TEXT        NOT NULL,
  file_name        TEXT,
  file_description TEXT,
  file_size_bytes  BIGINT,
  mime_type        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE due_extension_requests (
  id           UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- AUTO: EX-000001
  display_id   TEXT                 UNIQUE,
  task_id      UUID                 NOT NULL REFERENCES tasks(id),
  requested_by UUID                 NOT NULL REFERENCES employees(id),
  reviewed_by  UUID                 REFERENCES employees(id),
  new_deadline TIMESTAMPTZ          NOT NULL,
  reason       TEXT                 NOT NULL,
  status       due_extension_status NOT NULL DEFAULT 'pending',
  reviewed_at  TIMESTAMPTZ,
  reject_reason TEXT,
  created_at   TIMESTAMPTZ          NOT NULL DEFAULT now()
);

-- ============================================================
-- GROUP: HR System
-- ============================================================

CREATE TABLE company_holidays (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT        NOT NULL,
  holiday_date DATE        NOT NULL UNIQUE,
  -- true = หยุดทุกปีวันเดิม เช่น ปีใหม่
  is_recurring BOOLEAN     NOT NULL DEFAULT false,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leave_requests (
  id                      UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- AUTO: LR-000001
  display_id              TEXT         UNIQUE,
  employee_id             UUID         NOT NULL REFERENCES employees(id),
  approved_by             UUID         REFERENCES employees(id),
  leave_type              leave_type   NOT NULL,
  start_date              DATE         NOT NULL,
  end_date                DATE         NOT NULL,
  -- [FIX-4] plain integer — handler คำนวณจาก working days จริง (ข้าม weekend + วันหยุด)
  --         ไม่ใช่ generated เพราะ end - start + 1 ≠ วันทำงานจริง
  total_days              INTEGER,
  reason                  TEXT,
  medical_certificate_url TEXT,
  status                  leave_status NOT NULL DEFAULT 'pending',
  reviewed_at             TIMESTAMPTZ,
  reject_reason           TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE leave_quotas (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID        NOT NULL REFERENCES employees(id),
  year        INTEGER     NOT NULL,
  leave_type  leave_type  NOT NULL,
  quota_days  INTEGER     NOT NULL DEFAULT 0,
  used_days   INTEGER     NOT NULL DEFAULT 0,
  -- GENERATED: quota_days - used_days
  remaining_days INTEGER  GENERATED ALWAYS AS (quota_days - used_days) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, year, leave_type)
);

CREATE TABLE attendance_logs (
  id               UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id      UUID              NOT NULL REFERENCES employees(id),
  work_date        DATE              NOT NULL,
  check_in         TIMESTAMPTZ,
  check_out        TIMESTAMPTZ,
  status           attendance_status NOT NULL DEFAULT 'present',
  leave_request_id UUID              REFERENCES leave_requests(id),
  note             TEXT,
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

-- ============================================================
-- GROUP: Performance & Reports
-- ============================================================

CREATE TABLE weekly_reports (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id       UUID        NOT NULL REFERENCES employees(id),
  -- วันจันทร์ของสัปดาห์
  week_start        DATE        NOT NULL,
  tasks_done        INTEGER     NOT NULL DEFAULT 0,
  tasks_overdue     INTEGER     NOT NULL DEFAULT 0,
  total_manday      NUMERIC     NOT NULL DEFAULT 0,
  actual_hours      NUMERIC     NOT NULL DEFAULT 0,
  expected_points   NUMERIC,
  actual_points     NUMERIC,
  performance_ratio NUMERIC,
  -- Excellent | Good | Fair | Poor
  performance_label TEXT,
  avg_score         NUMERIC,
  rank              INTEGER,
  prev_week_score   NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, week_start)
);

CREATE TABLE monthly_hr_reports (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id        UUID        NOT NULL REFERENCES employees(id),
  year               INTEGER     NOT NULL,
  -- 1-12
  month              INTEGER     NOT NULL,
  leave_days_taken   INTEGER     NOT NULL DEFAULT 0,
  absent_days        INTEGER     NOT NULL DEFAULT 0,
  late_days          INTEGER     NOT NULL DEFAULT 0,
  total_hours_worked NUMERIC     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, year, month)
);

CREATE TABLE daily_summaries (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  summary_date  DATE        NOT NULL UNIQUE,
  done_count    INTEGER     NOT NULL DEFAULT 0,
  pending_count INTEGER     NOT NULL DEFAULT 0,
  overdue_count INTEGER     NOT NULL DEFAULT 0,
  blocked_count INTEGER     NOT NULL DEFAULT 0,
  team_avg_score NUMERIC,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- GROUP: LINE Bot System
-- ============================================================

CREATE TABLE bot_sessions (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  line_user_id   TEXT        NOT NULL UNIQUE,
  role           TEXT,
  action         TEXT,
  -- idle | incomplete | pending_confirmation | confirmed
  state          TEXT        NOT NULL DEFAULT 'idle',
  collected_data JSONB       NOT NULL DEFAULT '{}',
  expires_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE menu_actions (
  id               SERIAL      PRIMARY KEY,
  -- manager | employee
  role             VARCHAR(20) NOT NULL,
  -- unique per role
  action           VARCHAR(50) NOT NULL,
  label_th         VARCHAR(100) NOT NULL,
  description      TEXT        NOT NULL,
  required_fields  JSONB       NOT NULL DEFAULT '[]',
  optional_fields  JSONB       NOT NULL DEFAULT '[]',
  confirm_required BOOLEAN     NOT NULL DEFAULT true,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, action)
);

CREATE TABLE action_handlers (
  id          SERIAL       PRIMARY KEY,
  action      VARCHAR(50)  NOT NULL UNIQUE,
  webhook_url TEXT         NOT NULL,
  description VARCHAR(200),
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE ai_chat_histories (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID        REFERENCES employees(id),
  session_id  TEXT        NOT NULL,
  -- user | assistant | system
  role        TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- GROUP: Logs & Notifications
-- ============================================================

CREATE TABLE notification_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID        REFERENCES tasks(id),
  employee_id UUID        REFERENCES employees(id),
  notif_type  notif_type  NOT NULL,
  message     TEXT,
  is_sent     BOOLEAN     NOT NULL DEFAULT false,
  sent_at     TIMESTAMPTZ,
  -- [FIX-3] เพิ่ม is_read + read_at สำหรับ PATCH /notifications/:id/read
  is_read     BOOLEAN     NOT NULL DEFAULT false,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- NULL = system action
  actor_id    UUID        REFERENCES employees(id),
  action      TEXT        NOT NULL,
  table_name  TEXT,
  record_id   UUID,
  before_data JSONB,
  after_data  JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Tasks
CREATE INDEX idx_tasks_assignee       ON tasks(assignee_id);
CREATE INDEX idx_tasks_list           ON tasks(list_id);
CREATE INDEX idx_tasks_status         ON tasks(status);
CREATE INDEX idx_tasks_deadline       ON tasks(deadline);
-- สำหรับ kanban: query tasks ใน column เดียว เรียงตาม display_order
CREATE INDEX idx_tasks_kanban         ON tasks(list_id, list_status_id, display_order);

-- Employees
CREATE INDEX idx_employees_manager    ON employees(manager_id);
CREATE INDEX idx_employees_line       ON employees(line_user_id);

-- Attendance
CREATE INDEX idx_attendance_employee  ON attendance_logs(employee_id, work_date);
-- สำหรับ query รายเดือน (HR ดูทั้ง org)
CREATE INDEX idx_attendance_date      ON attendance_logs(work_date);

-- Weekly reports
CREATE INDEX idx_weekly_reports       ON weekly_reports(employee_id, week_start);

-- Notifications: query unread ของ user
CREATE INDEX idx_notif_employee_read  ON notification_logs(employee_id, is_read, created_at DESC);

-- Time sessions: หา active session ของ user
CREATE INDEX idx_time_sessions_active ON task_time_sessions(employee_id, ended_at)
  WHERE ended_at IS NULL;

-- Refresh tokens
CREATE INDEX idx_refresh_tokens_emp   ON refresh_tokens(employee_id);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default work schedule
INSERT INTO work_schedules (name, days_per_week, hours_per_day, work_days, work_start_time, work_end_time, is_default)
VALUES ('จันทร์–ศุกร์ 09:00–18:00', 5, 8, '{1,2,3,4,5}', '09:00', '18:00', true);

-- Default roles
INSERT INTO roles (name, description, color, permissions) VALUES
  ('admin',    'ผู้ดูแลระบบทั้งหมด',     '#ef4444', '["view_tasks","create_tasks","edit_tasks","delete_tasks","assign_tasks","manage_users","manage_roles","manage_workspace","view_analytics","admin"]'),
  ('manager',  'ผู้จัดการ ดูและจัดการทีม', '#f59e0b', '["view_tasks","create_tasks","edit_tasks","assign_tasks","view_analytics"]'),
  ('hr',       'HR ดูแลการลาและรายงาน',   '#8b5cf6', '["view_tasks","view_analytics","manage_users"]'),
  ('employee', 'พนักงานทั่วไป',           '#6b7280', '["view_tasks","create_tasks","edit_tasks"]');

-- Default task types
INSERT INTO task_types (name, color, category, counts_for_points, fixed_points) VALUES
  ('Development',    '#3b82f6', 'organization', true,  NULL),
  ('Bug Fix',        '#ef4444', 'organization', true,  NULL),
  ('Code Review',    '#f59e0b', 'organization', true,  NULL),
  ('Documentation',  '#10b981', 'organization', true,  NULL),
  ('Meeting',        '#6b7280', 'private',       false, 2),
  ('Training',       '#8b5cf6', 'private',       false, 4),
  ('Planning',       '#ec4899', 'organization', true,  NULL),
  ('Testing / QA',   '#14b8a6', 'organization', true,  NULL);

-- Admin user (password: Admin@1234 — เปลี่ยนทันทีหลัง deploy)
INSERT INTO employees (
  employee_code, name, email, password_hash,
  role, is_active
) VALUES (
  'EMP-0001',
  'System Admin',
  'admin@company.com',
  crypt('Admin@1234', gen_salt('bf')),
  'admin',
  true
);

-- ============================================================
-- MIGRATION NOTES (ถ้า upgrade จาก schema v1.0)
-- ============================================================
-- รัน script นี้เฉพาะถ้า DB เดิมมีอยู่แล้ว:
--
-- v1.0 → v1.1
-- ALTER TABLE employees
--   ADD COLUMN IF NOT EXISTS password_hash text;
--
-- ALTER TABLE tasks
--   ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
--
-- ALTER TABLE notification_logs
--   ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
--   ADD COLUMN IF NOT EXISTS read_at  timestamptz;
--
-- -- total_days ใน leave_requests ให้ตรวจว่าเป็น plain integer
-- -- (ไม่ใช่ GENERATED) ถ้าเป็น GENERATED ต้องทำ:
-- ALTER TABLE leave_requests
--   ALTER COLUMN total_days DROP EXPRESSION;
--
-- CREATE TABLE IF NOT EXISTS refresh_tokens ( ... ); -- ดู schema ด้านบน
--
-- CREATE INDEX IF NOT EXISTS idx_tasks_kanban
--   ON tasks(list_id, list_status_id, display_order);
-- CREATE INDEX IF NOT EXISTS idx_attendance_date
--   ON attendance_logs(work_date);
-- CREATE INDEX IF NOT EXISTS idx_notif_employee_read
--   ON notification_logs(employee_id, is_read, created_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_time_sessions_active
--   ON task_time_sessions(employee_id, ended_at) WHERE ended_at IS NULL;
--
-- v1.1 → v1.2
-- ALTER TABLE tasks
--   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
