import { NextResponse } from "next/server";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { createLeague } from "@/lib/data/leagues";
import { createLeagueInputSchema } from "@/lib/fantasy/league-create";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const rawInput = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries(await request.formData());

  const parsed = createLeagueInputSchema.safeParse(rawInput);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid league settings",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  // The signed-in creator becomes the league commissioner so commissioner-only
  // actions (draft setup, settings) recognize them via league_member.role.
  const currentUser = await getCurrentOfbUser();

  if (!currentUser && isNeonAuthConfigured()) {
    return NextResponse.json({ error: "Sign in to create a league." }, { status: 401 });
  }

  const league = await createLeague(
    parsed.data,
    currentUser ? { email: currentUser.email, displayName: currentUser.displayName } : undefined,
  );

  return NextResponse.json(
    {
      league,
      next: league.id === "pending-persistence" ? "Persist this payload once database access is wired." : "League persisted.",
    },
    { status: 201 },
  );
}
