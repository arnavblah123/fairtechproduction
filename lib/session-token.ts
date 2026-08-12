// Edge-safe session token helpers (no Prisma imports — used by middleware).
import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "fairtech_session";

// The session secret signs every login cookie. In production a fallback
// would let anyone who has read this file forge a superadmin session, so
// refuse to run without the real thing. Local dev keeps a fixed value for
// convenience only.
const rawSecret = process.env.SESSION_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "SESSION_SECRET is not set. Refusing to sign login cookies with a " +
      "publicly-known fallback — add SESSION_SECRET in Vercel (any long " +
      "random string, e.g. `openssl rand -hex 32`) and redeploy."
  );
}
const secret = new TextEncoder().encode(rawSecret ?? "dev-secret");

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
