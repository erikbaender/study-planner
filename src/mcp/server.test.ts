import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { sha256Base64url } from "../../convex/mcpOAuth";

const bridge = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { constructor() { return bridge.client as object; } } }));
import { POST, GET, OPTIONS } from "../app/mcp/route";
import { POST as register } from "../app/oauth/register/route";
import { POST as token } from "../app/oauth/token/route";
import { POST as revoke } from "../app/oauth/revoke/route";
import { GET as resourceMetadata } from "../app/.well-known/oauth-protected-resource/mcp/route";
import { GET as serverMetadata } from "../app/.well-known/oauth-authorization-server/route";

const modules = { ...import.meta.glob("../../convex/**/*.ts"), ...import.meta.glob("../../convex/_generated/*.js") };
const issuer = "https://planner.example";
const resource = `${issuer}/mcp`;
const request = (path: string, body?: object, headers?: Record<string, string>) => new Request(`${issuer}${path}`, {
  method: body ? "POST" : "GET",
  headers: { host: "planner.example", "content-type": "application/json", ...headers },
  body: body ? JSON.stringify(body) : undefined,
});
const formRequest = (path: string, values: Record<string, string>) => new Request(`${issuer}${path}`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values),
});
async function setup() {
  vi.stubEnv("MCP_ISSUER", issuer);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  bridge.client = { query: t.query, mutation: t.mutation };
  const ownerId = await t.run(ctx => ctx.db.insert("users", { name: "Protocol tester" }));
  const registration = await register(request("/oauth/register", { client_name: "Independent SDK client", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none" }));
  expect(registration.status).toBe(201);
  const { client_id } = await registration.json();
  const verifier = "v".repeat(64);
  const code = "single-use-authorization-code";
  const owner = t.withIdentity({ subject: ownerId });
  await owner.mutation(api.mcpOAuth.authorize, { clientId: client_id, redirectUri: "https://client.example/callback", resource, issuer, scopes: ["planner:read", "planner:manage"], codeChallenge: await sha256Base64url(verifier), codeDigest: await sha256Base64url(code) });
  const parameters = { grant_type: "authorization_code", client_id, code, redirect_uri: "https://client.example/callback", resource, code_verifier: verifier };
  const response = await token(formRequest("/oauth/token", parameters));
  expect(response.status).toBe(200);
  return { t, owner, client_id, parameters, tokens: await response.json() };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("remote MCP and OAuth protocol", () => {
  it("negotiates initialize, discovers tools/resource and validates structured results through Streamable HTTP", async () => {
    const { tokens } = await setup();
    const client = new Client({ name: "provider-independent-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      fetch: async (input, init) => {
        const req = new Request(input, init);
        req.headers.set("host", "planner.example");
        return req.method === "POST" ? POST(req) : GET(req);
      },
    });
    try {
      await client.connect(transport);
      expect(client.getServerCapabilities()?.tools).toBeDefined();
      expect(client.getInstructions()).toContain("revision");
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(8);
      expect(tools.tools.every(tool => tool.outputSchema)).toBe(true);
      expect((await client.listResources()).resources[0].uri).toBe("study-planner://guide");
      expect((await client.readResource({ uri: "study-planner://guide" })).contents).toHaveLength(1);
      const created = await client.callTool({ name: "planner.create", arguments: { idempotencyKey: "protocol-plan-create", plan: {
        name: "Protocol semester", generateInitialSchedule: true, today: "2026-09-05",
        courses: ["Biology", "Chemistry"].map((name, i) => ({ ref: `course${i}`, name, color: "violet", exams: [{ ref: `exam${i}`, name: "Final", startDate: "2026-10-01" }], topics: [{ ref: `topic${i}`, name: "Basics", totalUnits: 40, color: "violet" }] })),
      } } });
      expect(created.isError).not.toBe(true);
      expect(created.structuredContent).toMatchObject({ revision: 1, planId: expect.any(String) });
      const planId = (created.structuredContent as { planId: string }).planId;
      const snapshot = await client.callTool({ name: "planner.get", arguments: { planId } });
      expect(snapshot.structuredContent).toMatchObject({ plan: { name: "Protocol semester", courses: expect.any(Array) } });
      const stale = await client.callTool({ name: "planner.apply_changes", arguments: { planId, expectedRevision: 0, idempotencyKey: "protocol-stale-request", commands: [{ type: "plan.update", patch: { name: "Stale" } }] } });
      expect(stale.isError).toBe(true);
      expect(JSON.stringify(stale.content)).toContain("Revision conflict");
    } finally { await client.close(); }
  });

  it("publishes consistent discovery, rejects origins/hosts and bounds even chunked bodies", async () => {
    const { tokens } = await setup();
    expect(await (await resourceMetadata(request("/.well-known/oauth-protected-resource/mcp"))).json()).toMatchObject({ resource, authorization_servers: [issuer] });
    expect(await (await serverMetadata(request("/.well-known/oauth-authorization-server"))).json()).toMatchObject({ issuer, code_challenge_methods_supported: ["S256"] });
    const unauthorized = await POST(request("/mcp", {}));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect((await POST(request("/mcp", {}, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(request("/mcp", {}, { host: "evil.example" }))).status).toBe(421);
    expect((await POST(request("/mcp", { payload: "x".repeat(1_048_576) }, { authorization: `Bearer ${tokens.access_token}` }))).status).toBe(413);
    expect((await OPTIONS(new Request(resource, { method: "OPTIONS", headers: { host: "planner.example", origin: issuer } }))).status).toBe(204);
  });

  it("rejects code replay, rotates refresh tokens and revokes reads/writes/refresh immediately", async () => {
    const { tokens, client_id, parameters } = await setup();
    expect((await token(formRequest("/oauth/token", parameters))).status).toBe(400);
    const refreshed = await token(formRequest("/oauth/token", { grant_type: "refresh_token", client_id, resource, refresh_token: tokens.refresh_token }));
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await POST(request("/mcp", {}, { authorization: `Bearer ${tokens.access_token}` }))).status).toBe(401);
    expect((await revoke(formRequest("/oauth/revoke", { client_id, token: next.refresh_token }))).status).toBe(200);
    for (const method of ["planner.list", "planner.apply_changes"]) {
      expect((await POST(request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: method } }, { authorization: `Bearer ${next.access_token}` }))).status).toBe(401);
    }
    expect((await token(formRequest("/oauth/token", { grant_type: "refresh_token", client_id, resource, refresh_token: next.refresh_token }))).status).toBe(400);
  });
});
