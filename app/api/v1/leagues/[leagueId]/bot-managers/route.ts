import { z } from "zod";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { isLeagueCommissioner, requireLeagueViewer } from "@/lib/auth/team-access";
import { isDatabaseConfigured, isUuid, getPool } from "@/lib/db/client";
import { isRateLimited } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/data/audit";
import { botConfigSchema } from "@/lib/ai-bots/schema";
import { changeBotToken, configureBot, listBotManagers } from "@/lib/ai-bots/config";

type Context = { params: Promise<{ leagueId: string }> };
export async function GET(request: Request, { params }: Context) {
  const auth = await resolveApiIdentity(request, "read:league");
  if (auth.response) return auth.response;
  const { leagueId } = await params;
  const denied = await requireLeagueViewer(leagueId, auth.identity);
  if (denied) return denied;
  if (!isDatabaseConfigured()) return Response.json({ managers: [], decisions: [] });
  try {
    const managers = await listBotManagers(leagueId);
    const decisions = await getPool().query(
      `select d.id, d.team_id, ft.name, d.model, d.reason, d.status, d.created_at,
         d.command->>'kind' as kind from ai_bot_decision d join fantasy_team ft on ft.id = d.team_id
       where ft.league_id = $1 order by d.created_at desc limit 20`, [leagueId]);
    const canManage = await isLeagueCommissioner(leagueId, auth.identity);
    return Response.json({ managers: managers.map((m) => canManage ? m : { ...m, strategy: "", tokenExpiresAt: null }), decisions: decisions.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "AI managers are unavailable. Apply the AI bot manager migration first." }, { status: 503 });
  }
}

const tokenSchema = z.object({ action: z.enum(["rotate-token", "revoke-token"]), teamId: z.uuid() }).strict();
export async function POST(request: Request, { params }: Context) {
  const auth = await resolveApiIdentity(request, "commissioner:league");
  if (auth.response) return auth.response;
  const { leagueId } = await params;
  if (!isDatabaseConfigured()) return Response.json({ error: "AI managers require a configured database." }, { status: 503 });
  if (!isUuid(leagueId) || !(await isLeagueCommissioner(leagueId, auth.identity))) return Response.json({ error: "Commissioner access is required." }, { status: 403 });
  if (isRateLimited(`bot-config:${auth.identity.userId}`, { limit: 20, windowMs: 60_000 })) return Response.json({ error: "Too many requests." }, { status: 429 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "A JSON body is required." }, { status: 400 }); }
  const tokenInput = tokenSchema.safeParse(body);
  const configInput = botConfigSchema.safeParse(body);
  if (!tokenInput.success && !configInput.success) return Response.json({ error: "Invalid bot configuration. Choose a model before enabling management." }, { status: 400 });
  try {
    const teamId = tokenInput.success ? tokenInput.data.teamId : configInput.data!.teamId;
    const action = tokenInput.success ? tokenInput.data.action : "configure";
    let token: string | null = null;
    if (tokenInput.success) token = await changeBotToken(leagueId, teamId, action === "revoke-token");
    else await configureBot(leagueId, configInput.data!);
    await recordAuditEvent({ action: `bot.${action}`, actor: auth.identity, entityType: "team", entityId: teamId, teamId, leagueId,
      detail: configInput.success ? { model: configInput.data.model, enabled: configInput.data.enabled, allowTrades: configInput.data.allowTrades } : {}, request });
    return Response.json({ accepted: true, token }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bot settings could not be saved." }, { status: 409 });
  }
}
