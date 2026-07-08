import { getNeonAuth } from "@/lib/auth/neon-auth";
import { areSignupsEnabled } from "@/lib/auth/signups";

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
  return (request: Request, ...rest: Rest) => {
    if (isBlockedSignupPath(request)) {
      return Response.json({ error: "Account creation is currently disabled." }, { status: 403 });
    }

    return handler ? handler(request, ...rest) : missingAuthConfig();
  };
}

export const GET = handlers?.GET ?? missingAuthConfig;
export const POST = withSignupGate(handlers?.POST);
export const PUT = withSignupGate(handlers?.PUT);
export const DELETE = handlers?.DELETE ?? missingAuthConfig;
export const PATCH = withSignupGate(handlers?.PATCH);
