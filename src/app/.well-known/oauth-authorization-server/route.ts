import { issuerFor } from "@/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const issuer = issuerFor(request);
  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["planner:read", "planner:manage", "planner:destructive"],
      service_documentation: `${issuer}/mcp/privacy`,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
