# Remote MCP integration

Study Planner exposes a provider- and harness-independent remote MCP resource at:

```text
https://<app-origin>/mcp
```

Clients discover RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`, then RFC 8414 authorization-server metadata at `/.well-known/oauth-authorization-server`. Public clients can dynamically register at `/oauth/register`; authorization uses `/oauth/authorize`, `/oauth/token`, and `/oauth/revoke` with Authorization Code + PKCE S256 and a required `resource` parameter.

## Required deployment configuration

```dotenv
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
MCP_ISSUER=https://your-app.example
MCP_ALLOWED_ORIGINS=https://an-explicit-browser-client.example
```

`MCP_ISSUER` is the exact public origin, without a path. Native clients normally omit `Origin`. Browser clients must use the app origin or appear in the comma-separated allowlist. Configure separate values and Convex deployments for development, previews, and production.

The default grant is `planner:read planner:manage`. `planner:destructive` exists for future accurately-annotated subordinate deletion tools, but the v1 tool surface does not expose deletion. Account deletion, credential/integration administration, and complete replacement are never exposed.

## Shared writes and recovery

Preview runs the same sequential command evaluator as apply against a read-only, copy-on-write store. Browser operations represented by MCP commands use that evaluator too; browser-only operations remain revision-checked transactions. Browser saves carry the revisions from the displayed snapshot, so intervening agent edits produce conflicts instead of being overwritten. Account scheduling preference changes advance every affected plan revision.

Undo is limited to the latest eligible transaction, with no intervening edits. Field-update inverses retain only the changed fields. Use a new command batch to revise older changes. PKCE verification occurs inside the public Convex token-exchange mutation, which requires and hashes the actual code verifier.

## Verification

Use MCP Inspector against the non-production `/mcp` URL and complete the browser flow. Verify initialization and the guide resource, then exercise `planner.list`, `planner.get`, preview/apply with a stale-revision conflict and idempotent retry, history/undo, progress, and a complete multi-course create. Repeat the same advertised tool surface in Codex and one non-OpenAI client. In the browser, verify reactive edits, manual-block preservation during regeneration, and immediate failure after revoking the connection from **Connected agents**.

Operational logs contain request ID, tool name, grant ID, duration, result class, and affected-count metadata only. They must never include bearer tokens or tool payloads.
