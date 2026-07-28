import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/session-token";

// Link-based logout for static pages (the /labour app) that can't call the
// logout server action: clears the session cookie and returns to login.
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
