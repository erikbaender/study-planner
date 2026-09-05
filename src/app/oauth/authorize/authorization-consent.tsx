"use client";

import { useMutation, useQuery } from "convex/react";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Button, ButtonRow, Card, Spinner } from "@/ui";

type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  resource: string;
  codeChallenge: string;
  scopes: Array<"planner:read" | "planner:manage" | "planner:destructive">;
  state?: string;
};

function base64url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function digest(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function redirect(request: AuthorizationRequest, values: Record<string, string>) {
  const url = new URL(request.redirectUri);
  for (const [name, value] of Object.entries(values)) url.searchParams.set(name, value);
  if (request.state) url.searchParams.set("state", request.state);
  window.location.assign(url);
}

const SCOPE_COPY: Record<AuthorizationRequest["scopes"][number], string> = {
  "planner:read": "View plans, deadlines, blocks, progress, and change history",
  "planner:manage": "Create and update plans, record progress, and reschedule",
  "planner:destructive": "Delete subordinate planner items",
};

export function AuthorizationConsent({ request }: { request: AuthorizationRequest }) {
  const client = useQuery(api.mcpOAuth.describeAuthorizationRequest, {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    resource: request.resource,
    scopes: request.scopes,
    codeChallenge: request.codeChallenge,
  });
  const authorize = useMutation(api.mcpOAuth.authorize);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (client === undefined) {
    return <main className="flex min-h-screen items-center justify-center bg-content"><Spinner label="Checking authorization request" /></main>;
  }

  const approve = async () => {
    setPending(true);
    setError(null);
    try {
      const raw = new Uint8Array(32);
      crypto.getRandomValues(raw);
      const code = `mcp_code_${base64url(raw)}`;
      await authorize({
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        resource: request.resource,
        issuer: window.location.origin,
        scopes: request.scopes,
        codeChallenge: request.codeChallenge,
        codeDigest: await digest(code),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      redirect(request, { code });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-content px-6 py-12">
      <Card className="w-full max-w-lg p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-control bg-accent-soft text-accent"><ShieldCheck className="size-5" /></span>
          <div>
            <h1 className="text-title font-semibold text-label">Connect {client.clientName}</h1>
            <p className="text-callout text-secondary">Authorize this client to use Study Planner on your behalf.</p>
          </div>
        </div>
        <ul className="mt-5 space-y-2 border-y border-separator py-4">
          {request.scopes.map((scope) => (
            <li key={scope} className="flex gap-2 text-body text-label">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" />
              <span>{SCOPE_COPY[scope]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-callout text-secondary">
          Changes apply directly, are attributed to this connection, and can be reviewed or revoked later. Account deletion and complete data replacement are never available through MCP.
        </p>
        {error ? <p role="alert" className="mt-3 text-body text-negative">{error}</p> : null}
        <ButtonRow className="mt-5 justify-end">
          <Button disabled={pending} onClick={() => redirect(request, { error: "access_denied", error_description: "The user declined the request" })}>Cancel</Button>
          <Button variant="accent" disabled={pending} onClick={() => void approve()}>{pending ? "Connecting…" : "Allow"}</Button>
        </ButtonRow>
      </Card>
    </main>
  );
}
