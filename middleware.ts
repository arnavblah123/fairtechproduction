import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session-token";

const PUBLIC_PATHS = [
  "/login",
  // Health check must answer even when nobody can log in — it is the only
  // way to see why the app is failing from a phone. Reports schema and
  // connection state only, never any data.
  "/api/health",
  "/api/attendance",
  "/api/cron",
  "/api/feed",
  "/api/integration",
  "/iclock",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    const login = new URL("/login", req.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except static assets, PWA files, and Next internals.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.svg|.*\\.png).*)",
  ],
};
