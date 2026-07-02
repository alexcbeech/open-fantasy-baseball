import { NextResponse } from "next/server";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";

export async function requireAdminUser() {
  const currentUser = await getCurrentOfbUser();

  if (!currentUser) {
    return {
      user: null,
      response: NextResponse.json({ error: "Sign in is required." }, { status: 401 }),
    };
  }

  if (!currentUser.isAdmin) {
    return {
      user: currentUser,
      response: NextResponse.json({ error: "Admin access is required." }, { status: 403 }),
    };
  }

  return {
    user: currentUser,
    response: null,
  };
}
