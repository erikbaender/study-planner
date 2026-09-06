# ADR 0001: Host OAuth and MCP with the existing Next.js and Convex application

- Status: accepted
- Date: 2026-09-05

## Context

Study Planner already deploys its browser application on a serverless Next.js host and keeps authenticated planner data in Convex. The MCP protected resource needs one stable HTTPS URL, standard browser OAuth, transactional planner operations, and no request-time admin/deploy credential.

## Decision

The public OAuth metadata, registration, token, revocation, and `/mcp` Streamable HTTP endpoints are Next.js route handlers on the existing application origin. `/oauth/authorize` is a normal authenticated browser page. The MCP endpoint uses the official TypeScript SDK in stateless JSON-response mode, which fits the existing serverless runtime and does not introduce session affinity.

OAuth clients, grants, one-use authorization-code digests, opaque-token digests, rate windows, idempotency records, audits, and undo records live in normalized Convex tables. Raw authorization codes and access/refresh tokens are generated at the HTTPS/browser edge and never stored. Authorization uses Code + PKCE S256, exact registered redirects, the OAuth `resource` parameter, 15-minute access tokens, and rotating 30-day refresh tokens.

The authenticated consent mutation calls `getAuthUserId`, so the OAuth subject maps exclusively to the same Convex `users` row used by the browser. MCP tool arguments never accept an owner or account ID. On every tool request, a SHA-256 token digest is resolved inside Convex to an unrevoked grant and owner; issuer, audience, expiry, and scopes are checked again at the transaction boundary.

The Next.js adapter invokes ordinary narrowly-scoped public Convex functions with a token digest. Those functions can do nothing without a valid stored token/grant and resolve the owner internally. No Convex deploy key, admin token, GitHub token, or browser session token is present in request handling. Planner writes go through the shared `plannerApplication` command service and normalized tables, not direct route-handler writes.

## Consequences

- The MCP resource URL and authorization issuer share one deployment lifecycle and origin.
- Development, preview, and production need separate Convex deployments, OAuth issuer URLs, GitHub OAuth apps, and data.
- Revoking a grant immediately blocks access validation and refresh, independent of token expiry.
- Stateless transport does not provide resumable MCP sessions/tasks; current planner operations are bounded Convex transactions and do not need them.
- `MCP_ISSUER` must be the exact externally visible origin in production so Host, issuer, audience, metadata, and challenges agree.

## Rejected alternatives

- A separate stateful MCP platform duplicated operations and credentials without a current need.
- API keys could not provide standards-based browser consent, audience binding, client identity, scoped revocation, or refresh rotation.
- Passing GitHub or Convex browser tokens through to MCP would couple clients to an identity provider and broaden token authority.
