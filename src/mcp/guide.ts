export const MCP_SERVER_INSTRUCTIONS = `Study Planner manages account-owned semesters (plans). A plan contains courses; courses contain exams and ordered topics; topics contain dependencies and study blocks. IDs returned by tools are opaque. During planner.create or one planner.apply_changes batch, new entities use unique document-local refs so later commands can target them.

Dates are calendar dates in YYYY-MM-DD in the account timezone returned by planner.get. Topic units may be slides, pages, cards, videos, hours, or items. totalUnits=0 means untracked. completedUnits cannot exceed a positive total. Dependencies must stay inside one course and cannot cycle. Priorities are low, normal, or high.

Study blocks are manual or auto. A moved or resized auto block becomes manual. schedule.regenerate uses the deterministic scheduler, replaces only auto blocks in scope, preserves manual blocks, and returns explicit capacity/deadline shortfalls.

Read a plan immediately before writing. Preview major command batches with planner.preview_changes, then call planner.apply_changes with the revision you read and a stable idempotencyKey. A stale revision is rejected with the current revision and intervening summaries; reload, rebase, and retry with a new key. Reusing a successful mutation's key returns its original result.

Routine authorized changes apply directly and are audited. planner.history returns bounded summaries and eligible changes can be reversed with planner.undo. MCP v1 cannot delete accounts, administer credentials or connections, or replace all planner data. Destructive subordinate operations are not exposed in the initial tool surface.`;

export const MCP_GUIDE = `# Study Planner MCP guide

## Hierarchy and references

A plan is shown in the browser as a semester. It owns courses. Each course owns exams and ordered topics. Each topic owns dependency links, progress, and study blocks. Use opaque IDs exactly as returned. For atomic creation, assign each new course, exam, topic, and block a document-local \`ref\` beginning with a letter; later commands in the same document may use that ref where an ID is requested.

## Dates and units

All dates are real \`YYYY-MM-DD\` calendar dates interpreted in the IANA timezone returned by \`planner.get\`; they are never timestamps. Topic units are \`slides\`, \`pages\`, \`cards\`, \`videos\`, \`hours\`, or \`items\`. A total of zero means the size is untracked. Completion is non-negative and may not exceed a positive total.

## Dependencies, priorities, and deadlines

Dependencies connect topics within one course only and must remain acyclic. The scheduler honors dependencies before topic priority. Priority is \`low\`, \`normal\`, or \`high\`. Confirmed exams use one date. A provisional exam may have a date window; its start is the safe scheduling deadline.

## Scheduling

Manual blocks are commitments and are never removed by regeneration. Auto blocks are deterministic scheduler output. Moving or resizing an auto block adopts it as manual. Regeneration fills enabled study days from the supplied \`today\`, observes blackout dates and daily capacity, and reports every deadline shortfall rather than silently dropping work.

## Safe write workflow

1. Call \`planner.get\` and retain its revision.
2. For a major edit, call \`planner.preview_changes\`; preview never writes.
3. Call \`planner.apply_changes\` with the same expected revision and a stable, unique idempotency key.
4. If a revision conflict is returned, fetch again, explain/rebase the intended changes, and retry with a new key.
5. Inspect \`planner.history\` and use \`planner.undo\` for an eligible transaction when recovery is needed.

The default connection scopes are \`planner:read planner:manage\`. No tool authorizes by account ID, email, or owner ID. Account deletion, credential and integration administration, complete data replacement, and background autonomous execution are unavailable through MCP v1. History is limited to 50 entries per page; full snapshots are bounded to 2,000 entities and 500 study-log entries.`;
