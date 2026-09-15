import { getCurrentOfbUser, getNeonAuth } from "@/lib/auth/neon-auth";
import { areSignupsEnabled } from "@/lib/auth/signups";
import { DeliverySuppressed, withEligibleRecipient } from "@/lib/notifications/recipient-guard";

const auth = getNeonAuth();
const handlers = auth?.handler();

function missingAuthConfig() {
  return Response.json({ error: "Neon Auth is not configured." }, { status: 503 });
}

/**
 * The sign-up server action checks ALLOW_SIGNUPS, but the SDK's own sign-up
 * endpoints are also reachable through this proxy — gate them here too so a
 * direct POST can't create an account while signups are closed.
 */
function isBlockedSignupPath(request: Request) {
  if (areSignupsEnabled()) {
    return false;
  }

  const segments = new URL(request.url).pathname.toLowerCase().split("/");

  return segments.some((segment) => segment === "sign-up" || segment === "signup" || segment === "register");
}

function withSignupGate<Rest extends unknown[]>(
  handler: ((request: Request, ...rest: Rest) => Response | Promise<Response>) | undefined,
) {
  return async (request: Request, ...rest: Rest) => {
    const path = new URL(request.url).pathname.toLowerCase();
    // Account/role administration must pass OFB's audit and anti-lockout rules.
    if (path.includes("/admin/")) return Response.json({ error: "Use OFB account administration." }, { status: 403 });
    if (path.endsWith("/sign-out")) return handler ? handler(request, ...rest) : missingAuthConfig();
    if (isBlockedSignupPath(request)) {
      return Response.json({ error: "Account creation is currently disabled." }, { status: 403 });
    }

    if (!handler) return missingAuthConfig();
    try {
      const session = await auth?.getSession();
      if (session?.data?.user && !(await getCurrentOfbUser())) {
        return Response.json({ error: "Account access is unavailable." }, { status: 403 });
      }
      const body = request.method === "GET" ? null : await request.clone().json().catch(() => null);
      const email = body && typeof body.email === "string" ? body.email : new URL(request.url).searchParams.get("email");
      // Covers reset/verification/OTP as well as direct email sign-in/sign-up.
      return email ? await withEligibleRecipient(email, async () => handler(request, ...rest)) : await handler(request, ...rest);
    } catch (error) {
      return Response.json({ error: error instanceof DeliverySuppressed ? "Account access is unavailable." : "Authentication is temporarily unavailable." },
        { status: error instanceof DeliverySuppressed ? 403 : 503 });
    }
  };
}

export const GET = withSignupGate(handlers?.GET);
export const POST = withSignupGate(handlers?.POST);
export const PUT = withSignupGate(handlers?.PUT);
export const DELETE = withSignupGate(handlers?.DELETE);
export const PATCH = withSignupGate(handlers?.PATCH);
