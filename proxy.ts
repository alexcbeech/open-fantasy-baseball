import { NextResponse, type NextRequest } from "next/server";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { isPublicPagePath } from "@/lib/auth/public-paths";

// Some pages intentionally render without a signed-in session even when Neon
// Auth is configured. Invite pages must preserve the token while offering the
// user sign-in; other league pages remain protected.
const neonAuthConfigured = Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);

// Built independently from lib/auth/neon-auth.ts, which imports the pg
// client for DB-backed user mapping -- pulling that into this file would
// drag a Node-only dependency into the request proxy bundle.
const runNeonAuthProxy = neonAuthConfigured
  ? createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!,
        sessionDataTtl: 300,
        // The SDK defaults to SameSite=Strict, which the browser drops on the
        // cross-site redirect back from Google -- without the challenge cookie
        // the OAuth verifier exchange never runs and sign-in dead-ends.
        sameSite: "lax",
      },
      logLevel: process.env.NODE_ENV === "test" ? "silent" : "warn",
    }).middleware({ loginUrl: "/auth/sign-in" })
  : null;

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  if (process.env.NODE_ENV !== "production" && host.startsWith("127.0.0.1")) {
    const url = request.nextUrl.clone();
    url.hostname = "localhost";
    return NextResponse.redirect(url);
  }

  // Neon Auth's getSession() mints/refreshes a signed session cookie on the
  // first read after sign-in and whenever its short cache expires. That write
  // is only legal in a proxy, Route Handler, or Server Action -- never during
  // a Server Component render -- and app/layout.tsx calls getCurrentOfbUser()
  // (which calls getSession()) on every page. Running Neon Auth's request
  // middleware here performs that refresh legally before the page renders.
  // API routes are skipped: they're Route Handlers, where the same write is
  // already legal, so they don't hit this constraint. Non-GET requests are
  // skipped too: they're Server Action posts, where the cookie write is equally
  // legal -- and the Neon Auth request middleware forwards the incoming method
  // and body to its upstream get-session check, so a POST makes that check fail
  // and bounces a signed-in action to the login page.
  if (runNeonAuthProxy && request.method === "GET" && !request.nextUrl.pathname.startsWith("/api")) {
    const authResponse = await runNeonAuthProxy(request);
    const isLoginRedirect = authResponse.headers.has("location");

    if (!isLoginRedirect || !isPublicPagePath(request.nextUrl.pathname)) {
      return authResponse;
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next's build assets and the files served straight out of /public
  // (the brand marks, the service worker). Without excluding these, the Neon
  // Auth request middleware intercepts them for signed-out visitors and returns
  // the login page HTML instead of the asset -- which broke the logo on the very
  // pages (sign-in, sign-up) where the visitor is always signed out.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|sw.js).*)"],
};
