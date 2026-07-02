import { getNeonAuth } from "@/lib/auth/neon-auth";

const auth = getNeonAuth();
const handlers = auth?.handler();

function missingAuthConfig() {
  return Response.json({ error: "Neon Auth is not configured." }, { status: 503 });
}

export const GET = handlers?.GET ?? missingAuthConfig;
export const POST = handlers?.POST ?? missingAuthConfig;
export const PUT = handlers?.PUT ?? missingAuthConfig;
export const DELETE = handlers?.DELETE ?? missingAuthConfig;
export const PATCH = handlers?.PATCH ?? missingAuthConfig;
