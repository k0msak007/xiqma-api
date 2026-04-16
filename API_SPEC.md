# Xiqma API Specification

**Base URL:** `http://localhost:3000/api`
**Content-Type:** `application/json`

> อัปเดตล่าสุด: 2026-04-16
> สถานะ: ✅ พร้อมใช้ | 🚧 กำลังพัฒนา | 📋 วางแผน

---

## การใช้งาน Authentication

ทุก endpoint ที่ต้องการ auth ให้แนบ header:

```
Authorization: Bearer <access_token>
```

**Token lifetime:**
| Token | อายุ |
|---|---|
| `access_token` | 15 นาที |
| `refresh_token` | 7 วัน (นับจากครั้งแรกที่ login เท่านั้น) |

เมื่อ `access_token` หมดอายุ ให้เรียก `POST /auth/refresh` เพื่อขอ token ใหม่ทั้งคู่

---

## Response Format

ทุก endpoint ใช้ format เดียวกัน

### ✅ Success
```json
{
  "success": true,
  "message": "ข้อความสำหรับแสดงผล",
  "data": { },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```
> `meta` มีเฉพาะ endpoint ที่ return list (pagination)

### ❌ Error
```json
{
  "success": false,
  "message": "ข้อความสำหรับแสดงให้ user อ่าน",
  "error": "ERROR_CODE",
  "details": []
}
```
> `details` มีเฉพาะ validation error — เป็น array ของ `{ field, message }`

### Error Codes ที่พบบ่อย

| `error` | HTTP | ความหมาย |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | email หรือ password ผิด |
| `MISSING_TOKEN` | 401 | ไม่ได้ส่ง Authorization header |
| `INVALID_TOKEN` | 401 | token ไม่ถูกต้องหรือถูก revoke |
| `TOKEN_EXPIRED` | 401 | token หมดอายุ → ต้อง refresh |
| `FORBIDDEN` | 403 | ไม่มีสิทธิ์ |
| `NOT_FOUND` | 404 | ไม่พบข้อมูล |
| `ALREADY_EXISTS` | 409 | ข้อมูลซ้ำ |
| `VALIDATION_ERROR` | 422 | ข้อมูลที่ส่งมาไม่ผ่าน validate |
| `WRONG_PASSWORD` | 400 | รหัสผ่านปัจจุบันผิด (ใช้ตอน change password) |
| `INTERNAL_ERROR` | 500 | server error |

---

## Rate Limit

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 10 req / นาที / IP |
| ทุก `/api/*` | 100 req / นาที / IP |

เมื่อเกิน limit จะได้รับ HTTP 429 พร้อม header:
```
Retry-After: 42
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1712636400
```

---

---

# Auth

## POST /auth/login ✅

เข้าสู่ระบบ — รับ email + password แล้วออก JWT

**Auth required:** ❌ Public

### Request Body
```json
{
  "email": "admin@xiqma.com",
  "password": "password123"
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `email` | string | ✅ | ต้องเป็น email format |
| `password` | string | ✅ | |

### Response 200
```json
{
  "success": true,
  "message": "เข้าสู่ระบบสำเร็จ",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiJ9...",
    "expires_in": 900,
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "สมชาย ใจดี",
      "email": "admin@xiqma.com",
      "role": "admin",
      "permissions": ["manage_users", "manage_tasks", "view_reports"]
    }
  }
}
```

| Field | Type | หมายเหตุ |
|---|---|---|
| `access_token` | string | ใส่ใน `Authorization: Bearer` |
| `refresh_token` | string | เก็บไว้ขอ token ใหม่ |
| `expires_in` | number | วินาที (900 = 15 นาที) |
| `user.role` | string | `employee` \| `manager` \| `hr` \| `admin` |
| `user.permissions` | string[] | สิทธิ์ที่มี ใช้ตัดสิน UI |

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | email ไม่มีในระบบ / password ผิด / account ถูก disable |
| `VALIDATION_ERROR` | 422 | email format ผิด หรือไม่ส่ง field ที่ required |

---

## POST /auth/refresh ✅

ขอ token ชุดใหม่ด้วย refresh token — **ต้องอัปเดตทั้งคู่ทุกครั้ง** (Refresh Token Rotation)

**Auth required:** ❌ Public

> ⚠️ **สำคัญ:** หลังเรียก endpoint นี้ refresh token เดิมจะถูก revoke ทันที
> client ต้องอัปเดต `refresh_token` ที่เก็บไว้ทุกครั้งที่เรียก

### Request Body
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiJ9...",
    "expires_in": 900
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `INVALID_TOKEN` | 401 | token ไม่มีในระบบ หรือถูก revoke แล้ว |
| `TOKEN_EXPIRED` | 401 | refresh token หมดอายุ ต้อง login ใหม่ |

---

## POST /auth/logout ✅

ออกจากระบบ — revoke refresh token

**Auth required:** ❌ Public (ส่ง refresh_token มา revoke)

### Request Body
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": {
    "message": "Logged out successfully"
  }
}
```

---

## GET /auth/me ✅

ดูข้อมูล session ปัจจุบัน — ใช้ตอน app เริ่ม เพื่อโหลด user และ permissions

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "role": "admin",
    "permissions": ["manage_users", "manage_tasks", "view_reports"]
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `MISSING_TOKEN` | 401 | ไม่มี Authorization header |
| `INVALID_TOKEN` | 401 | token ไม่ถูกต้อง |
| `TOKEN_EXPIRED` | 401 | access token หมดอายุ |

---

## PUT /auth/me/password ✅

เปลี่ยนรหัสผ่านของตัวเอง — หลังสำเร็จ session อื่นทุกอุปกรณ์จะถูก logout

**Auth required:** ✅

### Request Body
```json
{
  "currentPassword": "password123",
  "newPassword": "newPassword456",
  "confirmPassword": "newPassword456"
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `currentPassword` | string | ✅ | |
| `newPassword` | string | ✅ | อย่างน้อย 8 ตัวอักษร |
| `confirmPassword` | string | ✅ | ต้องตรงกับ `newPassword` |

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": {
    "message": "เปลี่ยนรหัสผ่านสำเร็จ"
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `WRONG_PASSWORD` | 400 | `currentPassword` ผิด |
| `VALIDATION_ERROR` | 422 | `newPassword` < 8 ตัว หรือ confirm ไม่ตรง |

---

---

# Employees 🚧

> ทุก endpoint ใน group นี้ต้องการ `Authorization: Bearer <token>`

## GET /employees ✅

ดูรายชื่อพนักงาน

**Auth required:** ✅
**Permission:** `manage_employees` หรือ `hr` / `admin`

### Query Parameters
| Param | Type | Default | หมายเหตุ |
|---|---|---|---|
| `search` | string | — | ค้นหาชื่อหรือ email |
| `department` | string | — | filter ตาม department |
| `isActive` | boolean | — | `true` \| `false` — ถ้าไม่ระบุ คืนทุกสถานะ |
| `page` | number | `1` | |
| `limit` | number | `20` | max 100 |

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "employeeCode": "EMP001",
      "name": "สมชาย ใจดี",
      "email": "somchai@xiqma.com",
      "role": "employee",
      "department": "Engineering",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

## GET /employees/:id ✅

ดูข้อมูลพนักงานรายคน

**Auth required:** ✅

### Path Parameters
| Param | Type | หมายเหตุ |
|---|---|---|
| `id` | UUID | employee id |

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "employeeCode": "EMP001",
    "name": "สมชาย ใจดี",
    "email": "somchai@xiqma.com",
    "avatarUrl": "https://...",
    "role": "employee",
    "roleId": "...",
    "positionId": "...",
    "managerId": "...",
    "department": "Engineering",
    "isActive": true,
    "leaveQuotaAnnual": 10,
    "leaveQuotaSick": 30,
    "leaveQuotaPersonal": 3,
    "registeredAt": "2024-01-01T00:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `NOT_FOUND` | 404 | ไม่พบพนักงาน |

---

## POST /employees ✅

สร้างพนักงานใหม่

**Auth required:** ✅
**Permission:** `manage_employees`

### Request Body
```json
{
  "employeeCode": "EMP099",
  "name": "สมหญิง รักงาน",
  "email": "somying@xiqma.com",
  "password": "password123",
  "role": "employee",
  "roleId": "uuid-ของ-role",
  "positionId": "uuid-ของ-position",
  "managerId": "uuid-ของ-manager",
  "department": "Engineering",
  "leaveQuotaAnnual": 10,
  "leaveQuotaSick": 30,
  "leaveQuotaPersonal": 3
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `employeeCode` | string | ✅ | ต้องไม่ซ้ำ |
| `name` | string | ✅ | |
| `email` | string | — | ต้องไม่ซ้ำถ้าส่งมา |
| `password` | string | ✅ | อย่างน้อย 8 ตัวอักษร |
| `role` | string | — | default `employee` |
| `roleId` | UUID | — | |
| `positionId` | UUID | — | |
| `managerId` | UUID | — | |
| `department` | string | — | |
| `leaveQuotaAnnual` | number | — | default 10 |
| `leaveQuotaSick` | number | — | default 30 |
| `leaveQuotaPersonal` | number | — | default 3 |

### Response 201
```json
{
  "success": true,
  "message": "สร้างพนักงานสำเร็จ",
  "data": { "id": "...", "employeeCode": "EMP099", ... }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `EMAIL_EXISTS` | 409 | email ซ้ำ |
| `ALREADY_EXISTS` | 409 | employeeCode ซ้ำ |
| `VALIDATION_ERROR` | 422 | ข้อมูลไม่ถูกต้อง |

---

## PUT /employees/:id ✅

แก้ไขข้อมูลพนักงาน

**Auth required:** ✅
**Permission:** `manage_employees`

### Request Body (ส่งเฉพาะ field ที่ต้องการแก้)
```json
{
  "name": "สมชาย ใจดีมาก",
  "department": "Design",
  "isActive": false
}
```

| Field | Type | หมายเหตุ |
|---|---|---|
| `name` | string | |
| `email` | string | |
| `roleId` | UUID | |
| `positionId` | UUID | |
| `managerId` | UUID | |
| `department` | string | |
| `isActive` | boolean | |

### Response 200
```json
{
  "success": true,
  "message": "อัปเดตข้อมูลสำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## PATCH /employees/:id/deactivate ✅

ปิดการใช้งานพนักงาน (soft delete)

**Auth required:** ✅
**Permission:** `manage_employees`

### Path Parameters
| Param | Type | หมายเหตุ |
|---|---|---|
| `id` | UUID | employee id |

### Response 200
```json
{
  "success": true,
  "message": "ปิดการใช้งานพนักงานสำเร็จ",
  "data": { "id": "...", "isActive": false, ... }
}
```

---

---

# Tasks 🚧

> ทุก endpoint ใน group นี้ต้องการ `Authorization: Bearer <token>`

## GET /tasks 📋

ดูรายการ task

**Auth required:** ✅

### Query Parameters
| Param | Type | Default | หมายเหตุ |
|---|---|---|---|
| `listId` | UUID | — | filter ตาม list |
| `statusId` | UUID | — | filter ตาม status |
| `assigneeId` | UUID | — | filter ตามผู้รับผิดชอบ |
| `priority` | string | — | `low` \| `normal` \| `high` \| `urgent` |
| `search` | string | — | ค้นหาชื่องาน |
| `page` | number | `1` | |
| `limit` | number | `50` | max 100 |
| `sort` | string | `display_order` | `deadline` \| `created_at` \| `priority` \| `display_order` |
| `order` | string | `asc` | `asc` \| `desc` |

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": [
    {
      "id": "uuid",
      "displayId": "TASK-0001",
      "title": "ออกแบบ UI หน้า Dashboard",
      "description": "...",
      "priority": "high",
      "status": "in_progress",
      "assigneeId": "uuid",
      "listId": "uuid",
      "storyPoints": 5,
      "deadline": "2024-12-31T17:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 50, "total": 120, "totalPages": 3 }
}
```

---

## GET /tasks/:id 📋

ดูรายละเอียด task

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "success",
  "data": {
    "id": "uuid",
    "displayId": "TASK-0001",
    "title": "ออกแบบ UI หน้า Dashboard",
    "description": "รายละเอียดงาน...",
    "listId": "uuid",
    "listStatusId": "uuid",
    "taskTypeId": "uuid",
    "priority": "high",
    "status": "in_progress",
    "assigneeId": "uuid",
    "creatorId": "uuid",
    "storyPoints": 5,
    "timeEstimateHours": 8,
    "planStart": "2024-12-01",
    "durationDays": 5,
    "planFinish": "2024-12-05",
    "deadline": "2024-12-31T17:00:00.000Z",
    "accumulatedMinutes": 120,
    "actualHours": 2,
    "tags": ["frontend", "design"],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `NOT_FOUND` | 404 | ไม่พบ task |

---

## POST /tasks 📋

สร้าง task ใหม่

**Auth required:** ✅

### Request Body
```json
{
  "title": "ออกแบบ UI หน้า Dashboard",
  "description": "รายละเอียดงาน",
  "listId": "uuid",
  "listStatusId": "uuid",
  "taskTypeId": "uuid",
  "priority": "high",
  "assigneeId": "uuid",
  "storyPoints": 5,
  "timeEstimateHours": 8,
  "planStart": "2024-12-01",
  "durationDays": 5,
  "deadline": "2024-12-31T17:00:00.000Z",
  "tags": ["frontend", "design"]
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `title` | string | ✅ | |
| `listId` | UUID | ✅ | |
| `assigneeId` | UUID | ✅ | |
| `description` | string | — | |
| `listStatusId` | UUID | — | |
| `taskTypeId` | UUID | — | |
| `priority` | string | — | default `normal` |
| `storyPoints` | number | — | ค่าที่ valid: 1,2,3,5,8,13,21 |
| `timeEstimateHours` | number | — | |
| `planStart` | string | — | format `YYYY-MM-DD` |
| `durationDays` | number | — | |
| `deadline` | string | — | format ISO 8601 |
| `tags` | string[] | — | default `[]` |

### Response 201
```json
{
  "success": true,
  "message": "สร้าง task สำเร็จ",
  "data": { "id": "uuid", "displayId": "TASK-0042", ... }
}
```

---

## PUT /tasks/:id 📋

แก้ไข task (ส่งเฉพาะ field ที่ต้องการแก้)

**Auth required:** ✅

### Request Body
ส่งเฉพาะ field ที่ต้องการแก้ — ทุก field เป็น optional (ยกเว้น `listId` ที่เปลี่ยนไม่ได้)

---

## PATCH /tasks/:id/status 📋

เปลี่ยนสถานะ task

**Auth required:** ✅

### Request Body
```json
{
  "listStatusId": "uuid",
  "status": "in_progress"
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `listStatusId` | UUID | ✅ | |
| `status` | string | — | `pending` \| `in_progress` \| `paused` \| `review` \| `completed` \| `cancelled` \| `blocked` \| `overdue` |

---

## POST /tasks/reorder 📋

เรียงลำดับ task ใหม่ใน column (drag & drop)

**Auth required:** ✅

### Request Body
```json
{
  "listId": "uuid",
  "statusId": "uuid",
  "orderedTaskIds": ["uuid-1", "uuid-2", "uuid-3"]
}
```

---

## DELETE /tasks/:id 📋

ลบ task

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "ลบ task สำเร็จ",
  "data": null
}
```

---

---

# Enums Reference

## Role
| Value | ความหมาย |
|---|---|
| `employee` | พนักงานทั่วไป |
| `manager` | หัวหน้า |
| `hr` | ฝ่ายบุคคล |
| `admin` | ผู้ดูแลระบบ |

## Task Status
| Value | ความหมาย |
|---|---|
| `pending` | รอดำเนินการ |
| `in_progress` | กำลังทำ |
| `paused` | หยุดชั่วคราว |
| `review` | รอตรวจสอบ |
| `completed` | เสร็จแล้ว |
| `cancelled` | ยกเลิก |
| `blocked` | ติดปัญหา |
| `overdue` | เกินกำหนด |

## Task Priority
| Value | ความหมาย |
|---|---|
| `low` | ต่ำ |
| `normal` | ปกติ |
| `high` | สูง |
| `urgent` | เร่งด่วน |

## Story Points
ค่าที่ valid เท่านั้น: `1`, `2`, `3`, `5`, `8`, `13`, `21`

---

---

# Roles ✅

> ทุก endpoint ใน group นี้ต้องการ `Authorization: Bearer <token>`

## GET /roles ✅

ดู roles ทั้งหมด

**Auth required:** ✅
**Permission:** `manage_roles` (admin)

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูล roles สำเร็จ",
  "data": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "ผู้ดูแลระบบ",
      "color": "#FF5722",
      "permissions": ["manage_users", "manage_roles", "manage_tasks", "view_reports"]
    }
  ]
}
```

---

## GET /roles/:id ✅

ดู role เดียว

**Auth required:** ✅
**Permission:** `manage_roles`

### Path Parameters
| Param | Type | หมายเหตุ |
|---|---|---|
| `id` | UUID | role id |

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูล role สำเร็จ",
  "data": { "id": "...", "name": "admin", ... }
}
```

---

## POST /roles ✅

สร้าง role ใหม่

**Auth required:** ✅
**Permission:** `manage_roles`

### Request Body
```json
{
  "name": "developer",
  "description": "นักพัฒนา",
  "color": "#2196F3",
  "permissions": ["manage_tasks", "view_reports"]
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `name` | string | ✅ | ต้องไม่ซ้ำ |
| `description` | string | — | |
| `color` | string | ✅ | hex color |
| `permissions` | string[] | ✅ | array ของ permission names |

### Response 201
```json
{
  "success": true,
  "message": "สร้าง role สำเร็จ",
  "data": { "id": "...", "name": "developer", ... }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `ROLE_NAME_EXISTS` | 409 | ชื่อซ้ำ |

---

## PUT /roles/:id ✅

แก้ไข role

**Auth required:** ✅
**Permission:** `manage_roles`

### Request Body
```json
{
  "name": "developer",
  "color": "#4CAF50"
}
```

### Response 200
```json
{
  "success": true,
  "message": "แก้ไข role สำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## DELETE /roles/:id ✅

ลบ role

**Auth required:** ✅
**Permission:** `manage_roles`

### Response 200
```json
{
  "success": true,
  "message": "ลบ role สำเร็จ",
  "data": null
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `ROLE_IN_USE` | 409 | มีพนักงานใช้ role นี้ |

---

---

# Positions ✅

> ทุก endpoint ใน group นี้ต้องการ `Authorization: Bearer <token>`

## GET /positions ✅

ดูตำแหน่งทั้งหมด

**Auth required:** ✅
**Permission:** `manage_workspace` (admin)

### Query Parameters
| Param | Type | Default | หมายเหตุ |
|---|---|---|---|
| `department` | string | — | filter ตาม department |

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูลตำแหน่งสำเร็จ",
  "data": [
    {
      "id": "uuid",
      "name": "Software Engineer",
      "department": "Engineering",
      "level": 1,
      "jobLevelCode": "SE",
      "color": "#2196F3",
      "parentPositionId": "uuid"
    }
  ]
}
```

---

## GET /positions/:id ✅

ดูตำแหน่งเดียว

**Auth required:** ✅

### Path Parameters
| Param | Type | หมายเหตุ |
|---|---|---|
| `id` | UUID | position id |

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูลตำแหน่งสำเร็จ",
  "data": { "id": "...", "name": "Software Engineer", ... }
}
```

---

## POST /positions ✅

สร้างตำแหน่งใหม่

**Auth required:** ✅
**Permission:** `manage_workspace`

### Request Body
```json
{
  "name": "Senior Developer",
  "department": "Engineering",
  "level": 2,
  "jobLevelCode": "SE2",
  "color": "#4CAF50",
  "parentPositionId": "uuid"
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `name` | string | ✅ | |
| `department` | string | — | |
| `level` | number | ✅ | |
| `jobLevelCode` | string | — | |
| `color` | string | ✅ | hex color |
| `parentPositionId` | UUID | — | |

### Response 201
```json
{
  "success": true,
  "message": "สร้างตำแหน่งสำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## PUT /positions/:id ✅

แก้ไขตำแหน่ง

**Auth required:** ✅
**Permission:** `manage_workspace`

### Response 200
```json
{
  "success": true,
  "message": "แก้ไขตำแหน่งสำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## DELETE /positions/:id ✅

ลบตำแหน่ง (soft delete)

**Auth required:** ✅
**Permission:** `manage_workspace`

### Response 200
```json
{
  "success": true,
  "message": "ลบตำแหน่งสำเร็จ",
  "data": null
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `POSITION_IN_USE` | 409 | มีพนักงานอยู่ในตำแหน่งนี้ |

---

---

# Work Schedules ✅

> ทุก endpoint ใน group นี้ต้องการ `Authorization: Bearer <token>`

## GET /work-schedules ✅

ดูตารางเวลาทำงานทั้งหมด

**Auth required:** ✅
**Permission:** `manage_workspace` (admin)

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูล work schedules สำเร็จ",
  "data": [
    {
      "id": "uuid",
      "name": "Full-time",
      "daysPerWeek": 5,
      "hoursPerDay": 8,
      "hoursPerWeek": 40,
      "workDays": [1, 2, 3, 4, 5],
      "workStartTime": "09:00",
      "workEndTime": "18:00",
      "isDefault": true
    }
  ]
}
```

---

## GET /work-schedules/:id ✅

ดูตารางเวลาเดียว

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูล work schedule สำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## POST /work-schedules ✅

สร้างตารางเวลาใหม่

**Auth required:** ✅

### Request Body
```json
{
  "name": "Part-time",
  "daysPerWeek": 3,
  "hoursPerDay": 4,
  "workDays": [1, 3, 5],
  "workStartTime": "09:00",
  "workEndTime": "13:00",
  "isDefault": false
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `name` | string | ✅ | |
| `daysPerWeek` | number | ✅ | |
| `hoursPerDay` | number | ✅ | |
| `workDays` | number[] | ✅ | array of 0-6 (0=อาทิตย์) |
| `workStartTime` | string | ✅ | HH:mm |
| `workEndTime` | string | ✅ | HH:mm |
| `isDefault` | boolean | — | default false |

### Response 201
```json
{
  "success": true,
  "message": "สร้าง work schedule สำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## PUT /work-schedules/:id ✅

แก้ไขตารางเวลา

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "แก้ไข work schedule สำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## DELETE /work-schedules/:id ✅

ลบตารางเวลา

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "ลบ work schedule สำเร็จ",
  "data": null
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `WORK_SCHEDULE_IN_USE` | 409 | มีพนักงานใช้ schedule นี้ |

---

---

# Holidays ✅

> ทุก endpoint ใน group นี้ต้องการ `Authorization: Bearer <token>`

## GET /holidays ✅

ดูวันหยุดทั้งหมด

**Auth required:** ✅

### Query Parameters
| Param | Type | Default | หมายเหตุ |
|---|---|---|---|
| `year` | number | — | filter ตามปี |

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูลวันหยุดสำเร็จ",
  "data": [
    {
      "id": "uuid",
      "name": "วันปีใหม่",
      "holidayDate": "2026-01-01",
      "isRecurring": true,
      "note": null
    }
  ]
}
```

---

## GET /holidays/:id ✅

ดูวันหยุดเดียว

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูลวันหยุดสำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## GET /holidays/working-days ✅

นับวันทำงานจริงในช่วง (ใช้คำนวณวันลา)

**Auth required:** ✅

### Query Parameters
| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `start` | string | ✅ | YYYY-MM-DD |
| `end` | string | ✅ | YYYY-MM-DD |

### Response 200
```json
{
  "success": true,
  "message": "นับวันทำงานสำเร็จ",
  "data": {
    "workingDays": 20
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `VALIDATION_ERROR` | 400 | start > end |

---

## POST /holidays ✅

สร้างวันหยุดใหม่

**Auth required:** ✅

### Request Body
```json
{
  "name": "วันสตาร์ท",
  "holidayDate": "2026-01-02",
  "isRecurring": false,
  "note": "ตั้งขึ้นเอง"
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `name` | string | ✅ | |
| `holidayDate` | string | ✅ | YYYY-MM-DD |
| `isRecurring` | boolean | — | default false |
| `note` | string | — | |

### Response 201
```json
{
  "success": true,
  "message": "สร้างวันหยุดสำเร็จ",
  "data": { "id": "...", ... }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `HOLIDAY_DATE_EXISTS` | 409 | วันที่ซ้ำ |

---

## PUT /holidays/:id ✅

แก้ไขวันหยุด

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "แก้ไขวันหยุดสำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## DELETE /holidays/:id ✅

ลบวันหยุด

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "ลบวันหยุดสำเร็จ",
  "data": null
}
```

---

---

# Task Types ✅

> ทุก endpoint ใน group นี้ต้องการ `Authorization: Bearer <token>`

## GET /task-types ✅

ดูประเภท task ทั้งหมด

**Auth required:** ✅

### Query Parameters
| Param | Type | Default | หมายเหตุ |
|---|---|---|---|
| `category` | string | — | `private` \| `organization` |

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูล task types สำเร็จ",
  "data": [
    {
      "id": "uuid",
      "name": "Bug Fix",
      "description": "แก้บ",
      "color": "#F44336",
      "category": "organization",
      "countsForPoints": true,
      "fixedPoints": null
    }
  ]
}
```

---

## GET /task-types/:id ✅

ดู task type เดียว

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "���ึงข้อมูล task type สำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## POST /task-types ✅

สร้าง task type ใหม่

**Auth required:** ✅

### Request Body
```json
{
  "name": "Meeting",
  "description": "ประชุม",
  "color": "#9C27B0",
  "category": "organization",
  "countsForPoints": true
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `name` | string | ✅ | |
| `description` | string | — | |
| `color` | string | ✅ | hex color |
| `category` | string | ✅ | `private` หรือ `organization` |
| `countsForPoints` | boolean | ✅ | |
| `fixedPoints` | number | — | required if category=`private` |

### Response 201
```json
{
  "success": true,
  "message": "สร้าง task type สำเร็จ",
  "data": { "id": "...", ... }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `VALIDATION_ERROR` | 400 | category=`private` แต่ไม่มี fixedPoints |

---

## PUT /task-types/:id ✅

แก้ไข task type

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "แก้ไข task type สำเร็จ",
  "data": { "id": "...", ... }
}
```

---

## DELETE /task-types/:id ✅

ลบ task type

**Auth required:** ✅

### Response 200
```json
{
  "success": true,
  "message": "ลบ task type สำเร็จ",
  "data": null
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `TASK_TYPE_IN_USE` | 409 | มี task ใช้ type นี้ |

---

---

# Employees ✅ (Update)

เพิ่ม endpoints สำหรับ avatar และ password:

## PATCH /employees/:id/avatar ✅

อัปโหลดรูปโปรไฟล์

**Auth required:** ✅

### Content-Type: `multipart/form-data`

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `file` | File | ✅ | JPEG, PNG, WebP, max 5MB |

### Path Parameters
| Param | Type | หมายเหตุ |
|---|---|---|
| `id` | UUID | employee id |

### Response 200
```json
{
  "success": true,
  "message": "อัปโหลดรูปโปรไฟล์สำเร็จ",
  "data": {
    "id": "...",
    "avatarUrl": "https://..."
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `FORBIDDEN` | 403 | ไม่มีสิทธิ์แก้ไขรูปโปรไฟล์ของผู้อื่น |
| `VALIDATION_ERROR` | 400 | ไฟล์ไม่ถูกต้อง หรือเกิน 5MB |

---

## PUT /employees/me/password ✅

เปลี่ยนรหัสผ่านของตัวเอง

**Auth required:** ✅

### Request Body
```json
{
  "currentPassword": "password123",
  "newPassword": "newPassword456"
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `currentPassword` | string | ✅ | |
| `newPassword` | string | ✅ | อย่างน้อย 8 ตัวอักษร |

### Response 200
```json
{
  "success": true,
  "message": "เปลี่ยนรหัสผ่านสำเร็จ",
  "data": null
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `WRONG_PASSWORD` | 400 | currentPassword ผิด |
| `VALIDATION_ERROR` | 400 | newPassword < 8 ตัว |

---

---

# Flow ที่ Frontend ควรรู้

## Auth Flow
```
1. POST /auth/login
   → เก็บ access_token และ refresh_token

2. ทุก request แนบ Authorization: Bearer <access_token>

3. ถ้าได้รับ TOKEN_EXPIRED (401)
   → POST /auth/refresh (ส่ง refreshToken)
   → อัปเดต access_token และ refresh_token ที่เก็บไว้
   → retry request เดิม

4. ถ้า refresh ก็ fail (INVALID_TOKEN / TOKEN_EXPIRED)
   → redirect ไปหน้า login

5. POST /auth/logout
   → ลบ token ที่เก็บไว้
```

## Token Storage แนะนำ
- **Web:** `httpOnly cookie` (ปลอดภัยกว่า) หรือ `memory` (ไม่ใช้ localStorage)
- **Mobile:** Secure Storage

---

---

# Workspace Hierarchy

## GET /spaces ✅

ดึง space ทั้งหมดที่ user เข้าถึงได้ — admin เห็นทั้งหมด, คนอื่นเห็นเฉพาะที่ตัวเองเป็น member

**Auth required:** ✅ Bearer token

### Response 200
```json
{
  "success": true,
  "message": "ดึงข้อมูล space สำเร็จ",
  "data": [
    {
      "id": "uuid",
      "name": "Engineering",
      "color": "#3b82f6",
      "icon": null,
      "displayOrder": 1,
      "memberCount": 5,
      "listCount": 3,
      "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## GET /spaces/:id ✅

ดูรายละเอียด space เดียว รวม member list

**Auth required:** ✅ Bearer token | member ของ space หรือ admin

### Response 200
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Engineering",
    "color": "#3b82f6",
    "members": [
      {
        "id": "uuid",
        "employeeId": "uuid",
        "joinedAt": "2026-04-14T00:00:00Z",
        "employee": { "id": "uuid", "name": "สมชาย", "email": "s@x.com", "avatarUrl": null }
      }
    ]
  }
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `NOT_FOUND` | 404 | ไม่พบ space |
| `FORBIDDEN` | 403 | ไม่ได้เป็น member |

---

## POST /spaces ✅

สร้าง space ใหม่

**Auth required:** ✅ Bearer token

### Request Body
```json
{
  "name": "Engineering",
  "color": "#3b82f6",
  "icon": "💻",
  "memberIds": ["uuid1", "uuid2"]
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `name` | string | ✅ | max 100 ตัว |
| `color` | string | ❌ | hex color, default `#3b82f6` |
| `icon` | string | ❌ | emoji หรือ icon name |
| `memberIds` | string[] | ❌ | UUID ของพนักงานที่เพิ่มเป็น member ทันที |

### Response 201
```json
{ "success": true, "message": "สร้าง space สำเร็จ", "data": { "id": "uuid", "name": "Engineering", ... } }
```

---

## PUT /spaces/:id ✅

แก้ชื่อ/สี/icon/ลำดับของ space

**Auth required:** ✅ Bearer token | member ของ space หรือ admin

### Request Body
```json
{ "name": "Engineering Team", "color": "#8b5cf6", "icon": "🔧", "displayOrder": 2 }
```

---

## DELETE /spaces/:id ✅

ลบ space — block ถ้ายังมี folder หรือ list อยู่

**Auth required:** ✅ Bearer token

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `SPACE_HAS_ACTIVE_CONTENT` | 409 | ยังมี folder หรือ list อยู่ภายใน |

---

## POST /spaces/:id/members ✅

เพิ่มสมาชิกเข้า space (batch)

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "employeeIds": ["uuid1", "uuid2"] }
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `NOT_FOUND` | 404 | employee ไม่มีหรือ inactive |

---

## DELETE /spaces/:id/members/:employeeId ✅

ลบสมาชิกออกจาก space

**Auth required:** ✅ Bearer token

---

## GET /folders ✅

ดึง folder ทั้งหมดใน space — default ซ่อน archived

**Auth required:** ✅ Bearer token | member ของ space

### Query Parameters
| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `spaceId` | uuid | ✅ | |
| `includeArchived` | boolean | ❌ | default `false` |

### Response 200
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "name": "Sprint 1", "spaceId": "uuid",
      "color": null, "displayOrder": 1,
      "isArchived": false, "archivedAt": null,
      "listCount": 3, "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## POST /folders ✅

สร้าง folder ใหม่ใน space

**Auth required:** ✅ Bearer token | member ของ space

### Request Body
```json
{ "name": "Sprint 1", "spaceId": "uuid", "color": "#f59e0b" }
```

---

## PUT /folders/:id ✅

แก้ชื่อ/สี/ลำดับ folder

**Auth required:** ✅ Bearer token

---

## PATCH /folders/:id/archive ✅

Archive folder (ซ่อนจาก sidebar)

**Auth required:** ✅ Bearer token

### Response 200
```json
{ "success": true, "message": "archive folder สำเร็จ", "data": { "isArchived": true, "archivedAt": "2026-04-14T..." } }
```

---

## PATCH /folders/:id/restore ✅

Restore folder ออกจาก archive

**Auth required:** ✅ Bearer token

---

## DELETE /folders/:id ✅

ลบ folder ถาวร — ต้อง archive ก่อน

**Auth required:** ✅ Bearer token

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `FOLDER_NOT_ARCHIVED` | 400 | folder ยังไม่ได้ archive |

---

## GET /lists ✅

ดึง list ใน space/folder พร้อม statuses และ task count

**Auth required:** ✅ Bearer token | member ของ space

### Query Parameters
| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `spaceId` | uuid | ✅ | |
| `folderId` | uuid | ❌ | filter เฉพาะ folder นั้น |

### Response 200
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "name": "Backlog", "spaceId": "uuid", "folderId": null,
      "color": null, "displayOrder": 1,
      "taskCount": 12, "doneCount": 5,
      "statuses": [
        { "id": "uuid", "name": "Open", "color": "#6b7280", "type": "open", "displayOrder": 1 },
        { "id": "uuid", "name": "In Progress", "color": "#3b82f6", "type": "in_progress", "displayOrder": 2 }
      ],
      "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## POST /lists ✅

สร้าง list ใหม่ — auto-seed 5 statuses ทันที (Open → In Progress → Review → Done → Closed)

**Auth required:** ✅ Bearer token | member ของ space

### Request Body
```json
{ "name": "Backlog", "spaceId": "uuid", "folderId": "uuid", "color": null }
```

### Response 201
```json
{ "success": true, "message": "สร้าง list สำเร็จ", "data": { "id": "uuid", "name": "Backlog", ... } }
```

---

## PUT /lists/:id ✅

แก้ชื่อ/สี/ลำดับ list

**Auth required:** ✅ Bearer token

---

## DELETE /lists/:id ✅

ลบ list — block ถ้ายังมี active task

**Auth required:** ✅ Bearer token

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `LIST_HAS_ACTIVE_TASKS` | 409 | ยังมี task ที่ยังไม่ลบอยู่ใน list |

---

## GET /lists/:id/statuses ✅

ดึง status columns ของ list เรียงตาม displayOrder

**Auth required:** ✅ Bearer token

### Response 200
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "listId": "uuid", "name": "Open", "color": "#6b7280", "type": "open", "displayOrder": 1 }
  ]
}
```

---

## POST /lists/:id/statuses ✅

เพิ่ม status column ใหม่ใน list

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "name": "QA", "color": "#ec4899", "type": "review" }
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `name` | string | ✅ | |
| `color` | string | ✅ | hex color |
| `type` | string | ✅ | `open` \| `in_progress` \| `review` \| `done` \| `closed` |

---

## PUT /lists/:id/statuses/reorder ✅

เรียงลำดับ status columns ใหม่ (drag & drop)

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "orderedIds": ["uuid-open", "uuid-inprog", "uuid-qa", "uuid-done", "uuid-closed"] }
```

---

## PUT /lists/:id/statuses/:statusId ✅

แก้ชื่อ/สี/ประเภทของ status column

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "name": "QA Testing", "color": "#f97316", "type": "review" }
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `NOT_FOUND` | 404 | statusId ไม่อยู่ใน list นี้ |

---

## DELETE /lists/:id/statuses/:statusId ✅

ลบ status column — block ถ้ายังมี task ใช้ status นี้

**Auth required:** ✅ Bearer token

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `STATUS_IN_USE` | 409 | ยังมี task ที่ใช้ status นี้อยู่ |

---

> 📌 endpoint ที่ยังไม่ได้ระบุ response shape จะอัปเดตเมื่อ implement เสร็จ

---

---

# Phase 3 — Task Management

## GET /api/tasks ✅

ดึง task ใน list — ใช้ render Kanban view และ Table view

**Auth required:** ✅ Bearer token

### Query Parameters

| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `listId` | string (uuid) | ✅ | |
| `statusId` | string (uuid) | ❌ | filter ตาม status column |
| `assigneeId` | string (uuid) | ❌ | |
| `priority` | string | ❌ | `low` \| `medium` \| `high` \| `urgent` |
| `search` | string | ❌ | ILIKE title |
| `page` | number | ❌ | default 1 |
| `limit` | number | ❌ | default 20 |
| `sort` | string | ❌ | default `display_order ASC` |

---

## GET /api/tasks/my ✅

ดึง task ที่ assign ให้ตัวเอง — ใช้แสดงหน้า "My Tasks"

**Auth required:** ✅ Bearer token

### Query Parameters

| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `range` | string | ❌ | `today` \| `week` \| `month` |

---

## GET /api/tasks/calendar ✅

ดึง task ที่มี deadline หรือ plan อยู่ในช่วงที่กำหนด — ใช้แสดง calendar view

**Auth required:** ✅ Bearer token

### Query Parameters

| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `start` | date string | ✅ | |
| `end` | date string | ✅ | |

---

## GET /api/tasks/:id ✅

ดูรายละเอียด task เต็ม รวม subtasks, ผู้รับผิดชอบ, comment count, attachment count

**Auth required:** ✅ Bearer token

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `NOT_FOUND` | 404 | ไม่พบ task |

---

## POST /api/tasks ✅

สร้าง task ใหม่

**Auth required:** ✅ Bearer token

### Request Body
```json
{
  "title": "ออกแบบ UI หน้า Dashboard",
  "listId": "uuid",
  "listStatusId": "uuid",
  "priority": "high",
  "assigneeId": "uuid",
  "planStart": "2026-04-15",
  "durationDays": 3,
  "estimateHours": 8,
  "taskTypeId": "uuid"
}
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `title` | string | ✅ | |
| `listId` | string (uuid) | ✅ | |
| `listStatusId` | string (uuid) | ✅ | |
| `priority` | string | ✅ | `low` \| `medium` \| `high` \| `urgent` |
| `assigneeId` | string (uuid) | ❌ | |
| `planStart` | date string | ❌ | |
| `durationDays` | number | ❌ | คำนวณ `planFinish` อัตโนมัติ |
| `estimateHours` | number | ❌ | |
| `taskTypeId` | string (uuid) | ❌ | |

---

## PUT /api/tasks/:id ✅

แก้รายละเอียด task ทั้งหมด (full update)

**Auth required:** ✅ Bearer token | assignee, creator, manager, admin

---

## PATCH /api/tasks/:id/status ✅

เปลี่ยน status column ของ task (Kanban drag & drop หรือกด button)

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "listStatusId": "uuid", "status": "in_progress" }
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `listStatusId` | string (uuid) | ✅ | |
| `status` | string | ❌ | `pending` \| `in_progress` \| `paused` \| `completed` \| `cancelled` |

---

## PUT /api/tasks/reorder ✅

เรียงลำดับ task ใน column ใหม่ (drag & drop บน Kanban)

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "listId": "uuid", "statusId": "uuid", "orderedTaskIds": ["uuid1", "uuid2", "uuid3"] }
```

---

## DELETE /api/tasks/:id ✅

ยกเลิก task (soft delete — เปลี่ยน status เป็น `cancelled`)

**Auth required:** ✅ Bearer token | creator, admin

---

## GET /api/tasks/:id/subtasks ✅

ดึง subtask ทั้งหมดของ task

**Auth required:** ✅ Bearer token

---

## POST /api/tasks/:id/subtasks ✅

เพิ่ม subtask (checklist item) ใน task

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "title": "เขียน unit test", "assigneeId": "uuid" }
```

---

## PUT /api/tasks/:id/subtasks/:subtaskId ✅

แก้ชื่อ/ผู้รับผิดชอบ/ลำดับ subtask

**Auth required:** ✅ Bearer token

---

## PATCH /api/tasks/:id/subtasks/:subtaskId/toggle ✅

ติ๊ก/ยกเลิกติ๊ก subtask ว่าเสร็จแล้วหรือยัง

**Auth required:** ✅ Bearer token

---

## DELETE /api/tasks/:id/subtasks/:subtaskId ✅

ลบ subtask ออก

**Auth required:** ✅ Bearer token

---

## GET /api/tasks/:id/comments ✅

ดึงความคิดเห็นทั้งหมดของ task เรียงจากเก่าไปใหม่

**Auth required:** ✅ Bearer token

---

## POST /api/tasks/:id/comments ✅

เพิ่มความคิดเห็นใน task

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "commentText": "งานนี้ต้องรอ design ก่อนนะครับ" }
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `commentText` | string | ✅ | ห้ามว่าง |

---

## PUT /api/tasks/:id/comments/:commentId ✅

แก้ความคิดเห็น (เฉพาะเจ้าของ comment)

**Auth required:** ✅ Bearer token | author เท่านั้น

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `FORBIDDEN` | 403 | ไม่ใช่เจ้าของ comment |

---

## DELETE /api/tasks/:id/comments/:commentId ✅

ลบความคิดเห็น

**Auth required:** ✅ Bearer token | author หรือ admin

---

## GET /api/tasks/:id/attachments ✅

ดูไฟล์แนบทั้งหมดของ task

**Auth required:** ✅ Bearer token

---

## POST /api/tasks/:id/attachments ✅

แนบไฟล์เข้า task

**Auth required:** ✅ Bearer token

**Content-Type:** `multipart/form-data`

| Field | Constraint | หมายเหตุ |
|---|---|---|
| `file` | ≤ 20MB | image/\*, application/pdf, และ mime ที่อยู่ใน whitelist |

---

## DELETE /api/tasks/:id/attachments/:attachmentId ✅

ลบไฟล์แนบ — ลบจาก Supabase Storage ก่อนแล้วค่อยลบ row

**Auth required:** ✅ Bearer token | ผู้อัปโหลด หรือ admin

---

## GET /api/tasks/time/running ✅

ดู time session ที่กำลังทำงานทั้งหมดของ user ปัจจุบัน

**Auth required:** ✅ Bearer token

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "taskId": "uuid",
      "startedAt": "2026-04-16T10:00:00.000Z"
    }
  ]
}
```

---

## POST /api/tasks/:id/time/start ✅

เริ่มจับเวลาทำงานของ task นี้

**Auth required:** ✅ Bearer token | assignee หรือ admin

### Notes
- สามารถเริ่มจับเวลาได้หลาย task พร้อมกัน
- ไม่มีการป้องกันการ start หลาย session พร้อมกัน

### Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "taskId": "uuid",
    "employeeId": "uuid",
    "startedAt": "2026-04-16T10:00:00.000Z"
  }
}
```

---

## POST /api/tasks/:id/time/pause ✅

หยุดพักชั่วคราว — บันทึกเวลาสะสม

**Auth required:** ✅ Bearer token | assignee หรือ admin

### Response
```json
{
  "success": true,
  "data": {
    "durationMin": 15
  }
}
```

**Note:** เวลาจะถูกบวกเพิ่มใน `accumulated_minutes` ของ task อัตโนมัติ

---

## POST /api/tasks/:id/time/complete ✅

ปิด task และบันทึกเวลาสุดท้าย

**Auth required:** ✅ Bearer token | assignee หรือ admin

---

## GET /api/tasks/:id/time ✅

ดูประวัติ time sessions ทั้งหมดของ task

**Auth required:** ✅ Bearer token | assignee, manager, admin

---

## GET /api/tasks/:id/extension-requests ✅

ดูรายการขอเลื่อนกำหนดส่งของ task นี้

**Auth required:** ✅ Bearer token | assignee, manager, admin

---

## POST /api/tasks/:id/extension-requests ✅

ขอเลื่อนกำหนดส่ง task พร้อมระบุเหตุผล

**Auth required:** ✅ Bearer token | assignee

### Request Body
```json
{ "newDeadline": "2026-04-30", "reason": "รอ feedback จาก client" }
```

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| `newDeadline` | date string | ✅ | ต้องมากกว่า deadline ปัจจุบัน |
| `reason` | string | ✅ | |

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `ALREADY_EXISTS` | 409 | มี request pending อยู่แล้ว |

---

## GET /api/extension-requests ✅

ดูรายการ extension requests ทั้งหมด (inbox ของ manager)

**Auth required:** ✅ Bearer token | manager, admin

### Query Parameters

| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `status` | string | ❌ | `pending` \| `approved` \| `rejected` |

---

## PATCH /api/extension-requests/:id/approve ✅

อนุมัติคำขอเลื่อนกำหนดส่ง — deadline ของ task อัปเดตทันที

**Auth required:** ✅ Bearer token | manager ของ assignee หรือ admin

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `FORBIDDEN` | 403 | ไม่มีสิทธิ์อนุมัติ |
| `NOT_FOUND` | 404 | ไม่พบ extension request |

---

## PATCH /api/extension-requests/:id/reject ✅

ปฏิเสธคำขอเลื่อนกำหนดส่ง พร้อมระบุเหตุผล

**Auth required:** ✅ Bearer token | manager, admin

### Request Body
```json
{ "rejectReason": "กำหนดส่งนี้สำคัญมาก ไม่สามารถเลื่อนได้" }
```

---

## GET /api/search ✅

ค้นหาข้ามทุก entity — ใช้สำหรับ global search bar

**Auth required:** ✅ Bearer token

### Query Parameters

| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `q` | string | ✅ | อย่างน้อย 2 ตัวอักษร |
| `types` | string | ❌ | comma-separated: `task,space,employee` (default: ค้นทุก type) |
| `limit` | number | ❌ | default 10 |

### Response 200
```json
{
  "success": true,
  "data": [
    { "type": "task", "id": "uuid", "title": "ออกแบบ UI", "listId": "uuid" },
    { "type": "space", "id": "uuid", "title": "Frontend Team" },
    { "type": "employee", "id": "uuid", "name": "สมชาย ใจดี", "email": "somchai@xiqma.com" }
  ]
}
```

### Errors
| Code | HTTP | เงื่อนไข |
|---|---|---|
| `VALIDATION_ERROR` | 422 | `q` ว่างหรือสั้นกว่า 2 ตัวอักษร |

---

---

# Phase 4 — HR System

## GET /api/employees ✅

ดึงรายชื่อพนักงานทั้งหมด พร้อม pagination + search

**Auth required:** ✅ Bearer token

### Query Parameters

| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `search` | string | ❌ | ค้นหาจากชื่อหรืออีเมล |
| `department` | string | ❌ | filter ตาม department |
| `isActive` | boolean | ❌ | default: คืนทุกสถานะ |
| `page` | number | ❌ | default 1 |
| `limit` | number | ❌ | default 20 |

### Response 200
```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "uuid", "employeeCode": "EMP001", "name": "สมชาย ใจดี",
        "email": "somchai@xiqma.com", "avatarUrl": null,
        "role": "employee", "department": "Engineering",
        "isActive": true, "roleName": "Developer", "positionName": "Senior Dev",
        "createdAt": "2026-04-14T00:00:00Z"
      }
    ],
    "total": 50
  }
}
```

---

## GET /api/employees/:id ✅

ดึงข้อมูลพนักงานโดย ID พร้อม leave quota

**Auth required:** ✅ Bearer token

### Response 200
```json
{
  "success": true,
  "data": {
    "id": "uuid", "employeeCode": "EMP001", "name": "สมชาย ใจดี",
    "email": "somchai@xiqma.com", "avatarUrl": null,
    "role": "employee", "roleId": "uuid", "positionId": "uuid",
    "managerId": "uuid", "department": "Engineering",
    "leaveQuotaAnnual": 10, "leaveQuotaSick": 30, "leaveQuotaPersonal": 3,
    "isActive": true, "createdAt": "2026-04-14T00:00:00Z"
  }
}
```

---

## POST /api/employees ✅

สร้างพนักงานใหม่

**Auth required:** ✅ Bearer token | manage_users permission

### Request Body
```json
{
  "employeeCode": "EMP001",
  "name": "สมชาย ใจดี",
  "email": "somchai@xiqma.com",
  "password": "secret123",
  "role": "employee",
  "roleId": "uuid",
  "positionId": "uuid",
  "department": "Engineering"
}
```

### Response 201
```json
{ "success": true, "message": "สร้างพนักงานสำเร็จ", "data": { "id": "uuid", ... } }
```

---

## PUT /api/employees/:id ✅

แก้ไขข้อมูลพนักงาน

**Auth required:** ✅ Bearer token | manage_users permission

---

## PATCH /api/employees/:id/deactivate ✅

Soft-deactivate พนักงาน (ยังคงข้อมูลไว้)

**Auth required:** ✅ Bearer token | manage_users permission

---

## PATCH /api/employees/:id/avatar ✅

อัปโหลดรูปโปรไฟล์

**Auth required:** ✅ Bearer token | owner หรือ manage_users

### Request
`multipart/form-data` with field `file`

---

## PUT /api/employees/me/password ✅

เปลี่ยนรหัสผ่านตัวเอง

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "currentPassword": "old123", "newPassword": "new123" }
```

---

## GET /api/positions ✅

ดึงตำแหน่งงานทั้งหมด

**Auth required:** ✅ Bearer token

### Query Parameters
| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `department` | string | ❌ | filter ตาม department |

### Response 200
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "name": "Senior Developer", "department": "Engineering",
      "level": 3, "jobLevelCode": "L3", "color": "#3b82f6",
      "parentPositionId": null, "isActive": true, "employeeCount": 5,
      "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## POST /api/positions ✅

สร้างตำแหน่งงานใหม่

**Auth required:** ✅ Bearer token | manage_workspace

### Request Body
```json
{ "name": "Senior Developer", "department": "Engineering", "level": 3, "color": "#3b82f6" }
```

---

## PUT /api/positions/:id ✅

แก้ไขตำแหน่งงาน

**Auth required:** ✅ Bearer token | manage_workspace

---

## DELETE /api/positions/:id ✅

ลบตำแหน่งงาน (soft delete)

**Auth required:** ✅ Bearer token | manage_workspace

---

## GET /api/roles ✅

ดึง roles ทั้งหมดพร้อม permissions

**Auth required:** ✅ Bearer token

### Response 200
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "name": "Developer", "description": null,
      "color": "#3b82f6",
      "permissions": ["view_tasks", "create_tasks"],
      "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## POST /api/roles ✅

สร้าง role ใหม่

**Auth required:** ✅ Bearer token | manage_roles

### Request Body
```json
{ "name": "Developer", "color": "#3b82f6", "permissions": ["view_tasks", "create_tasks"] }
```

---

## PUT /api/roles/:id ✅

แก้ไข role

**Auth required:** ✅ Bearer token | manage_roles

---

## DELETE /api/roles/:id ✅

ลบ role

**Auth required:** ✅ Bearer token | manage_roles

---

## GET /api/holidays ✅

ดึงรายการวันหยุด

**Auth required:** ✅ Bearer token

### Query Parameters
| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `year` | number | ❌ | filter ตามปี |

### Response 200
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "name": "วันปีใหม่", "holidayDate": "2026-01-01",
      "isRecurring": true, "note": null, "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## POST /api/holidays ✅

เพิ่มวันหยุดใหม่

**Auth required:** ✅ Bearer token

### Request Body
```json
{ "name": "วันหยุดพิเศษ", "holidayDate": "2026-05-01", "isRecurring": false }
```

---

## PUT /api/holidays/:id ✅

แก้ไขวันหยุด

**Auth required:** ✅ Bearer token

---

## DELETE /api/holidays/:id ✅

ลบวันหยุด

**Auth required:** ✅ Bearer token

---

## GET /api/holidays/working-days ✅

นับวันทำงานในช่วงเวลาที่กำหนด

**Auth required:** ✅ Bearer token

### Query Parameters
| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `start` | string | ✅ | YYYY-MM-DD |
| `end` | string | ✅ | YYYY-MM-DD |

### Response 200
```json
{ "success": true, "data": { "workingDays": 22 } }
```

---

## GET /api/work-schedules ✅

ดึงตารางเวลาทำงานทั้งหมด

**Auth required:** ✅ Bearer token

### Response 200
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "name": "Standard 5-day",
      "daysPerWeek": "5", "hoursPerDay": "8", "hoursPerWeek": "40",
      "workDays": [1,2,3,4,5], "workStartTime": "09:00", "workEndTime": "18:00",
      "isDefault": true, "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## POST /api/work-schedules ✅

สร้างตารางเวลาทำงาน

**Auth required:** ✅ Bearer token

### Request Body
```json
{
  "name": "Standard 5-day", "daysPerWeek": 5, "hoursPerDay": 8,
  "workDays": [1,2,3,4,5], "workStartTime": "09:00", "workEndTime": "18:00",
  "isDefault": false
}
```

---

## PUT /api/work-schedules/:id ✅

แก้ไขตารางเวลาทำงาน

**Auth required:** ✅ Bearer token

---

## DELETE /api/work-schedules/:id ✅

ลบตารางเวลาทำงาน

**Auth required:** ✅ Bearer token

---

## GET /api/task-types ✅

ดึง task types ทั้งหมด

**Auth required:** ✅ Bearer token

### Query Parameters
| Param | Type | Required | หมายเหตุ |
|---|---|---|---|
| `category` | string | ❌ | `private` \| `organization` — ถ้าไม่ระบุ คืนทุก category |

### Response 200
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "name": "Development", "description": null,
      "color": "#3b82f6", "category": "organization",
      "countsForPoints": true, "fixedPoints": null,
      "isActive": true, "createdAt": "2026-04-14T00:00:00Z"
    }
  ]
}
```

---

## POST /api/task-types ✅

สร้าง task type ใหม่

**Auth required:** ✅ Bearer token

### Request Body
```json
{
  "name": "Development", "color": "#3b82f6",
  "category": "organization", "countsForPoints": true
}
```

---

## PUT /api/task-types/:id ✅

แก้ไข task type

**Auth required:** ✅ Bearer token

---

## DELETE /api/task-types/:id ✅

ลบ task type

**Auth required:** ✅ Bearer token
