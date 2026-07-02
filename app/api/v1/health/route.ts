import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "open-fantasy-baseball",
    version: "v1",
  });
}

