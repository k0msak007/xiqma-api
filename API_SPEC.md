# Xiqma API Specification

**Base URL:** `http://localhost:3000/api`
**Content-Type:** `application/json`

> อัปเดตล่าสุด: 2026-04-09
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

## GET /employees 📋

ดูรายชื่อพนักงาน

**Auth required:** ✅
**Permission:** `manage_employees` หรือ `hr` / `admin`

### Query Parameters
| Param | Type | Default | หมายเหตุ |
|---|---|---|---|
| `search` | string | — | ค้นหาชื่อหรือ email |
| `department` | string | — | filter ตาม department |
| `isActive` | boolean | `true` | |
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

## GET /employees/:id 📋

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

## POST /employees 📋

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

## PUT /employees/:id 📋

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

> 📌 endpoint ที่ยังไม่ได้ระบุ response shape จะอัปเดตเมื่อ implement เสร็จ
