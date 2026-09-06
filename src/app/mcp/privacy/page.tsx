import Link from "next/link";

export default function McpPrivacyPage() {
  return (
    <main className="min-h-screen bg-content px-6 py-10">
      <article className="mx-auto max-w-2xl text-body text-secondary">
        <h1 className="text-title font-semibold text-label">MCP privacy, retention, and revocation</h1>
        <p className="mt-4">Study Planner&apos;s MCP server processes only tool calls made by a client you explicitly authorize. It does not run a model, execute prompts, or start background work.</p>
        <h2 className="mt-6 text-body font-semibold text-label">Stored connection data</h2>
        <p className="mt-2">The service stores the client name, granted scopes, connection and last-use times, and opaque-token SHA-256 digests. Raw access tokens, refresh tokens, authorization codes, browser sessions, and provider tokens are never stored in planner tables or operational logs.</p>
        <h2 className="mt-6 text-body font-semibold text-label">Planner history and recovery</h2>
        <p className="mt-2">Audit entries retain bounded summaries and affected IDs for 90 days. Narrow recovery data for eligible undo operations is kept separately for 30 days. Arbitrary tool payloads and full notes are not copied into audit logs. Idempotency results are intended for 24-hour retry safety.</p>
        <h2 className="mt-6 text-body font-semibold text-label">Revocation and deletion</h2>
        <p className="mt-2">Revoking a connected agent invalidates its reads, writes, refreshes, and existing MCP requests immediately. Deleting planner data through the web app follows the same account data-deletion behavior; MCP v1 cannot delete an account or replace the complete account dataset.</p>
        <p className="mt-6"><Link className="text-accent underline" href="/connections">Manage connected agents</Link></p>
      </article>
    </main>
  );
}
