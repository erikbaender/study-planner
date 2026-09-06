import "server-only";
import { boundedBody } from "./body";

import { createHash, randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";

export const SUPPORTED_MCP_SCOPES = [
  "planner:read",
  "planner:manage",
  "planner:destructive",
] as const;
export const DEFAULT_MCP_SCOPES = ["planner:read", "planner:manage"] as const;

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function publicRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const host = firstForwardedValue(request.headers.get("x-forwarded-host"))
    ?? request.headers.get("host")?.trim()
    ?? requestUrl.host;
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto"))
    ?? requestUrl.protocol.replace(/:$/, "");
  try {
    const candidate = new URL(`${protocol}://${host}`);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(candidate.hostname);
    const matchesRequestUrl = candidate.host === requestUrl.host && requestUrl.hostname !== "0.0.0.0";
    return loopback || matchesRequestUrl ? candidate.origin : requestUrl.origin;
  } catch {
    return requestUrl.origin;
  }
}

export function issuerFor(request: Request) {
  const configured = process.env.MCP_ISSUER?.trim().replace(/\/+$/, "");
  if (configured) return new URL(configured).origin;
  return publicRequestOrigin(request);
}

export function resourceFor(request: Request) {
  return `${issuerFor(request)}/mcp`;
}

export function convexServerClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for OAuth and MCP routes");
  return new ConvexHttpClient(url);
}

export function randomOpaque(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function sha256Base64url(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function parseScopes(value: string | null, fallback: readonly string[] = []) {
  const scopes = value?.trim() ? value.trim().split(/\s+/) : [...fallback];
  if (
    scopes.length < 1 ||
    scopes.length > SUPPORTED_MCP_SCOPES.length ||
    new Set(scopes).size !== scopes.length ||
    scopes.some((scope) => !SUPPORTED_MCP_SCOPES.includes(scope as never))
  ) {
    throw new OAuthError("invalid_scope", "Only planner:read, planner:manage, and planner:destructive are supported");
  }
  return scopes as Array<(typeof SUPPORTED_MCP_SCOPES)[number]>;
}

export function validateRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError("invalid_redirect_uri", "redirect_uri must be an absolute URI");
  }
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.hash) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "redirect_uri must use HTTPS (or loopback HTTP) and contain no credentials or fragment",
    );
  }
  return url.toString();
}

export function validateProtectedRequest(request: Request) {
  const requestUrl = new URL(request.url);
  const issuer = new URL(issuerFor(request));
  const publicHost = firstForwardedValue(request.headers.get("x-forwarded-host"))
    ?? request.headers.get("host")?.trim();
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname);
  const matchesRequestUrl = publicHost === requestUrl.host && requestUrl.hostname !== "0.0.0.0";
  if (
    !publicHost
    || publicHost !== issuer.host
    || (!process.env.MCP_ISSUER && !isLoopback && !matchesRequestUrl)
  ) {
    return new Response("Invalid Host", { status: 421 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;
  const configured = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const allowed = new Set([issuer.origin, ...configured]);
  if (!allowed.has(origin.replace(/\/+$/, ""))) {
    return new Response("Invalid Origin", { status: 403 });
  }
  return null;
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match?.[1] ?? null;
}

export function bearerChallenge(request: Request, error?: string) {
  const details = error ? `, error="${error}"` : "";
  return `Bearer resource_metadata="${issuerFor(request)}/.well-known/oauth-protected-resource/mcp"${details}`;
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function oauthErrorResponse(cause: unknown) {
  const error = cause instanceof OAuthError ? cause : new OAuthError("invalid_request", cause instanceof Error ? cause.message : "Invalid request");
  return Response.json(
    { error: error.code, error_description: error.message },
    {
      status: error.status,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    },
  );
}

export async function formData(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new OAuthError("invalid_request", "OAuth token requests must use application/x-www-form-urlencoded");
  }
  return new URLSearchParams(await boundedBody(request, 16_384));
}
