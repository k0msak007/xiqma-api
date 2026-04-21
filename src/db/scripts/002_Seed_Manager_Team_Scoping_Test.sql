-- 002_Seed_Manager_Team_Scoping_Test.sql
-- Seed data สำหรับทดสอบ manager team-scoping (PR: secure manager visibility)
--
-- สร้าง 2 managers และ 3 reports ต่อคน → ตรวจว่าเมื่อ login เป็น manager A
-- endpoint analytics/reports/tasks/leave/employees จะคืนเฉพาะข้อมูลของทีม A
--
-- รัน idempotent: ใช้ ON CONFLICT (employee_code) DO NOTHING
-- รหัสผ่านทุกคน: "password123"

BEGIN;

-- Manager A
INSERT INTO employees
  (employee_code, name, email, password_hash, role, department, is_active)
VALUES
  ('MGR-A', 'Manager Alpha', 'mgr.alpha@xiqma.test',
   crypt('password123', gen_salt('bf')), 'manager', 'Engineering', true)
ON CONFLICT (employee_code) DO NOTHING;

-- Manager B
INSERT INTO employees
  (employee_code, name, email, password_hash, role, department, is_active)
VALUES
  ('MGR-B', 'Manager Beta', 'mgr.beta@xiqma.test',
   crypt('password123', gen_salt('bf')), 'manager', 'Design', true)
ON CONFLICT (employee_code) DO NOTHING;

-- Reports ของ Manager A
INSERT INTO employees
  (employee_code, name, email, password_hash, role, department, manager_id, is_active)
SELECT v.code, v.name, v.email,
       crypt('password123', gen_salt('bf')),
       'employee', 'Engineering',
       (SELECT id FROM employees WHERE employee_code = 'MGR-A'),
       true
FROM (VALUES
  ('EMP-A1', 'Alice A1', 'a1@xiqma.test'),
  ('EMP-A2', 'Aaron A2', 'a2@xiqma.test'),
  ('EMP-A3', 'Anna  A3', 'a3@xiqma.test')
) AS v(code, name, email)
ON CONFLICT (employee_code) DO UPDATE
SET manager_id = EXCLUDED.manager_id;

-- Reports ของ Manager B
INSERT INTO employees
  (employee_code, name, email, password_hash, role, department, manager_id, is_active)
SELECT v.code, v.name, v.email,
       crypt('password123', gen_salt('bf')),
       'employee', 'Design',
       (SELECT id FROM employees WHERE employee_code = 'MGR-B'),
       true
FROM (VALUES
  ('EMP-B1', 'Bob   B1', 'b1@xiqma.test'),
  ('EMP-B2', 'Bella B2', 'b2@xiqma.test')
) AS v(code, name, email)
ON CONFLICT (employee_code) DO UPDATE
SET manager_id = EXCLUDED.manager_id;

COMMIT;

-- ตรวจสอบ
-- SELECT e.employee_code, e.name, e.role, m.employee_code AS manager_code
-- FROM employees e LEFT JOIN employees m ON m.id = e.manager_id
-- WHERE e.employee_code LIKE 'MGR-%' OR e.employee_code LIKE 'EMP-A%' OR e.employee_code LIKE 'EMP-B%'
-- ORDER BY e.employee_code;
