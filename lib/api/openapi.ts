import { oauthScopes, scopeDescriptions } from "@/lib/auth/scopes";

const bearerSecurity = [{ bearerAuth: [] }];

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Open Fantasy Baseball API",
    version: "0.1.0",
    description:
      "Owner-facing API for Open Fantasy Baseball leagues, teams, players, profile preferences, and personal API tokens.",
  },
  servers: [
    {
      url: "/api/v1",
      description: "Current OFB API version",
    },
  ],
  tags: [
    { name: "System", description: "Health and API metadata." },
    { name: "Profile", description: "Profile preferences and personal API tokens." },
    { name: "Players", description: "Player search and stat discovery." },
    { name: "Teams", description: "Roster and lineup management." },
    { name: "Leagues", description: "League creation and settings." },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "OFB personal token",
        description:
          "Use a personal API token created from the Profile preferences screen. Tokens are scoped; endpoints list the required scope in x-ofb-required-scope.",
      },
      neonSession: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
        description: "Browser session cookie managed by Neon Auth. Admin endpoints require a signed-in Neon user with role admin.",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          issues: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      OAuthScope: {
        type: "string",
        enum: oauthScopes,
        description: Object.entries(scopeDescriptions)
          .map(([scope, description]) => `${scope}: ${description}`)
          .join(" "),
      },
      ProfilePreferences: {
        type: "object",
        required: ["userId", "email", "displayName", "timeZone", "displayMode", "notifications"],
        properties: {
          userId: { type: "string" },
          email: { type: "string", format: "email" },
          displayName: { type: "string" },
          avatarUrl: { type: ["string", "null"] },
          timeZone: { type: "string" },
          displayMode: { type: "string", enum: ["auto", "light", "dark"] },
          notifications: {
            type: "object",
            required: ["injuries", "trades", "waivers", "lineupAlerts"],
            properties: {
              injuries: { type: "boolean" },
              trades: { type: "boolean" },
              waivers: { type: "boolean" },
              lineupAlerts: { type: "boolean" },
            },
          },
        },
      },
      PushSubscription: {
        type: "object",
        required: ["endpoint", "keys"],
        properties: {
          endpoint: { type: "string", format: "uri" },
          keys: {
            type: "object",
            required: ["p256dh", "auth"],
            properties: {
              p256dh: { type: "string" },
              auth: { type: "string" },
            },
          },
        },
      },
      ApiTokenSummary: {
        type: "object",
        required: ["id", "name", "scopes", "expiresAt", "createdAt", "revokedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          scopes: {
            type: "array",
            items: { $ref: "#/components/schemas/OAuthScope" },
          },
          expiresAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      ApiTokenCreateInput: {
        type: "object",
        required: ["name", "scopes", "expiresInDays"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          scopes: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/OAuthScope" },
          },
          expiresInDays: { type: "integer", minimum: 1, maximum: 365 },
        },
      },
      Player: {
        type: "object",
        required: ["id", "name", "team", "positions", "availability", "status", "stats"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          team: { type: "string" },
          positions: { type: "array", items: { type: "string" } },
          availability: { type: "string" },
          status: { type: "string" },
          stats: { type: "object", additionalProperties: true },
        },
      },
      LineupEntry: {
        type: "object",
        required: ["slot", "player"],
        properties: {
          slot: { type: "string" },
          player: { $ref: "#/components/schemas/Player" },
          matchupTotal: { type: "number" },
        },
      },
      LineupPatchInput: {
        type: "object",
        required: ["entries"],
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              required: ["playerId", "slot"],
              properties: {
                playerId: { type: "string" },
                slot: { type: "string" },
              },
            },
          },
        },
      },
      LeagueCreateInput: {
        type: "object",
        required: ["name", "seasonYear", "scoringType", "teamCount"],
        properties: {
          name: { type: "string" },
          seasonYear: { type: "integer" },
          scoringType: { type: "string", enum: ["h2h-categories", "h2h-points", "roto"] },
          teamCount: { type: "integer" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Check API health",
        responses: {
          "200": {
            description: "Service health status.",
          },
        },
      },
    },
    "/admin/jobs/nightly": {
      post: {
        tags: ["System"],
        summary: "Run nightly processing",
        description:
          "Administrative trigger for waiver processing and scheduled nightly fantasy maintenance. This is a temporary manual trigger until a durable scheduler is added.",
        security: [{ neonSession: [] }],
        "x-ofb-required-role": "admin",
        responses: {
          "202": { description: "Nightly processing completed and wrote a background_job_run record." },
          "400": { description: "Database is not configured.", content: errorContent() },
          "401": { description: "Sign-in is required.", content: errorContent() },
          "403": { description: "Admin access is required.", content: errorContent() },
        },
      },
    },
    "/admin/sync/mlb": {
      post: {
        tags: ["System"],
        summary: "Sync MLB teams, rosters, and schedule",
        description:
          "Administrative trigger for MLB Stats API ingestion of teams, active rosters, 40-man rosters, player metadata, schedules, probable starters, and position eligibility.",
        security: [{ neonSession: [] }],
        "x-ofb-required-role": "admin",
        responses: {
          "200": { description: "MLB team, roster, schedule, and probable starter data synced." },
          "400": { description: "Database is not configured.", content: errorContent() },
          "401": { description: "Sign-in is required.", content: errorContent() },
          "403": { description: "Admin access is required.", content: errorContent() },
        },
      },
    },
    "/admin/runs": {
      get: {
        tags: ["System"],
        summary: "List recent admin operation runs",
        description: "Returns recent MLB ingestion runs and background job runs for the admin operations screen.",
        security: [{ neonSession: [] }],
        "x-ofb-required-role": "admin",
        responses: {
          "200": { description: "Recent admin operation history." },
          "401": { description: "Sign-in is required.", content: errorContent() },
          "403": { description: "Admin access is required.", content: errorContent() },
        },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["System"],
        summary: "Fetch the OpenAPI document",
        responses: {
          "200": {
            description: "OpenAPI 3.1 document.",
          },
        },
      },
    },
    "/profile/preferences": {
      get: {
        tags: ["Profile"],
        summary: "Read profile preferences",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        responses: {
          "200": {
            description: "Profile preferences.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { profile: { $ref: "#/components/schemas/ProfilePreferences" } },
                },
              },
            },
          },
          "401": { description: "Invalid bearer token.", content: errorContent() },
          "403": { description: "Missing required scope.", content: errorContent() },
        },
      },
      patch: {
        tags: ["Profile"],
        summary: "Update profile preferences",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        requestBody: jsonBody({ $ref: "#/components/schemas/ProfilePreferences" }),
        responses: {
          "200": { description: "Updated profile preferences." },
          "400": { description: "Invalid profile payload.", content: errorContent() },
          "401": { description: "Invalid bearer token.", content: errorContent() },
          "403": { description: "Missing required scope.", content: errorContent() },
        },
      },
    },
    "/profile/push": {
      get: {
        tags: ["Profile"],
        summary: "Read Web Push status and the VAPID public key",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        responses: {
          "200": {
            description: "Push configuration and active device count.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    configured: { type: "boolean" },
                    publicKey: { type: "string", nullable: true },
                    activeCount: { type: "integer" },
                  },
                },
              },
            },
          },
          "401": { description: "Sign in is required.", content: errorContent() },
        },
      },
      post: {
        tags: ["Profile"],
        summary: "Register a Web Push subscription for the current device",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        requestBody: jsonBody({ $ref: "#/components/schemas/PushSubscription" }),
        responses: {
          "200": { description: "Subscription saved." },
          "400": { description: "Invalid subscription payload.", content: errorContent() },
          "401": { description: "Sign in is required.", content: errorContent() },
          "503": { description: "Web Push is not configured on this server.", content: errorContent() },
        },
      },
      delete: {
        tags: ["Profile"],
        summary: "Remove a Web Push subscription by endpoint",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        requestBody: jsonBody({
          type: "object",
          required: ["endpoint"],
          properties: { endpoint: { type: "string", format: "uri" } },
        }),
        responses: {
          "200": { description: "Subscription removed." },
          "400": { description: "Invalid endpoint.", content: errorContent() },
          "401": { description: "Sign in is required.", content: errorContent() },
        },
      },
    },
    "/profile/push/test": {
      post: {
        tags: ["Profile"],
        summary: "Send a test Web Push notification to the current user's devices",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        responses: {
          "200": { description: "Test notification delivered." },
          "401": { description: "Sign in is required.", content: errorContent() },
          "404": { description: "No push subscriptions are registered.", content: errorContent() },
          "502": { description: "No test notification could be delivered.", content: errorContent() },
          "503": { description: "Web Push is not configured on this server.", content: errorContent() },
        },
      },
    },
    "/profile/tokens": {
      get: {
        tags: ["Profile"],
        summary: "List active personal API tokens",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        responses: {
          "200": {
            description: "Active tokens.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tokens: { type: "array", items: { $ref: "#/components/schemas/ApiTokenSummary" } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Profile"],
        summary: "Create a personal API token",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        requestBody: jsonBody({ $ref: "#/components/schemas/ApiTokenCreateInput" }),
        responses: {
          "201": {
            description: "Created token. The raw token is returned once.",
          },
          "400": { description: "Invalid token payload.", content: errorContent() },
        },
      },
    },
    "/profile/tokens/{tokenId}": {
      delete: {
        tags: ["Profile"],
        summary: "Revoke a personal API token",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:profile",
        parameters: [pathParameter("tokenId", "API token id.")],
        responses: {
          "200": { description: "Token revoked." },
          "404": { description: "Token not found.", content: errorContent() },
        },
      },
    },
    "/players": {
      get: {
        tags: ["Players"],
        summary: "Search players",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:league",
        parameters: [
          queryParameter("q", "Search by player name."),
          queryParameter("availability", "Filter by availability."),
        ],
        responses: {
          "200": {
            description: "Matching players.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    players: { type: "array", items: { $ref: "#/components/schemas/Player" } },
                    statWindows: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/players/{playerId}": {
      get: {
        tags: ["Players"],
        summary: "Read player detail",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:league",
        parameters: [pathParameter("playerId", "Player id.")],
        responses: {
          "200": { description: "Player detail with news, stat windows, projections, and management flags." },
          "404": { description: "Player not found.", content: errorContent() },
        },
      },
    },
    "/teams/{teamId}/roster": {
      get: {
        tags: ["Teams"],
        summary: "Read a team roster",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:team",
        parameters: [pathParameter("teamId", "Fantasy team id.")],
        responses: {
          "200": { description: "Team roster and validation." },
          "404": { description: "Team not found.", content: errorContent() },
        },
      },
    },
    "/teams/{teamId}/players/{playerId}/actions": {
      post: {
        tags: ["Teams"],
        summary: "Apply a player management action",
        security: bearerSecurity,
        "x-ofb-required-scope": "write:transactions or write:lineup",
        parameters: [pathParameter("teamId", "Fantasy team id."), pathParameter("playerId", "Player id.")],
        requestBody: jsonBody({
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["add", "drop", "move-to-il", "move-to-na"] },
          },
        }),
        responses: {
          "200": { description: "Player action applied and refreshed player detail returned." },
          "400": { description: "Invalid action payload.", content: errorContent() },
          "404": { description: "Team or player not found.", content: errorContent() },
          "409": { description: "Action conflicts with the current roster state.", content: errorContent() },
          "422": { description: "Action is not allowed by player status or league settings.", content: errorContent() },
        },
      },
    },
    "/teams/{teamId}/lineup": {
      get: {
        tags: ["Teams"],
        summary: "Read a team lineup",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:team",
        parameters: [pathParameter("teamId", "Fantasy team id.")],
        responses: {
          "200": { description: "Team lineup and validation." },
          "404": { description: "Team not found.", content: errorContent() },
        },
      },
      patch: {
        tags: ["Teams"],
        summary: "Validate or set a team lineup",
        security: bearerSecurity,
        "x-ofb-required-scope": "write:lineup",
        parameters: [pathParameter("teamId", "Fantasy team id.")],
        requestBody: jsonBody({ $ref: "#/components/schemas/LineupPatchInput" }),
        responses: {
          "202": { description: "Lineup accepted." },
          "200": { description: "Lineup validation issues returned." },
          "400": { description: "Invalid lineup payload.", content: errorContent() },
          "404": { description: "Team not found.", content: errorContent() },
        },
      },
    },
    "/teams/{teamId}/matchup": {
      get: {
        tags: ["Teams"],
        summary: "Read active matchup details",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:team",
        parameters: [pathParameter("teamId", "Fantasy team id.")],
        responses: {
          "200": { description: "Active matchup score, category rows, and lineup totals." },
          "404": { description: "Matchup not found.", content: errorContent() },
        },
      },
    },
    "/leagues/{leagueId}/draft": {
      get: {
        tags: ["Draft"],
        summary: "Read the live draft state",
        description:
          "Returns the draft's teams, picks, on-the-clock cursor, and server-authoritative pick deadline. Reading also lazily resolves any expired turns (bot picks and auto-picks), so the clock advances as long as anyone is polling.",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:team",
        parameters: [pathParameter("leagueId", "League id.")],
        responses: {
          "200": { description: "Current draft state." },
          "404": { description: "League or draft not found.", content: errorContent() },
        },
      },
    },
    "/leagues/{leagueId}/draft/players": {
      get: {
        tags: ["Draft"],
        summary: "List available draft players",
        description: "Undrafted players in the league's player pool (all/AL/NL), ranked by external ADP with a derived fallback.",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:team",
        parameters: [
          pathParameter("leagueId", "League id."),
          { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Name search." },
          { name: "position", in: "query", required: false, schema: { type: "string" }, description: "Position filter (C, 1B, ..., SP, RP)." },
        ],
        responses: {
          "200": { description: "Ranked available players." },
          "404": { description: "League not found.", content: errorContent() },
        },
      },
    },
    "/leagues/{leagueId}/draft/setup": {
      post: {
        tags: ["Draft"],
        summary: "Set up the draft (commissioner)",
        description: "Creates the commissioner's team, fills open seats with bot teams, and writes the draft order and pick clock.",
        security: bearerSecurity,
        "x-ofb-required-scope": "write:draft",
        parameters: [pathParameter("leagueId", "League id.")],
        requestBody: jsonBody({
          type: "object",
          required: ["pickSeconds", "myTeamName"],
          properties: {
            pickSeconds: { type: "integer", minimum: 15, maximum: 300 },
            randomizeOrder: { type: "boolean" },
            order: { type: "array", items: { type: "string", format: "uuid" } },
            fillWithBots: { type: "boolean" },
            myTeamName: { type: "string", minLength: 3, maxLength: 40 },
          },
        }),
        responses: {
          "201": { description: "Draft created or updated; current state returned." },
          "400": { description: "Invalid setup payload.", content: errorContent() },
          "403": { description: "Only the commissioner can set up the draft.", content: errorContent() },
          "409": { description: "The draft has already started.", content: errorContent() },
          "503": { description: "Drafting requires a configured database.", content: errorContent() },
        },
      },
    },
    "/leagues/{leagueId}/draft/start": {
      post: {
        tags: ["Draft"],
        summary: "Start the draft (commissioner)",
        security: bearerSecurity,
        "x-ofb-required-scope": "write:draft",
        parameters: [pathParameter("leagueId", "League id.")],
        responses: {
          "200": { description: "Draft started; pick 1 is on the clock." },
          "403": { description: "Only the commissioner can start the draft.", content: errorContent() },
          "409": { description: "Seats are unfilled or the draft already started.", content: errorContent() },
          "503": { description: "Drafting requires a configured database.", content: errorContent() },
        },
      },
    },
    "/leagues/{leagueId}/draft/pause": {
      post: {
        tags: ["Draft"],
        summary: "Pause or resume the draft (commissioner)",
        description: "Pausing stores the clock remainder; resuming restores it.",
        security: bearerSecurity,
        "x-ofb-required-scope": "write:draft",
        parameters: [pathParameter("leagueId", "League id.")],
        requestBody: jsonBody({
          type: "object",
          required: ["action"],
          properties: { action: { type: "string", enum: ["pause", "resume"] } },
        }),
        responses: {
          "200": { description: "Draft paused or resumed." },
          "403": { description: "Only the commissioner can pause or resume.", content: errorContent() },
          "409": { description: "The draft is not in a pausable/resumable state.", content: errorContent() },
          "503": { description: "Drafting requires a configured database.", content: errorContent() },
        },
      },
    },
    "/leagues/{leagueId}/draft/pick": {
      post: {
        tags: ["Draft"],
        summary: "Make the on-clock pick",
        description:
          "Drafts a player for the on-the-clock team. The caller must manage that team (or be commissioner). Completing the final pick activates the league and auto-assigns initial lineups.",
        security: bearerSecurity,
        "x-ofb-required-scope": "write:draft",
        parameters: [pathParameter("leagueId", "League id.")],
        requestBody: jsonBody({
          type: "object",
          required: ["playerId"],
          properties: { playerId: { type: "string", format: "uuid" } },
        }),
        responses: {
          "200": { description: "Pick recorded; refreshed draft state returned." },
          "400": { description: "Invalid pick payload.", content: errorContent() },
          "403": { description: "Not your turn or not your team.", content: errorContent() },
          "409": { description: "Player already drafted or the draft is not in progress.", content: errorContent() },
          "422": { description: "Player is outside the league's player pool.", content: errorContent() },
          "503": { description: "Drafting requires a configured database.", content: errorContent() },
        },
      },
    },
    "/leagues": {
      post: {
        tags: ["Leagues"],
        summary: "Create a league",
        requestBody: jsonBody({ $ref: "#/components/schemas/LeagueCreateInput" }),
        responses: {
          "201": { description: "League created." },
          "400": { description: "Invalid league settings.", content: errorContent() },
        },
      },
    },
    "/leagues/{leagueId}/settings": {
      get: {
        tags: ["Leagues"],
        summary: "Read league settings and commissioner-editable fields",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:league",
        parameters: [pathParameter("leagueId", "League id.")],
        responses: {
          "200": { description: "League settings." },
        },
      },
    },
    "/leagues/{leagueId}/overview": {
      get: {
        tags: ["Leagues"],
        summary: "Read league standings, team stats, and settings",
        security: bearerSecurity,
        "x-ofb-required-scope": "read:league",
        parameters: [pathParameter("leagueId", "League id.")],
        responses: {
          "200": { description: "League overview." },
        },
      },
    },
    "/leagues/settings-matrix": {
      get: {
        tags: ["Leagues"],
        summary: "Read setting definitions for a scoring type",
        parameters: [queryParameter("scoringType", "h2h-categories, h2h-points, or roto.")],
        responses: {
          "200": { description: "Setting definitions." },
          "400": { description: "Unsupported scoring type.", content: errorContent() },
        },
      },
    },
  },
} as const;

function errorContent() {
  return {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  };
}

function jsonBody(schema: unknown) {
  return {
    required: true,
    content: {
      "application/json": {
        schema,
      },
    },
  };
}

function pathParameter(name: string, description: string) {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
  };
}

function queryParameter(name: string, description: string) {
  return {
    name,
    in: "query",
    required: false,
    description,
    schema: { type: "string" },
  };
}
