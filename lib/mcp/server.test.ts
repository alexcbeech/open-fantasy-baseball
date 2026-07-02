import { describe, expect, it } from "vitest";
import { handleMcpRequest, mcpTools } from "./server";

function expectResult(response: Awaited<ReturnType<typeof handleMcpRequest>>) {
  expect(response).not.toBeNull();
  expect(response).toHaveProperty("result");
  return response as NonNullable<typeof response> & { result: unknown };
}

function expectError(response: Awaited<ReturnType<typeof handleMcpRequest>>) {
  expect(response).not.toBeNull();
  expect(response).toHaveProperty("error");
  return response as NonNullable<typeof response> & { error: { code: number; message: string } };
}

describe("MCP server", () => {
  it("responds to initialize with the supported protocol version", async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      },
      null,
    );
    const result = expectResult(response);

    expect(result.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
    });
  });

  it("lists the OFB tools with required scope metadata", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, null);
    const result = expectResult(response);

    expect(result.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "ofb_search_players",
          metadata: { requiredScope: "read:league" },
        }),
      ]),
    });
    expect(mcpTools).toHaveLength(3);
  });

  it("requires bearer auth for tool calls", async () => {
    const response = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "ofb_search_players", arguments: { query: "Judge" } },
      },
      null,
    );
    const error = expectError(response);

    expect(error.error).toMatchObject({
      code: -32001,
      message: "Bearer token is required for MCP tool calls.",
    });
  });

  it("returns null for initialized notifications", async () => {
    await expect(handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, null)).resolves.toBeNull();
  });
});
