import Link from "next/link";
import { openApiDocument } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

type OpenApiMethod = {
  summary?: string;
  tags?: readonly string[];
  security?: unknown;
  "x-ofb-required-scope"?: string;
  "x-ofb-required-role"?: string;
};

const methods = ["get", "post", "patch", "delete"] as const;

function documentedOperations() {
  return Object.entries(openApiDocument.paths).flatMap(([path, pathItem]) =>
    methods.flatMap((method) => {
      const operation = pathItem[method as keyof typeof pathItem] as OpenApiMethod | undefined;

      return operation
        ? [
            {
              method: method.toUpperCase(),
              path,
              tag: operation.tags?.[0] ?? "API",
              summary: operation.summary ?? path,
              scope: operation["x-ofb-required-scope"] ?? null,
              role: operation["x-ofb-required-role"] ?? null,
            },
          ]
        : [];
    }),
  );
}

export default function ApiDocsPage() {
  const operations = documentedOperations();

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <div className="brand-lockup">
          <span className="brand-kicker">Developer</span>
          <span className="brand-title">API Docs</span>
        </div>
        <a className="icon-button" href="/api/v1/openapi.json" aria-label="Open OpenAPI JSON">
          JSON
        </a>
      </header>

      <section className="page">
        <section className="panel api-docs-hero">
          <h1>{openApiDocument.info.title}</h1>
          <p className="subtle">{openApiDocument.info.description}</p>
          <p className="subtle">MCP endpoint: /api/mcp</p>
          <div className="api-docs-actions">
            <a className="primary-button" href="/api/v1/openapi.json">
              Open JSON
            </a>
            <Link className="secondary-button" href="/profile">
              Manage Tokens
            </Link>
          </div>
        </section>

        <section className="panel api-docs-panel" aria-labelledby="operations-heading">
          <h2 id="operations-heading">Operations</h2>
          <div className="api-operation-list">
            {operations.map((operation) => (
              <div className="api-operation" key={`${operation.method}:${operation.path}`}>
                <div className="api-operation-main">
                  <span className={`api-method method-${operation.method.toLowerCase()}`}>{operation.method}</span>
                  <span className="api-path">{operation.path}</span>
                </div>
                <div className="player-meta">{operation.summary}</div>
                <div className="api-operation-meta">
                  <span className="pill">{operation.tag}</span>
                  {operation.scope ? <span className="pill">{operation.scope}</span> : null}
                  {operation.role ? <span className="pill">{operation.role}</span> : null}
                  {!operation.scope && !operation.role ? <span className="pill">public/demo</span> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
