# AGENT.md — Xiqma API

กฎและ conventions ที่ต้องทำตามทุกครั้งที่เขียนหรือแก้ไขโค้ดใน project นี้

---

## Stack

| ส่วน       | Library                                 |
| ---------- | --------------------------------------- |
| Runtime    | Bun                                     |
| Framework  | Hono                                    |
| ORM        | Drizzle ORM (`drizzle-orm/postgres-js`) |
| Database   | PostgreSQL + pgcrypto                   |
| Validation | Zod + `@hono/zod-validator`             |
| JWT        | jose                                    |
| Language   | TypeScript (strict)                     |

Path alias: `@/` → `src/`

---

## โครงสร้าง Project

```
src/
├── db/
│   ├── schema/          # Drizzle table definitions + types
│   │   └── index.ts     # re-export ทุก schema จากจุดเดียว
│   └── scripts/         # SQL migration scripts
├── lib/
│   ├── db.ts            # drizzle instance (export: db)
│   ├── errors.ts        # AppError class + ErrorCode enum
│   ├── jwt.ts           # signAccessToken, signRefreshToken, verify*
│   ├── logger.ts        # structured logger (logger.info / logError)
│   ├── response.ts      # ok(), created(), fail(), paginate()
│   └── validate.ts      # validate(), vJson(), vQuery(), vParam()
├── middleware/
│   ├── auth.ts          # authMiddleware, requirePermission(), requireRole()
│   ├── error.ts         # global error handler (app.onError)
│   ├── rate-limit.ts    # rateLimit(), authRateLimit, apiRateLimit
│   └── request-id.ts   # inject X-Request-ID + request logging
├── repositories/        # Data access layer — DB เท่านั้น
├── services/            # Business logic layer
├── routes/              # Hono route handlers
├── validators/          # Zod schemas + inferred types
└── app.ts               # Hono app + mount routes
```

---

## Architecture Rules

### Repository — Data Access Layer

**หน้าที่:** query ข้อมูลจาก DB แล้ว return ผลลัพธ์เท่านั้น

**✅ ทำได้:**

- `SELECT`, `INSERT`, `UPDATE`, `DELETE` ผ่าน Drizzle ORM หรือ raw SQL
- return ข้อมูลที่ query ได้ (row, array, หรือ `null` ถ้าไม่เจอ)
- return `boolean` สำหรับ existence check (เช่น `passwordMatches`)
- แปลง raw DB row เป็น typed object ก่อน return
- ใช้ `sql\`...\``สำหรับ DB function เช่น`crypt()`, `gen_salt()`, `now()`

**❌ ห้ามทำ:**

- `throw AppError` หรือ error ใดๆ ที่เป็น business decision
- ตรวจสอบ business rules (เช่น "token หมดอายุแล้วไหม?")
- เรียก service อื่น
- เรียก repository อื่น (ยกเว้น `this.methodName()` ใน repository เดียวกัน)
- มี side effects นอกเหนือจาก DB write (เช่น ส่ง email, push notification)

**ตัวอย่าง:**

```ts
// ✅ ถูก — แค่ query แล้ว return null ถ้าไม่เจอ
async findByEmailAndPassword(email: string, password: string): Promise<EmployeeRow | null> {
  const rows = await db.execute(sql`
    SELECT id, name, email, role, role_id
    FROM   employees
    WHERE  email = ${email} AND is_active = true
      AND  crypt(${password}, password_hash) = password_hash
    LIMIT 1
  `);
  return rows.length === 0 ? null : mapToEmployeeRow(rows[0]);
}

// ❌ ผิด — repository ไม่ควร throw business error
async findByEmailAndPassword(email: string, password: string) {
  const rows = await db.execute(sql`...`);
  if (rows.length === 0) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, "...", 401); // ❌
  }
}
```

---

### Service — Business Logic Layer

**หน้าที่:** รับข้อมูลจาก repository แล้วตัดสินใจทาง business

**✅ ทำได้:**

- ตรวจสอบผลลัพธ์จาก repository (`null` → throw AppError)
- ตัดสินใจ business rules (หมดอายุ? มีสิทธิ์? quota เต็ม?)
- `throw new AppError(ErrorCode.*, message, httpStatus)`
- เรียกหลาย repository ในการทำงานเดียว
- คำนวณ, แปลงข้อมูล, combine หลาย query ก่อน return
- Sign/verify JWT ผ่าน `@/lib/jwt.ts`

**❌ ห้ามทำ:**

- query DB โดยตรง (ต้องผ่าน repository เสมอ)
- import `db` จาก `@/lib/db.ts`
- import schema จาก `@/db/schema/*` เพื่อใช้ query
- ส่ง HTTP response (นั่นเป็นหน้าที่ของ route)

**ตัวอย่าง:**

```ts
// ✅ ถูก — service ตัดสินใจ business rule เอง
async login(email: string, password: string): Promise<LoginResult> {
  const employee = await authRepository.findByEmailAndPassword(email, password);
  if (!employee) {
    throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Email หรือรหัสผ่านไม่ถูกต้อง", 401);
  }

  const row = await authRepository.findRefreshToken(token);
  if (!row) {
    throw new AppError(ErrorCode.INVALID_TOKEN, "Token ไม่ถูกต้อง", 401);
  }
  if (row.expiresAt < new Date()) {             // ← business decision
    throw new AppError(ErrorCode.TOKEN_EXPIRED, "Token หมดอายุ", 401);
  }
  ...
}
```

---

### Route — HTTP Handler Layer

**หน้าที่:** รับ HTTP request → validate → เรียก service → ส่ง response

**✅ ทำได้:**

- validate input ด้วย `validate()` จาก `@/lib/validate.ts`
- เรียก service แล้วส่งผลด้วย `ok()`, `created()` จาก `@/lib/response.ts`
- ดึง user จาก context ด้วย `c.get("user")` (หลัง authMiddleware)
- ใช้ `authMiddleware`, `requirePermission()`, `requireRole()` สำหรับ protected routes

**❌ ห้ามทำ:**

- เขียน business logic ใน handler (เช่น ตรวจ null, คำนวณ, compare date)
- เรียก repository โดยตรง (ต้องผ่าน service เสมอ)
- `throw AppError` ใน route handler เอง

**ตัวอย่าง:**

```ts
// ✅ ถูก
authRouter.post("/login", validate(loginSchema, "json"), async (c) => {
  const { email, password } = c.req.valid("json");
  const result = await authService.login(email, password); // ← delegate ให้ service
  return ok(c, { access_token: result.accessToken, ... }, "เข้าสู่ระบบสำเร็จ");
});

// ❌ ผิด — business logic รั่วเข้ามาใน route
authRouter.post("/login", vJson(loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const employee = await authRepository.findByEmail(email); // ❌ เรียก repo ตรง
  if (!employee) return fail(c, "ไม่พบ user", "NOT_FOUND", 404); // ❌ business logic
  ...
});
```

---

## Response Format

ทุก endpoint ใช้ helper จาก `@/lib/response.ts` เท่านั้น ห้ามใช้ `c.json()` ตรงๆ

### Success

```json
{
  "success": true,
  "message": "ดึงข้อมูลสำเร็จ",
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

```ts
return ok(c, data, "ดึงข้อมูลสำเร็จ");
return ok(c, rows, "ดึงข้อมูลสำเร็จ", buildMeta(total));
return created(c, newRecord, "สร้างสำเร็จ");
```

### Error

```json
{
  "success": false,
  "message": "Email หรือรหัสผ่านไม่ถูกต้อง",
  "error": "INVALID_CREDENTIALS",
  "details": [...]
}
```

- `message` → แสดงให้ user อ่าน (ภาษาไทย)
- `error` → `ErrorCode` string ให้ client จัดการ logic
- `details` → optional, ใช้กับ validation errors เป็น `{ field, message }[]`

error ทั่วไปไม่ต้องเรียก `fail()` ใน route — `throw new AppError(...)` ใน service แล้ว error middleware จะจัดการเอง

---

## Error Handling

```ts
// ✅ ใช้ AppError เสมอ — ระบุ ErrorCode, message ภาษาไทย, HTTP status
throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ task นี้", 404);
throw new AppError(
  ErrorCode.INVALID_CREDENTIALS,
  "Email หรือรหัสผ่านไม่ถูกต้อง",
  401,
);
throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์เข้าถึง", 403);
throw new AppError(ErrorCode.ALREADY_EXISTS, "Email นี้ถูกใช้แล้ว", 409);
throw new AppError(
  ErrorCode.VALIDATION_ERROR,
  "ข้อมูลไม่ถูกต้อง",
  422,
  details,
);
```

ErrorCode ทั้งหมดอยู่ใน `@/lib/errors.ts` — ถ้าต้องการ code ใหม่ให้เพิ่มที่นั่นก่อน

---

## Validation

ทุก route ที่รับ input ต้องมี Zod schema ใน `src/validators/` และใช้ helper จาก `@/lib/validate.ts`

```ts
import { vJson, vQuery, vParam } from "@/lib/validate.ts";

router.post("/", vJson(createSchema), handler); // body
router.get("/", vQuery(listSchema), handler); // query string
router.get("/:id", vParam(idSchema), handler); // path param
```

Schema ต้องอยู่ใน `src/validators/<domain>.validator.ts` เท่านั้น ห้ามเขียน inline ใน route

---

## Database

### Drizzle Query

```ts
// ✅ ใช้ Drizzle query API สำหรับ query ทั่วไป
await db.query.employees.findFirst({ where: eq(employees.id, id) });
await db.insert(table).values(data);
await db.update(table).set(data).where(eq(table.id, id));

// ✅ ใช้ raw SQL เฉพาะเมื่อต้องการ DB function (pgcrypto ฯลฯ)
await db.execute(sql`
  SELECT 1 FROM employees
  WHERE crypt(${password}, password_hash) = password_hash
`);
```

### Schema

- table definitions อยู่ใน `src/db/schema/<domain>.schema.ts`
- import จาก `@/db/schema/index.ts` เสมอ ห้าม import จาก schema file โดยตรง
- inferred types (`Employee`, `NewEmployee` ฯลฯ) export ออกมาจาก schema ใช้แทน interface ซ้ำ

---

## Naming Conventions

| สิ่งที่ตั้งชื่อ    | รูปแบบ                                             | ตัวอย่าง                                |
| ------------------ | -------------------------------------------------- | --------------------------------------- |
| Repository methods | `find*`, `save*`, `update*`, `revoke*`, `*Matches` | `findByEmail`, `saveRefreshToken`       |
| Service methods    | verb เต็ม                                          | `login`, `changePassword`, `createTask` |
| Route files        | `<domain>.route.ts`                                | `auth.route.ts`                         |
| Repository files   | `<domain>.repository.ts`                           | `auth.repository.ts`                    |
| Service files      | `<domain>.service.ts`                              | `auth.service.ts`                       |
| Validator files    | `<domain>.validator.ts`                            | `auth.validator.ts`                     |
| Schema + type      | `<domain>.schema.ts`                               | `employees.schema.ts`                   |
| Router export      | `<domain>Router`                                   | `authRouter`                            |

---

## Middleware

| Middleware                   | ใช้เมื่อ                                       |
| ---------------------------- | ---------------------------------------------- |
| `authMiddleware`             | route ที่ต้อง login ก่อน                       |
| `requirePermission("perm")`  | route ที่ต้องการ permission เฉพาะ              |
| `requireRole("admin", "hr")` | route ที่จำกัดเฉพาะ role                       |
| `authRateLimit`              | `/api/auth/login`                              |
| `apiRateLimit`               | mount ใน `app.ts` แล้ว (ครอบ `/api/*` ทั้งหมด) |

```ts
// ตัวอย่าง protected route
router
  .use(authMiddleware)
  .get("/", requireRole("manager", "admin"), listHandler)
  .post("/", requirePermission("manage_employees"), createHandler)
  .delete("/:id", requirePermission("manage_employees"), deleteHandler);
```

---

## สิ่งที่ต้องระวัง

- **ห้าม** import `db` ใน service หรือ route
- **ห้าม** import schema ใน service หรือ route เพื่อ query
- **ห้าม** เขียน `c.json(...)` ตรงๆ ใน route ใช้ `ok()` / `created()` / `fail()` เท่านั้น
- **ห้าม** `throw AppError` ใน repository
- **ห้าม** เขียน Zod schema inline ใน route file
- refresh token ต้องเก็บเป็น SHA-256 hash เท่านั้น ห้ามเก็บ plain text
- password ต้องใช้ `crypt(password, gen_salt('bf'))` เสมอ ห้ามใช้ library hash อื่น
