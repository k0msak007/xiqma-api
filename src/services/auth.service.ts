import { authRepository } from "@/repositories/auth.repository.ts";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "@/lib/jwt.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoginResult {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
  user: {
    id:          string;
    name:        string;
    email:       string;
    role:        string;
    permissions: string[];
  };
}

export interface RefreshResult {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const authService = {

  async login(email: string, password: string): Promise<LoginResult> {
    // 1. ตรวจ credentials — repository แค่ query, service ตัดสินว่าเป็น error
    const employee = await authRepository.findByEmailAndPassword(email, password);
    if (!employee) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Email หรือรหัสผ่านไม่ถูกต้อง", 401);
    }

    // 2. โหลด permissions
    const permissions = await authRepository.findPermissionsByRoleId(employee.roleId);

    // 3. Sign tokens
    const tokenPayload = { userId: employee.id, role: employee.role, permissions };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    // 4. บันทึก refresh token (เก็บ hash)
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await authRepository.saveRefreshToken(employee.id, refreshToken, refreshExpiresAt);

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      user: {
        id:          employee.id,
        name:        employee.name,
        email:       employee.email,
        role:        employee.role,
        permissions,
      },
    };
  },

  async refresh(token: string): Promise<RefreshResult> {
    // 1. verify signature ก่อน (throw ถ้า invalid/expired)
    const payload = await verifyRefreshToken(token);

    // 2. ตรวจใน DB — repository แค่ return row หรือ null
    const row = await authRepository.findRefreshToken(token);
    if (!row) {
      throw new AppError(ErrorCode.INVALID_TOKEN, "Refresh token ไม่ถูกต้องหรือถูก revoke แล้ว", 401);
    }
    if (row.expiresAt < new Date()) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED, "Refresh token หมดอายุ", 401);
    }

    // 3. Rotate — revoke token เดิมทันที
    //    ถ้ามีคนขโมย token แล้วพยายามใช้ซ้ำ จะ fail ที่ step 2 ด้านบน
    await authRepository.revokeRefreshToken(token);

    // 4. โหลด permissions ล่าสุดจาก DB (ไม่เชื่อ payload เดิม เพราะ role อาจเปลี่ยน)
    const permissions = await authRepository.findPermissionsByEmployeeId(row.employeeId);

    // 5. sign tokens ใหม่ทั้งคู่
    const tokenPayload = { userId: row.employeeId, role: payload.role, permissions };
    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    // 6. บันทึก refresh token ใหม่ — ใช้ expiresAt เดิม (ไม่รีเซ็ตนับใหม่)
    await authRepository.saveRefreshToken(row.employeeId, newRefreshToken, row.expiresAt);

    return { accessToken, refreshToken: newRefreshToken, expiresIn: 15 * 60 };
  },

  async logout(refreshToken: string): Promise<void> {
    await authRepository.revokeRefreshToken(refreshToken);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    // 1. ตรวจรหัสปัจจุบัน — service ตัดสินว่าผิดแล้ว throw
    const isValid = await authRepository.passwordMatches(userId, currentPassword);
    if (!isValid) {
      throw new AppError(ErrorCode.WRONG_PASSWORD, "รหัสผ่านปัจจุบันไม่ถูกต้อง", 400);
    }

    // 2. อัปเดตรหัสใหม่
    await authRepository.updatePassword(userId, newPassword);

    // 3. revoke refresh tokens ทั้งหมด (force re-login)
    await authRepository.revokeAllRefreshTokens(userId);
  },
};
