import { issuerFor, resourceFor } from "@/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const issuer = issuerFor(request);
  return Response.json(
    {
      resource: resourceFor(request),
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      scopes_supported: ["planner:read", "planner:manage", "planner:destructive"],
      resource_documentation: `${issuer}/mcp/privacy`,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
