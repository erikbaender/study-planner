import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { boundedBody } from "@/mcp/body";
import { api } from "../../../convex/_generated/api";
import { createPlannerMcpServer } from "@/mcp/server";
import {
  bearerChallenge,
  bearerToken,
  convexServerClient,
  issuerFor,
  resourceFor,
  sha256Base64url,
  validateProtectedRequest,
} from "@/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withProtocolHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Expose-Headers", "MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate");
  const origin = request.headers.get("origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function authenticate(request: Request) {
  const invalid = validateProtectedRequest(request);
  if (invalid) return { response: invalid } as const;
  const token = bearerToken(request);
  if (!token) {
    return {
      response: new Response("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": bearerChallenge(request) },
      }),
    } as const;
  }
  const identity = {
    tokenDigest: sha256Base64url(token),
    issuer: issuerFor(request),
    resource: resourceFor(request),
  };
  try {
    const principal = await convexServerClient().mutation(api.mcpOAuth.authenticateAccess, {
      ...identity,
      requiredScopes: ["planner:read"],
    });
    return { identity, principal, token } as const;
  } catch {
    return {
      response: new Response("Invalid or expired access token", {
        status: 401,
        headers: { "WWW-Authenticate": bearerChallenge(request, "invalid_token") },
      }),
    } as const;
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id")?.slice(0, 100) || crypto.randomUUID();
  const authentication = await authenticate(request);
  if ("response" in authentication && authentication.response) return withProtocolHeaders(authentication.response, request);

  let body: string;
  try {
    body = await boundedBody(request, 1_048_576);
  } catch {
    return withProtocolHeaders(new Response("Request body exceeds the size limit", { status: 413 }), request);
  }
  let operation = "unknown";
  try {
    const envelope = JSON.parse(body) as { method?: unknown; params?: { name?: unknown } };
    operation = envelope.method === "tools/call" && typeof envelope.params?.name === "string"
      ? envelope.params.name
      : typeof envelope.method === "string" ? envelope.method : "unknown";
  } catch {
    // The SDK returns the protocol-level parse error; logs intentionally omit the payload.
  }

  try {
    const server = createPlannerMcpServer(authentication.identity);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(new Request(request, { body }), {
      authInfo: {
        token: authentication.token,
        clientId: String(authentication.principal.grantId),
        scopes: authentication.principal.scopes,
        resource: new URL(authentication.identity.resource),
      },
    });
    console.info(JSON.stringify({ requestId, tool: operation, grantId: authentication.principal.grantId, durationMs: Date.now() - startedAt, resultClass: response.ok ? "success" : `http_${response.status}`, affectedEntityCount: 0 }));
    return withProtocolHeaders(response, request);
  } catch (cause) {
    console.error(JSON.stringify({ requestId, tool: operation, grantId: authentication.principal.grantId, durationMs: Date.now() - startedAt, resultClass: "server_error", affectedEntityCount: 0 }));
    return withProtocolHeaders(
      Response.json(
        { jsonrpc: "2.0", error: { code: -32603, message: cause instanceof Error ? cause.message : "Internal MCP error" }, id: null },
        { status: 500 },
      ),
      request,
    );
  }
}

async function methodNotAllowed(request: Request) {
  const authentication = await authenticate(request);
  if ("response" in authentication && authentication.response) return withProtocolHeaders(authentication.response, request);
  return withProtocolHeaders(new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } }), request);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

export async function OPTIONS(request: Request) {
  const invalid = validateProtectedRequest(request);
  if (invalid) return invalid;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": request.headers.get("origin") ?? issuerFor(request),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
      "Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}
