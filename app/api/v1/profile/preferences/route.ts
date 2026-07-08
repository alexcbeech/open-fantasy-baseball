import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { getProfilePreferences, profilePreferenceUpdateSchema, updateProfilePreferences } from "@/lib/data/profile";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "read:profile", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const currentUser = auth.principal ?? (await getCurrentOfbUser());

  if (!currentUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const profile = await getProfilePreferences(currentUser.email);

  return NextResponse.json({ profile });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApiRequest(request, "write:profile", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const body = await request.json();
  const parsed = profilePreferenceUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Profile preferences are invalid.",
        issues: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }

  const currentUser = auth.principal ?? (await getCurrentOfbUser());

  if (!currentUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const profile = await updateProfilePreferences(parsed.data, currentUser.email);

  return NextResponse.json({ profile });
}
