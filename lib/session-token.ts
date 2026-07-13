// Edge-safe session token helpers (no Prisma imports — used by middleware).
import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "fairtech_session";

const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-secret"
);

export type SessionPayload = { userId: string };

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId === "string") return { userId: payload.userId };
    return null;
  } catch {
    return null;
  }
}
