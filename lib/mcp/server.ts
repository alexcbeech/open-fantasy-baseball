import { z } from "zod";
import { parseBearerToken, verifyBearerToken, type ApiPrincipal } from "@/lib/auth/bearer-token";
import { getTeamAccess } from "@/lib/auth/team-access";
import { isDatabaseConfigured } from "@/lib/db/client";
import { listPlayers } from "@/lib/data/players";
import { getProfilePreferences } from "@/lib/data/profile";
import { getLineupForTeam, getTeamSummary } from "@/lib/data/teams";
import { validateLineup } from "@/lib/fantasy/roster-validation";
import type { OAuthScope } from "@/lib/auth/scopes";
import type { Player } from "@/lib/fantasy/types";

const protocolVersion = "2025-06-18";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type McpTool = {
  name: string;
  title: string;
  description: string;
  requiredScope: OAuthScope;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
  };
};

const noInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const mcpTools = [
  {
    name: "ofb_get_profile",
    title: "Get OFB Profile",
    description: "Read the authenticated owner's OFB profile preferences.",
    requiredScope: "read:profile",
    inputSchema: noInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: "ofb_search_players",
    title: "Search OFB Players",
    description: "Search MLB fantasy players by name and optional availability.",
    requiredScope: "read:league",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional case-insensitive player name search.",
        },
        availability: {
          type: "string",
          enum: ["rostered", "free-agent", "waivers"],
          description: "Optional fantasy availability filter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum players to return.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "ofb_get_team_roster",
    title: "Get OFB Team Roster",
    description: "Read a fantasy team's latest roster and lineup validation.",
    requiredScope: "read:team",
    inputSchema: {
      type: "object",
      required: ["teamId"],
      properties: {
        teamId: {
          type: "string",
          description: "Fantasy team id.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
] as const satisfies readonly McpTool[];

const searchPlayersInputSchema = z.object({
  query: z.string().trim().min(1).optional(),
  availability: z.enum(["rostered", "free-agent", "waivers"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const teamRosterInputSchema = z.object({
  teamId: z.string().trim().min(1),
});

export async function handleMcpRequest(body: unknown, authorizationHeader: string | null) {
  if (!isJsonRpcRequest(body)) {
    return jsonRpcError(null, -32600, "Invalid JSON-RPC request.");
  }

  if (!body.id && body.method === "notifications/initialized") {
    return null;
  }

  switch (body.method) {
    case "initialize":
      return jsonRpcResult(body.id ?? null, {
        protocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "open-fantasy-baseball",
          title: "Open Fantasy Baseball",
          version: "0.1.0",
        },
        instructions:
          "Use a personal OFB API token as an Authorization: Bearer header. Tools are read-only in this first MCP slice.",
      });
    case "tools/list":
      return jsonRpcResult(body.id ?? null, {
        tools: mcpTools.map(({ requiredScope, ...tool }) => ({
          ...tool,
          metadata: {
            requiredScope,
          },
        })),
      });
    case "tools/call":
      return callTool(body.id ?? null, body.params, authorizationHeader);
    default:
      return jsonRpcError(body.id ?? null, -32601, `Unknown MCP method: ${body.method ?? "missing"}.`);
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as JsonRpcRequest).jsonrpc === "2.0");
}

async function callTool(id: JsonRpcId, params: unknown, authorizationHeader: string | null) {
  const parsedParams = z
    .object({
      name: z.string(),
      arguments: z.unknown().optional(),
    })
    .safeParse(params);

  if (!parsedParams.success) {
    return jsonRpcError(id, -32602, "tools/call params must include a tool name.");
  }

  const tool = mcpTools.find((candidate) => candidate.name === parsedParams.data.name);

  if (!tool) {
    return jsonRpcError(id, -32602, `Unknown tool: ${parsedParams.data.name}.`);
  }

  const principal = await authorizeTool(authorizationHeader, tool.requiredScope);

  if (!principal.ok) {
    return jsonRpcError(id, principal.code, principal.message);
  }

  try {
    switch (tool.name) {
      case "ofb_get_profile":
        return toolResult(id, await getProfilePreferences(principal.principal.email));
      case "ofb_search_players":
        return searchPlayersTool(id, parsedParams.data.arguments);
      case "ofb_get_team_roster":
        return teamRosterTool(id, parsedParams.data.arguments, principal.principal);
    }
  } catch (error) {
    return jsonRpcError(id, -32603, error instanceof Error ? error.message : "Tool execution failed.");
  }
}

async function authorizeTool(authorizationHeader: string | null, requiredScope: OAuthScope) {
  const token = parseBearerToken(authorizationHeader);

  if (!token) {
    return { ok: false as const, code: -32001, message: "Bearer token is required for MCP tool calls." };
  }

  const principal = await verifyBearerToken(token);

  if (!principal) {
    return { ok: false as const, code: -32001, message: "Bearer token is invalid, expired, or revoked." };
  }

  if (!principal.scopes.includes(requiredScope)) {
    return { ok: false as const, code: -32003, message: `Bearer token requires ${requiredScope}.` };
  }

  return { ok: true as const, principal };
}

async function searchPlayersTool(id: JsonRpcId, rawArguments: unknown) {
  const parsed = searchPlayersInputSchema.safeParse(rawArguments ?? {});

  if (!parsed.success) {
    return jsonRpcError(id, -32602, "Invalid ofb_search_players arguments.");
  }

  const players = await listPlayers({
    query: parsed.data.query,
    availability: parsed.data.availability as Player["availability"] | undefined,
  });

  return toolResult(id, {
    players: players.slice(0, parsed.data.limit),
    count: Math.min(players.length, parsed.data.limit),
    totalMatches: players.length,
  });
}

async function teamRosterTool(id: JsonRpcId, rawArguments: unknown, principal: ApiPrincipal) {
  const parsed = teamRosterInputSchema.safeParse(rawArguments ?? {});

  if (!parsed.success) {
    return jsonRpcError(id, -32602, "Invalid ofb_get_team_roster arguments.");
  }

  // Rosters are league-private: the token's user must belong to the team's league.
  if (isDatabaseConfigured()) {
    const access = await getTeamAccess(parsed.data.teamId, { userId: principal.userId, email: principal.email });

    if (access === "not-found") {
      return toolExecutionError(id, `Team not found: ${parsed.data.teamId}.`);
    }

    if (access === "none") {
      return jsonRpcError(id, -32003, "The token's user is not a member of this team's league.");
    }
  }

  const [team, roster] = await Promise.all([getTeamSummary(parsed.data.teamId), getLineupForTeam(parsed.data.teamId)]);

  if (!team) {
    return toolExecutionError(id, `Team not found: ${parsed.data.teamId}.`);
  }

  return toolResult(id, {
    team,
    roster,
    validation: validateLineup(roster),
  });
}

function toolResult(id: JsonRpcId, structuredContent: unknown) {
  return jsonRpcResult(id, {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
    isError: false,
  });
}

function toolExecutionError(id: JsonRpcId, message: string) {
  return jsonRpcResult(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}
