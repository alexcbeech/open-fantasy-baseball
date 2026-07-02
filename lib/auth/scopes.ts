export const oauthScopes = [
  "read:profile",
  "read:league",
  "read:team",
  "write:lineup",
  "write:transactions",
  "write:trades",
  "commissioner:league",
] as const;

export type OAuthScope = (typeof oauthScopes)[number];

export const scopeDescriptions: Record<OAuthScope, string> = {
  "read:profile": "Read profile and notification preferences.",
  "read:league": "Read league settings, standings, teams, players, and matchups.",
  "read:team": "Read rosters, lineups, and team transaction history.",
  "write:lineup": "Set lineups and manage bench, IL, and NA assignments.",
  "write:transactions": "Add, drop, waiver, and FAAB bid on players.",
  "write:trades": "Create, accept, reject, and cancel trade offers.",
  "commissioner:league": "Manage commissioner-controlled league settings and decisions.",
};

