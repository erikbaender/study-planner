"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Bot, ChevronLeft, ShieldOff } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Badge, Button, Card, Spinner } from "@/ui";

function formatTime(value: number | null) {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export default function ConnectionsPage() {
  const connections = useQuery(api.mcpOAuth.listConnections);
  const revoke = useMutation(api.mcpOAuth.revokeConnection);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revokeConnection = async (grantId: string) => {
    setPending(grantId);
    setError(null);
    try {
      await revoke({ grantId: grantId as never });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <main className="min-h-screen bg-content px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <Button asChild variant="plain" leadingIcon={<ChevronLeft />}>
          <Link href="/">Back to planner</Link>
        </Button>
        <div className="mt-5 flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-control bg-accent-soft text-accent"><Bot className="size-5" /></span>
          <div>
            <h1 className="text-title font-semibold text-label">Connected agents</h1>
            <p className="mt-1 text-body text-secondary">Review MCP clients that can work with your plans. Revocation takes effect for reads, writes, refreshes, and existing sessions immediately.</p>
          </div>
        </div>

        {error ? <p role="alert" className="mt-4 text-body text-negative">{error}</p> : null}
        {connections === undefined ? (
          <div className="mt-8"><Spinner label="Loading connected agents" /></div>
        ) : connections.length === 0 ? (
          <Card className="mt-6 p-6 text-center">
            <p className="text-body font-medium text-label">No connected agents</p>
            <p className="mt-1 text-callout text-secondary">Connections appear here after you authorize a client through the Study Planner MCP URL.</p>
          </Card>
        ) : (
          <div className="mt-6 space-y-3">
            {connections.map((connection) => (
              <Card key={connection.grantId} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-body font-semibold text-label">{connection.clientName}</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {connection.scopes.map((scope) => <Badge key={scope}>{scope}</Badge>)}
                    </div>
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-callout">
                      <dt className="text-tertiary">Connected</dt><dd className="text-secondary">{formatTime(connection.createdAt)}</dd>
                      <dt className="text-tertiary">Last used</dt><dd className="text-secondary">{formatTime(connection.lastUsedAt)}</dd>
                    </dl>
                  </div>
                  <Button variant="danger" leadingIcon={<ShieldOff />} disabled={pending === connection.grantId} onClick={() => void revokeConnection(connection.grantId)}>
                    {pending === connection.grantId ? "Revoking…" : "Revoke"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-6 text-callout text-secondary">
          See the <Link className="text-accent underline" href="/mcp/privacy">MCP privacy and retention policy</Link> for what is stored and how recovery works.
        </p>
      </div>
    </main>
  );
}
