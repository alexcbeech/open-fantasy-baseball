import { handleBotMcp } from "@/lib/ai-bots/mcp";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }); }
  try {
    const response = await handleBotMcp(body, request.headers.get("authorization"));
    return response === null ? new Response(null, { status: 204 }) : Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Bot management is temporarily unavailable." }, { status: 503 });
  }
}
