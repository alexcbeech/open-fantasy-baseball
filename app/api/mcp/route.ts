import { NextResponse } from "next/server";
import { handleMcpRequest } from "@/lib/mcp/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const response = await handleMcpRequest(body, request.headers.get("authorization"));

  if (!response) {
    return new Response(null, { status: 204 });
  }

  return NextResponse.json(response);
}
