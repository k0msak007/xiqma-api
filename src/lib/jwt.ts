import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { AppError, ErrorCode } from "@/lib/errors.ts";

export interface TokenPayload extends JWTPayload {
  userId: string;
  role: string;
  permissions: string[];
}

const accessSecret  = new TextEncoder().encode(process.env.JWT_SECRET!);
const refreshSecret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET!);

// ── Sign ──────────────────────────────────────────────────────────────────────

export async function signAccessToken(payload: Omit<TokenPayload, keyof JWTPayload>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_ACCESS_EXPIRES ?? "15m")
    .sign(accessSecret);
}

export async function signRefreshToken(payload: Omit<TokenPayload, keyof JWTPayload>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_REFRESH_EXPIRES ?? "7d")
    .sign(refreshSecret);
}

// ── Verify ────────────────────────────────────────────────────────────────────

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, accessSecret);
    return payload as TokenPayload;
  } catch (e: unknown) {
    const isExpired = e instanceof Error && e.message.includes("expired");
    throw new AppError(
      isExpired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.INVALID_TOKEN,
      isExpired ? "Token หมดอายุ" : "Token ไม่ถูกต้อง",
      401
    );
  }
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret);
    return payload as TokenPayload;
  } catch {
    throw new AppError(ErrorCode.INVALID_TOKEN, "Refresh token ไม่ถูกต้อง", 401);
  }
}
