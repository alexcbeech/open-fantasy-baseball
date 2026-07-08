import { NextResponse } from "next/server";

/**
 * Read routes no longer fall back to fabricated data when the database is
 * unreachable (see withDemoFallback in lib/db/client), so a genuine outage now
 * throws. Wrap a read handler with this to convert that into a clean 503 for
 * API consumers instead of a bare 500. Responses the handler returns itself
 * (200/401/403/404) pass through untouched — only thrown errors become 503.
 */
export async function readRoute(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    console.error("Read route failed; data is temporarily unavailable.", error);
    return NextResponse.json(
      { error: "This data is temporarily unavailable. Please try again shortly." },
      { status: 503 },
    );
  }
}
