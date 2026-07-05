import { NextResponse } from "next/server";
import { handleMcpRequest } from "@/lib/mcp/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    // Malformed JSON: reply with the JSON-RPC parse error rather than a 500.
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
  }

  const response = await handleMcpRequest(body, request.headers.get("authorization"));

  if (!response) {
    return new Response(null, { status: 204 });
  }

  return NextResponse.json(response);
}
