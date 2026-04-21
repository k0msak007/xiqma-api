-- ============================================================
-- CRM MODULE — Full Schema SQL
-- Stack: PostgreSQL (Supabase)
-- Version: 1.0 — Phase 2 CRM
--
-- Dependencies:
--   • 001_Initial_Database.sql  (employees, roles, extensions)
--
-- Notes:
--   • ทุกตาราง prefix `crm_`
--   • Soft-delete ผ่าน `deleted_at` (อ่านข้อมูลต้อง WHERE deleted_at IS NULL)
--   • `crm_activities.related_to_id` เป็น polymorphic → ไม่มี FK, validate ใน handler
--   • Permission keys ใช้ 3 ระดับ: crm_view / crm_manage / crm_admin
--     เก็บใน roles.permissions JSONB — seed อยู่ที่ Sub-phase 2.0 (Todo_task/phase_2.md)
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE crm_lead_type AS ENUM (
  'individual', 'company'
);

CREATE TYPE crm_contact_type AS ENUM (
  'individual', 'company'
);

CREATE TYPE crm_temperature AS ENUM (
  'Hot', 'Warm', 'Cold'
);

CREATE TYPE crm_lead_status AS ENUM (
  'New', 'Working', 'Qualified', 'Unqualified'
);

CREATE TYPE crm_account_type AS ENUM (
  'Customer', 'Prospect', 'Partner', 'Other'
);

CREATE TYPE crm_opportunity_stage AS ENUM (
  'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'
);

CREATE TYPE crm_quotation_status AS ENUM (
  'draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected'
);

-- 'task' = งานที่ผูกกับ CRM entity (ไม่ใช่ Phase 1 tasks!) — ดู Sub-phase 2.8
CREATE TYPE crm_activity_type AS ENUM (
  'call', 'email', 'meeting', 'task', 'note'
);

-- หมายเหตุ: subset ของ notif_related_type ใน 004_Notification_Polymorphic.sql
-- (ที่เพิ่ม 'Task' + 'Quotation' เพื่อรองรับทั้งระบบ)
-- ทั้งสอง enum ถูกแยกเพราะ CRM activity ห้าม relate ไป Task โดยตรง
CREATE TYPE crm_related_type AS ENUM (
  'Lead', 'Contact', 'Account', 'Opportunity'
);

CREATE TYPE crm_file_type AS ENUM (
  'image', 'catalog', 'document'
);

-- ============================================================
-- SEQUENCES (display IDs)
-- ============================================================

-- ใช้สำหรับ quotation_number เช่น QT-202604-0001
CREATE SEQUENCE IF NOT EXISTS crm_quotation_seq START 1;

-- ============================================================
-- GROUP: Products Catalog
-- ============================================================

CREATE TABLE crm_products (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        VARCHAR(50)  NOT NULL UNIQUE,
  name        TEXT         NOT NULL,
  category    VARCHAR(100) NOT NULL,
  description TEXT,
  unit_price  NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
  unit        VARCHAR(50)  NOT NULL DEFAULT 'Unit',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE crm_product_files (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID          NOT NULL REFERENCES crm_products(id) ON DELETE CASCADE,
  file_name       TEXT          NOT NULL,
  file_type       crm_file_type NOT NULL,
  file_url        TEXT          NOT NULL,
  file_size_bytes BIGINT,
  mime_type       VARCHAR(100),
  uploaded_by     UUID          NOT NULL REFERENCES employees(id),
  uploaded_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ============================================================
-- GROUP: Accounts & Contacts
-- ============================================================

CREATE TABLE crm_accounts (
  id             UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT             NOT NULL,
  tax_id         VARCHAR(20),
  industry       VARCHAR(100),
  type           crm_account_type NOT NULL,
  website        TEXT,
  phone          VARCHAR(20),
  email          TEXT,
  address        TEXT,
  lifetime_value NUMERIC(15,2)    NOT NULL DEFAULT 0,
  annual_revenue NUMERIC(15,2),
  employee_count INTEGER,
  owner_id       UUID             NOT NULL REFERENCES employees(id),
  description    TEXT,
  created_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE crm_contacts (
  id                     UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_type           crm_contact_type  NOT NULL,
  first_name             TEXT              NOT NULL,
  last_name              TEXT              NOT NULL,
  title                  TEXT,
  department             TEXT,
  email                  TEXT              NOT NULL,
  phone                  VARCHAR(20),
  mobile                 VARCHAR(20),
  address                TEXT,
  account_id             UUID              REFERENCES crm_accounts(id) ON DELETE SET NULL,
  temperature            crm_temperature,
  source                 VARCHAR(100),
  campaign               TEXT,
  is_primary             BOOLEAN           NOT NULL DEFAULT false,
  email_opens            INTEGER           NOT NULL DEFAULT 0,
  web_visits             INTEGER           NOT NULL DEFAULT 0,
  last_activity_at       TIMESTAMPTZ,
  -- FK → crm_leads เพิ่มทีหลัง (circular ref)
  converted_from_lead_id UUID,
  owner_id               UUID              NOT NULL REFERENCES employees(id),
  notes                  TEXT,
  created_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

-- ============================================================
-- GROUP: Leads
-- ============================================================

CREATE TABLE crm_leads (
  id                      UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_type               crm_lead_type    NOT NULL,
  -- ข้อมูลสำหรับ individual lead
  first_name              TEXT,
  last_name               TEXT,
  -- ข้อมูลสำหรับ company lead
  company_name            TEXT,
  tax_id                  VARCHAR(20),
  contact_first_name      TEXT,
  contact_last_name       TEXT,
  contact_position        TEXT,
  -- ข้อมูลร่วม
  email                   TEXT             NOT NULL UNIQUE,
  phone                   VARCHAR(20),
  mobile                  VARCHAR(20),
  address                 TEXT,
  temperature             crm_temperature,
  source                  VARCHAR(100),
  campaign                TEXT,
  score                   INTEGER          NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  sla_remaining           INTERVAL,
  status                  crm_lead_status  NOT NULL DEFAULT 'New',
  owner_id                UUID             NOT NULL REFERENCES employees(id),
  -- เมื่อ convert → ชี้ไปที่ contact ที่สร้างใหม่
  converted_to_contact_id UUID             REFERENCES crm_contacts(id) ON DELETE SET NULL,
  converted_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ      NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ,
  -- บังคับว่า individual ต้องมี first/last name, company ต้องมี company_name
  CONSTRAINT chk_lead_individual_required
    CHECK (lead_type <> 'individual' OR (first_name IS NOT NULL AND last_name IS NOT NULL)),
  CONSTRAINT chk_lead_company_required
    CHECK (lead_type <> 'company' OR company_name IS NOT NULL)
);

-- เพิ่ม FK circular ของ contacts → leads
ALTER TABLE crm_contacts
  ADD CONSTRAINT fk_crm_contacts_converted_from_lead
  FOREIGN KEY (converted_from_lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL;

-- ============================================================
-- GROUP: Contact ↔ Product (M:N — interested products)
-- ============================================================

CREATE TABLE crm_contact_interested_products (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID        NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  product_id UUID        NOT NULL REFERENCES crm_products(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, product_id)
);

-- ============================================================
-- GROUP: Opportunities
-- ============================================================

CREATE TABLE crm_opportunities (
  id                      UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    TEXT                  NOT NULL,
  contact_id              UUID                  NOT NULL REFERENCES crm_contacts(id) ON DELETE RESTRICT,
  account_id              UUID                  REFERENCES crm_accounts(id) ON DELETE SET NULL,
  value                   NUMERIC(15,2)         NOT NULL CHECK (value >= 0),
  expected_close_date     DATE,
  stage                   crm_opportunity_stage NOT NULL DEFAULT 'qualification',
  probability             INTEGER               NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
  source                  VARCHAR(100),
  -- trace กลับไป lead ผ่าน contact.converted_from_lead_id (ไม่ denormalize ชั้นนี้)
  last_activity_date      DATE,
  has_next_activity       BOOLEAN               NOT NULL DEFAULT false,
  owner_id                UUID                  NOT NULL REFERENCES employees(id),
  notes                   TEXT,
  created_at              TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ           NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

CREATE TABLE crm_opportunity_products (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  opportunity_id UUID          NOT NULL REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  product_id     UUID          NOT NULL REFERENCES crm_products(id) ON DELETE RESTRICT,
  quantity       INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price     NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
  line_total     NUMERIC(15,2) NOT NULL CHECK (line_total >= 0),
  added_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, product_id)
);

-- ============================================================
-- GROUP: Quotations
-- ============================================================

CREATE TABLE crm_quotations (
  id               UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- รูปแบบ QT-YYYYMM-NNNN เช่น QT-202604-0001
  -- atomic ผ่าน sequence — handler แค่ INSERT แล้ว RETURNING
  quotation_number VARCHAR(50)          NOT NULL UNIQUE DEFAULT (
    'QT-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('crm_quotation_seq')::text, 4, '0')
  ),
  opportunity_id   UUID                 NOT NULL REFERENCES crm_opportunities(id) ON DELETE RESTRICT,
  -- snapshot ณ เวลาสร้าง quote (เผื่อ contact ย้าย account ภายหลัง — ใบเสนอราคาต้อง immutable)
  contact_id       UUID                 REFERENCES crm_contacts(id),
  account_id       UUID                 REFERENCES crm_accounts(id),
  status           crm_quotation_status NOT NULL DEFAULT 'draft',
  subtotal         NUMERIC(15,2)        NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax              NUMERIC(15,2)        NOT NULL DEFAULT 0 CHECK (tax >= 0),
  discount         NUMERIC(15,2)        NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total            NUMERIC(15,2)        NOT NULL CHECK (total >= 0),
  -- ใช้ created_at::date แทน created_date (ไม่เก็บซ้ำ)
  valid_until      DATE,
  approved_date    TIMESTAMPTZ,
  rejected_date    TIMESTAMPTZ,
  created_by       UUID                 NOT NULL REFERENCES employees(id),
  approved_by      UUID                 REFERENCES employees(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ          NOT NULL DEFAULT now()
);

CREATE TABLE crm_quotation_line_items (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id     UUID          NOT NULL REFERENCES crm_quotations(id) ON DELETE CASCADE,
  product_id       UUID          NOT NULL REFERENCES crm_products(id),
  quantity         INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price       NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
  discount_percent NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  line_total       NUMERIC(15,2) NOT NULL CHECK (line_total >= 0),
  display_order    INTEGER       NOT NULL DEFAULT 0
);

-- ============================================================
-- GROUP: Activities (polymorphic)
-- ============================================================

CREATE TABLE crm_activities (
  id               UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_type    crm_activity_type NOT NULL,
  subject          TEXT              NOT NULL,
  notes            TEXT,
  -- polymorphic: related_to_id ไม่มี FK — ต้อง validate ใน handler
  related_to_type  crm_related_type  NOT NULL,
  related_to_id    UUID              NOT NULL,
  activity_date    DATE              NOT NULL,
  activity_time    TIME,
  duration_minutes INTEGER           CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  completed        BOOLEAN           NOT NULL DEFAULT false,
  completed_date   TIMESTAMPTZ,
  created_by       UUID              NOT NULL REFERENCES employees(id),
  assigned_to      UUID              REFERENCES employees(id),
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE TABLE crm_activity_attachments (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id     UUID         NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
  file_url        TEXT         NOT NULL,
  file_name       TEXT,
  file_size_bytes BIGINT,
  mime_type       VARCHAR(100),
  uploaded_by     UUID         NOT NULL REFERENCES employees(id),
  uploaded_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Products
CREATE INDEX idx_crm_products_category       ON crm_products(category);
CREATE INDEX idx_crm_products_is_active      ON crm_products(is_active);
CREATE INDEX idx_crm_product_files_product   ON crm_product_files(product_id);

-- Accounts
CREATE INDEX idx_crm_accounts_owner          ON crm_accounts(owner_id);
CREATE INDEX idx_crm_accounts_type           ON crm_accounts(type);
CREATE INDEX idx_crm_accounts_industry       ON crm_accounts(industry);
CREATE INDEX idx_crm_accounts_deleted_at     ON crm_accounts(deleted_at);

-- Contacts
CREATE INDEX idx_crm_contacts_account        ON crm_contacts(account_id);
CREATE INDEX idx_crm_contacts_owner          ON crm_contacts(owner_id);
CREATE INDEX idx_crm_contacts_temperature    ON crm_contacts(temperature);
CREATE INDEX idx_crm_contacts_converted_lead ON crm_contacts(converted_from_lead_id);
CREATE INDEX idx_crm_contacts_deleted_at     ON crm_contacts(deleted_at);

-- บังคับ primary contact เพียง 1 คนต่อ account (partial unique)
CREATE UNIQUE INDEX idx_crm_contacts_one_primary_per_account
  ON crm_contacts(account_id)
  WHERE is_primary = true AND deleted_at IS NULL;

-- Leads
CREATE INDEX idx_crm_leads_owner             ON crm_leads(owner_id);
CREATE INDEX idx_crm_leads_temperature       ON crm_leads(temperature);
CREATE INDEX idx_crm_leads_status            ON crm_leads(status);
CREATE INDEX idx_crm_leads_source            ON crm_leads(source);
CREATE INDEX idx_crm_leads_deleted_at        ON crm_leads(deleted_at);

-- Contact interested products
CREATE INDEX idx_crm_cip_contact             ON crm_contact_interested_products(contact_id);
CREATE INDEX idx_crm_cip_product             ON crm_contact_interested_products(product_id);

-- Opportunities
CREATE INDEX idx_crm_opps_stage              ON crm_opportunities(stage);
CREATE INDEX idx_crm_opps_owner              ON crm_opportunities(owner_id);
CREATE INDEX idx_crm_opps_account            ON crm_opportunities(account_id);
CREATE INDEX idx_crm_opps_contact            ON crm_opportunities(contact_id);
CREATE INDEX idx_crm_opps_close_date         ON crm_opportunities(expected_close_date);
CREATE INDEX idx_crm_opps_deleted_at         ON crm_opportunities(deleted_at);
CREATE INDEX idx_crm_op_opportunity          ON crm_opportunity_products(opportunity_id);
CREATE INDEX idx_crm_op_product              ON crm_opportunity_products(product_id);

-- Quotations
CREATE INDEX idx_crm_quotations_status       ON crm_quotations(status);
CREATE INDEX idx_crm_quotations_opportunity  ON crm_quotations(opportunity_id);
CREATE INDEX idx_crm_quotations_created_by   ON crm_quotations(created_by);
CREATE INDEX idx_crm_qli_quotation           ON crm_quotation_line_items(quotation_id);
CREATE INDEX idx_crm_qli_product             ON crm_quotation_line_items(product_id);

-- Activities
CREATE INDEX idx_crm_activities_related      ON crm_activities(related_to_type, related_to_id);
CREATE INDEX idx_crm_activities_date         ON crm_activities(activity_date);
CREATE INDEX idx_crm_activities_assigned     ON crm_activities(assigned_to);
CREATE INDEX idx_crm_activities_open         ON crm_activities(completed) WHERE completed = false;
CREATE INDEX idx_crm_aa_activity             ON crm_activity_attachments(activity_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- auto-update updated_at
CREATE OR REPLACE FUNCTION crm_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_crm_products_updated   BEFORE UPDATE ON crm_products
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER trg_crm_accounts_updated   BEFORE UPDATE ON crm_accounts
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER trg_crm_contacts_updated   BEFORE UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER trg_crm_leads_updated      BEFORE UPDATE ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER trg_crm_opps_updated       BEFORE UPDATE ON crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER trg_crm_quotations_updated BEFORE UPDATE ON crm_quotations
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
CREATE TRIGGER trg_crm_activities_updated BEFORE UPDATE ON crm_activities
  FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

-- auto-sync probability เมื่อ stage เปลี่ยน
CREATE OR REPLACE FUNCTION crm_sync_opportunity_probability() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.probability := CASE NEW.stage
      WHEN 'qualification' THEN 10
      WHEN 'proposal'      THEN 25
      WHEN 'negotiation'   THEN 50
      WHEN 'closed_won'    THEN 100
      WHEN 'closed_lost'   THEN 0
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_crm_opps_probability
  BEFORE UPDATE OF stage ON crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION crm_sync_opportunity_probability();

-- หมายเหตุ: permissions seed ดู Sub-phase 2.0 ใน Todo_task/phase_2.md (source เดียว)
