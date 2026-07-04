import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getAllLiveLines } from "@/lib/data/mlb-live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "read:league", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const live = await getAllLiveLines();

  return NextResponse.json({ live });
}
