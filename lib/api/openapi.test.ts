import { describe, expect, it } from "vitest";
import { oauthScopes } from "@/lib/auth/scopes";
import { openApiDocument } from "./openapi";

describe("openApiDocument", () => {
  it("publishes API metadata and bearer auth", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("documents every OAuth scope enum value", () => {
    expect(openApiDocument.components.schemas.OAuthScope.enum).toEqual(oauthScopes);
  });

  it("documents scoped owner routes", () => {
    expect(openApiDocument.paths["/players"].get["x-ofb-required-scope"]).toBe("read:league");
    expect(openApiDocument.paths["/teams/{teamId}/lineup"].patch["x-ofb-required-scope"]).toBe("write:lineup");
    expect(openApiDocument.paths["/profile/preferences"].get["x-ofb-required-scope"]).toBe("read:profile");
  });

  it("only documents real OAuth scopes on scoped routes", () => {
    const validScopes = new Set<string>(oauthScopes);
    const offenders: string[] = [];

    for (const [path, methods] of Object.entries(
      openApiDocument.paths as Record<string, Record<string, Record<string, unknown>>>,
    )) {
      for (const [method, operation] of Object.entries(methods)) {
        const scopeDoc = operation["x-ofb-required-scope"];
        if (typeof scopeDoc !== "string") {
          continue;
        }
        // A route may accept one of several scopes, e.g. "write:transactions or write:lineup".
        for (const token of scopeDoc.split(/\s+or\s+|,\s*/)) {
          if (!validScopes.has(token.trim())) {
            offenders.push(`${method.toUpperCase()} ${path} -> ${token}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("documents session-admin routes", () => {
    expect(openApiDocument.components.securitySchemes.neonSession.in).toBe("cookie");
    expect(openApiDocument.paths["/admin/jobs/nightly"].post["x-ofb-required-role"]).toBe("admin");
    expect(openApiDocument.paths["/admin/sync/mlb"].post["x-ofb-required-role"]).toBe("admin");
    expect(openApiDocument.paths["/admin/runs"].get["x-ofb-required-role"]).toBe("admin");
  });
});
