import { GET as getMcpProtectedResourceMetadata } from "./mcp/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getMcpProtectedResourceMetadata(request);
}
