import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { recordOtherPreferenceChanges } from "./plannerApplication";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const MCP_SCOPES = ["planner:read", "planner:manage", "planner:destructive"] as const;
const DEFAULT_SCOPES = ["planner:read", "planner:manage"];
const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1_000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const AUTHORIZATION_CODE_LIFETIME_MS = 5 * 60 * 1_000;
const REQUESTS_PER_MINUTE = 120;

export async function sha256Base64url(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const scopeValidator = v.union(
  v.literal("planner:read"),
  v.literal("planner:manage"),
  v.literal("planner:destructive"),
);

function assertDigest(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256 base64url digest`);
  }
}

function assertOpaqueIdentifier(value: string, label: string, max = 200) {
  if (value.length < 16 || value.length > max || !/^[A-Za-z0-9._~:-]+$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertHttpsOrLoopbackUri(value: string, label: string) {
  if (value.length > 2_048) throw new Error(`${label} is too long`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URI`);
  }
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !loopback) {
    throw new Error(`${label} must use HTTPS (HTTP is allowed only for loopback clients)`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not contain credentials or a fragment`);
  }
}

function assertScopes(scopes: string[]) {
  if (scopes.length < 1 || scopes.length > MCP_SCOPES.length) {
    throw new Error("At least one supported scope is required");
  }
  if (new Set(scopes).size !== scopes.length || scopes.some((scope) => !MCP_SCOPES.includes(scope as never))) {
    throw new Error("Unsupported or repeated OAuth scope");
  }
}

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Authentication required");
  return userId;
}

async function clientByPublicId(ctx: { db: QueryCtx["db"] | MutationCtx["db"] }, clientId: string) {
  const client = await ctx.db
    .query("oauthClients")
    .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
    .unique();
  if (!client) throw new Error("Unknown OAuth client");
  return client;
}

async function tokenByDigest(ctx: { db: QueryCtx["db"] | MutationCtx["db"] }, tokenDigest: string) {
  assertDigest(tokenDigest, "Token digest");
  return await ctx.db
    .query("oauthTokens")
    .withIndex("by_token_digest", (q) => q.eq("tokenDigest", tokenDigest))
    .unique();
}

export type McpPrincipal = {
  ownerId: Id<"users">;
  grantId: Id<"mcpGrants">;
  clientId: Id<"oauthClients">;
  scopes: string[];
};

/** Re-validates every bearer-token property at the same transaction boundary as a tool operation. */
export async function requireMcpPrincipal(
  ctx: { db: QueryCtx["db"] | MutationCtx["db"] },
  args: {
    tokenDigest: string;
    issuer: string;
    resource: string;
    requiredScopes: string[];
  },
): Promise<McpPrincipal> {
  assertHttpsOrLoopbackUri(args.issuer, "Issuer");
  assertHttpsOrLoopbackUri(args.resource, "Resource");
  assertScopes(args.requiredScopes);
  const token = await tokenByDigest(ctx, args.tokenDigest);
  const now = Date.now();
  if (
    !token ||
    token.kind !== "access" ||
    token.revokedAt !== undefined ||
    token.expiresAt <= now ||
    token.issuer !== args.issuer ||
    token.audience !== args.resource ||
    args.requiredScopes.some((scope) => !token.scopes.includes(scope))
  ) {
    throw new Error("Invalid, expired, wrong-audience, or insufficient-scope access token");
  }
  const grant = await ctx.db.get(token.grantId);
  if (!grant || grant.revokedAt !== undefined) {
    throw new Error("The MCP connection has been revoked");
  }
  if (args.requiredScopes.some((scope) => !grant.scopes.includes(scope))) {
    throw new Error("The MCP connection does not grant the required scope");
  }
  return {
    ownerId: grant.ownerId,
    grantId: grant._id,
    clientId: grant.clientId,
    scopes: grant.scopes,
  };
}

export const registerClient = mutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    redirectUris: v.array(v.string()),
  },
  returns: v.object({ clientId: v.string(), name: v.string(), redirectUris: v.array(v.string()) }),
  handler: async (ctx, args) => {
    assertOpaqueIdentifier(args.clientId, "Client id");
    const name = args.name.trim();
    if (!name || name.length > 100) throw new Error("Client name must be 1–100 characters");
    if (args.redirectUris.length < 1 || args.redirectUris.length > 10) {
      throw new Error("A client must register 1–10 redirect URIs");
    }
    if (new Set(args.redirectUris).size !== args.redirectUris.length) {
      throw new Error("Redirect URIs must be distinct");
    }
    for (const uri of args.redirectUris) assertHttpsOrLoopbackUri(uri, "Redirect URI");
    const existing = await ctx.db
      .query("oauthClients")
      .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
      .unique();
    if (existing) throw new Error("Client id already exists");
    await ctx.db.insert("oauthClients", {
      clientId: args.clientId,
      name,
      redirectUris: args.redirectUris,
      createdAt: Date.now(),
    });
    return { clientId: args.clientId, name, redirectUris: args.redirectUris };
  },
});

export const describeAuthorizationRequest = query({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    resource: v.string(),
    scopes: v.array(scopeValidator),
    codeChallenge: v.string(),
  },
  returns: v.object({ clientName: v.string(), scopes: v.array(scopeValidator) }),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const client = await clientByPublicId(ctx, args.clientId);
    if (!client.redirectUris.includes(args.redirectUri)) throw new Error("Redirect URI is not registered");
    assertHttpsOrLoopbackUri(args.resource, "Resource");
    assertScopes(args.scopes);
    assertDigest(args.codeChallenge, "PKCE code challenge");
    return { clientName: client.name, scopes: args.scopes };
  },
});

export const authorize = mutation({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    resource: v.string(),
    issuer: v.string(),
    scopes: v.array(scopeValidator),
    codeChallenge: v.string(),
    codeDigest: v.string(),
    timezone: v.optional(v.string()),
  },
  returns: v.object({ grantId: v.id("mcpGrants"), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
    const client = await clientByPublicId(ctx, args.clientId);
    if (!client.redirectUris.includes(args.redirectUri)) throw new Error("Redirect URI is not registered");
    assertHttpsOrLoopbackUri(args.resource, "Resource");
    assertHttpsOrLoopbackUri(args.issuer, "Issuer");
    assertScopes(args.scopes);
    assertDigest(args.codeChallenge, "PKCE code challenge");
    assertDigest(args.codeDigest, "Authorization code digest");
    if (args.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: args.timezone });
      } catch {
        throw new Error("Timezone must be a valid IANA timezone");
      }
    }

    const now = Date.now();
    const candidates = await ctx.db
      .query("mcpGrants")
      .withIndex("by_owner_and_client", (q) => q.eq("ownerId", ownerId).eq("clientId", client._id))
      .order("desc")
      .take(10);
    let grant = candidates.find((candidate) => candidate.revokedAt === undefined);
    if (grant) {
      await ctx.db.patch(grant._id, { scopes: args.scopes, updatedAt: now });
      grant = { ...grant, scopes: args.scopes, updatedAt: now };
    } else {
      const grantId = await ctx.db.insert("mcpGrants", {
        ownerId,
        clientId: client._id,
        scopes: args.scopes,
        createdAt: now,
        updatedAt: now,
      });
      grant = (await ctx.db.get(grantId))!;
    }
    const expiresAt = now + AUTHORIZATION_CODE_LIFETIME_MS;
    await ctx.db.insert("oauthAuthorizationCodes", {
      codeDigest: args.codeDigest,
      grantId: grant._id,
      clientId: client._id,
      redirectUri: args.redirectUri,
      resource: args.resource,
      issuer: args.issuer,
      scopes: args.scopes,
      codeChallenge: args.codeChallenge,
      expiresAt,
    });
    if (args.timezone !== undefined) {
      const preferences = await ctx.db
        .query("preferences")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .unique();
      if (preferences && !preferences.timezone) {
        await ctx.db.patch(preferences._id, { timezone: args.timezone, revision: (preferences.revision ?? 0) + 1, updatedAt: now });
      } else if (!preferences) {
        await ctx.db.insert("preferences", {
          ownerId,
          studyDaysOfWeek: [1, 2, 3, 4, 5, 6],
          blackoutDates: [],
          theme: "system",
          accentColor: "#1769e0",
          timezone: args.timezone,
          revision: 1,
          updatedAt: now,
        });
      }
      if (!preferences?.timezone) await recordOtherPreferenceChanges(ctx, { ownerId, actorType: "user" });
    }
    return { grantId: grant._id, expiresAt };
  },
});

export const exchangeAuthorizationCode = mutation({
  args: {
    codeDigest: v.string(),
    codeVerifier: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    resource: v.string(),
    issuer: v.string(),
    accessTokenDigest: v.string(),
    refreshTokenDigest: v.string(),
  },
  returns: v.object({
    grantId: v.id("mcpGrants"),
    scopes: v.array(v.string()),
    accessExpiresIn: v.number(),
    refreshExpiresIn: v.number(),
  }),
  handler: async (ctx, args) => {
    assertDigest(args.codeDigest, "Authorization code digest");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(args.codeVerifier)) {
      throw new Error("Invalid PKCE code verifier");
    }
    const verifierChallenge = await sha256Base64url(args.codeVerifier);
    assertDigest(args.accessTokenDigest, "Access token digest");
    assertDigest(args.refreshTokenDigest, "Refresh token digest");
    const code = await ctx.db
      .query("oauthAuthorizationCodes")
      .withIndex("by_code_digest", (q) => q.eq("codeDigest", args.codeDigest))
      .unique();
    const now = Date.now();
    const client = await clientByPublicId(ctx, args.clientId);
    if (
      !code ||
      code.usedAt !== undefined ||
      code.expiresAt <= now ||
      code.clientId !== client._id ||
      code.redirectUri !== args.redirectUri ||
      code.resource !== args.resource ||
      code.issuer !== args.issuer ||
      code.codeChallenge !== verifierChallenge
    ) {
      throw new Error("Authorization code is invalid, expired, already used, or failed PKCE validation");
    }
    const grant = await ctx.db.get(code.grantId);
    if (!grant || grant.revokedAt !== undefined) throw new Error("The MCP connection has been revoked");
    await ctx.db.patch(code._id, { usedAt: now });
    await ctx.db.insert("oauthTokens", {
      tokenDigest: args.accessTokenDigest,
      grantId: grant._id,
      kind: "access",
      issuer: args.issuer,
      audience: args.resource,
      scopes: code.scopes,
      issuedAt: now,
      expiresAt: now + ACCESS_TOKEN_LIFETIME_MS,
    });
    await ctx.db.insert("oauthTokens", {
      tokenDigest: args.refreshTokenDigest,
      grantId: grant._id,
      kind: "refresh",
      issuer: args.issuer,
      audience: args.resource,
      scopes: code.scopes,
      issuedAt: now,
      expiresAt: now + REFRESH_TOKEN_LIFETIME_MS,
    });
    return {
      grantId: grant._id,
      scopes: code.scopes,
      accessExpiresIn: ACCESS_TOKEN_LIFETIME_MS / 1_000,
      refreshExpiresIn: REFRESH_TOKEN_LIFETIME_MS / 1_000,
    };
  },
});

export const refreshAccessToken = mutation({
  args: {
    refreshTokenDigest: v.string(),
    clientId: v.string(),
    resource: v.string(),
    issuer: v.string(),
    accessTokenDigest: v.string(),
    nextRefreshTokenDigest: v.string(),
  },
  returns: v.union(
    v.object({
      grantId: v.id("mcpGrants"),
      scopes: v.array(v.string()),
      accessExpiresIn: v.number(),
      refreshExpiresIn: v.number(),
    }),
    v.object({ error: v.literal("refresh_token_reuse") }),
  ),
  handler: async (ctx, args) => {
    assertDigest(args.refreshTokenDigest, "Refresh token digest");
    assertDigest(args.accessTokenDigest, "Access token digest");
    assertDigest(args.nextRefreshTokenDigest, "Next refresh token digest");
    const token = await tokenByDigest(ctx, args.refreshTokenDigest);
    const client = await clientByPublicId(ctx, args.clientId);
    const now = Date.now();
    const grant = token ? await ctx.db.get(token.grantId) : null;
    if (token?.kind === "refresh" && token.replacedAt !== undefined && grant) {
      await ctx.db.patch(grant._id, { revokedAt: now, updatedAt: now });
      return { error: "refresh_token_reuse" as const };
    }
    if (
      !token ||
      token.kind !== "refresh" ||
      token.revokedAt !== undefined ||
      token.replacedAt !== undefined ||
      token.expiresAt <= now ||
      token.issuer !== args.issuer ||
      token.audience !== args.resource ||
      !grant ||
      grant.clientId !== client._id ||
      grant.revokedAt !== undefined
    ) {
      throw new Error("Refresh token is invalid, expired, replayed, or revoked");
    }
    await ctx.db.patch(token._id, { replacedAt: now });
    const accessTokens = await ctx.db
      .query("oauthTokens")
      .withIndex("by_grant_and_kind", (q) => q.eq("grantId", grant._id).eq("kind", "access"))
      .order("desc")
      .take(20);
    for (const accessToken of accessTokens) {
      if (accessToken.revokedAt === undefined && accessToken.expiresAt > now) {
        await ctx.db.patch(accessToken._id, { revokedAt: now });
      }
    }
    await ctx.db.insert("oauthTokens", {
      tokenDigest: args.accessTokenDigest,
      grantId: grant._id,
      kind: "access",
      issuer: args.issuer,
      audience: args.resource,
      scopes: token.scopes,
      issuedAt: now,
      expiresAt: now + ACCESS_TOKEN_LIFETIME_MS,
    });
    await ctx.db.insert("oauthTokens", {
      tokenDigest: args.nextRefreshTokenDigest,
      grantId: grant._id,
      kind: "refresh",
      issuer: args.issuer,
      audience: args.resource,
      scopes: token.scopes,
      issuedAt: now,
      expiresAt: now + REFRESH_TOKEN_LIFETIME_MS,
    });
    return {
      grantId: grant._id,
      scopes: token.scopes,
      accessExpiresIn: ACCESS_TOKEN_LIFETIME_MS / 1_000,
      refreshExpiresIn: REFRESH_TOKEN_LIFETIME_MS / 1_000,
    };
  },
});

export const revokeToken = mutation({
  args: { tokenDigest: v.string(), clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = await tokenByDigest(ctx, args.tokenDigest);
    if (!token) return null;
    const client = await clientByPublicId(ctx, args.clientId);
    const grant = await ctx.db.get(token.grantId);
    if (!grant || grant.clientId !== client._id) return null;
    const now = Date.now();
    await ctx.db.patch(grant._id, { revokedAt: now, updatedAt: now });
    return null;
  },
});

export const authenticateAccess = mutation({
  args: {
    tokenDigest: v.string(),
    issuer: v.string(),
    resource: v.string(),
    requiredScopes: v.array(scopeValidator),
  },
  returns: v.object({
    ownerId: v.id("users"),
    grantId: v.id("mcpGrants"),
    scopes: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, args);
    const now = Date.now();
    const window = Math.floor(now / 60_000);
    const rate = await ctx.db
      .query("mcpRateLimits")
      .withIndex("by_grant_and_window", (q) => q.eq("grantId", principal.grantId).eq("window", window))
      .unique();
    if (rate && rate.count >= REQUESTS_PER_MINUTE) throw new Error("MCP rate limit exceeded; retry next minute");
    if (rate) await ctx.db.patch(rate._id, { count: rate.count + 1 });
    else await ctx.db.insert("mcpRateLimits", { grantId: principal.grantId, window, count: 1 });
    await ctx.db.patch(principal.grantId, { lastUsedAt: now, updatedAt: now });
    return { ownerId: principal.ownerId, grantId: principal.grantId, scopes: principal.scopes };
  },
});

const connectionValidator = v.object({
  grantId: v.id("mcpGrants"),
  clientName: v.string(),
  scopes: v.array(v.string()),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
});

export const listConnections = query({
  args: {},
  returns: v.array(connectionValidator),
  handler: async (ctx) => {
    const ownerId = await requireUser(ctx);
    const grants = await ctx.db
      .query("mcpGrants")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(50);
    const active = grants.filter((grant) => grant.revokedAt === undefined);
    return await Promise.all(
      active.map(async (grant) => {
        const client = await ctx.db.get(grant.clientId);
        return {
          grantId: grant._id,
          clientName: client?.name ?? "Unknown client",
          scopes: grant.scopes,
          createdAt: grant.createdAt,
          lastUsedAt: grant.lastUsedAt ?? null,
        };
      }),
    );
  },
});

export const revokeConnection = mutation({
  args: { grantId: v.id("mcpGrants") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.ownerId !== ownerId) throw new Error("Connection not found");
    const now = Date.now();
    await ctx.db.patch(grant._id, { revokedAt: now, updatedAt: now });
    return null;
  },
});

export const defaultScopes = query({
  args: {},
  returns: v.array(v.string()),
  handler: async () => DEFAULT_SCOPES,
});

export type McpGrantDoc = Doc<"mcpGrants">;
