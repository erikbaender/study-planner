# Quality, performance, maintainability, and security audit

Audit date: 2026-08-20

## Executive summary

The project had a sound domain direction and consistent Convex ownership checks, but its release posture lagged behind its product code. The audit found stale private reports and sample provenance, vulnerable production dependencies, name-based import collisions, weak server-side semantic bounds, repeated subscriptions and mapping work, eager scheduling in closed UI, large feature modules, inaccessible custom interactions, and outdated contributor documentation.

This refactor addresses the highest-confidence issues without rewriting the interaction-heavy timeline. The remaining material risks are recorded below rather than hidden behind a blanket quality score.

## Evidence and limits

### Observed baseline measurements

The following values were captured before the refactor in the development environment described by this repository. They are historical comparison points, not current production metrics:

- Baseline verification: 32 test files and 432 tests passed; ESLint and TypeScript passed.
- Baseline production dependency audit: 35 advisories, including 1 critical and 18 high.
- Runtime inspection used the deterministic full sample: 10 courses and 344 topics overall; the inspected focused view contained 7 courses, 91 topics, 60 blocks, and 192 study-log records.
- Development DOM samples were approximately 615 nodes for Today, 1,844 for Timeline, and 2,451 for Outline.
- Development decoded JavaScript was approximately 8.3 MB; Zod accounted for roughly 1.06 MB and Convex for 596 KB before chunking work.
- Development view switches produced long tasks up to roughly 626 ms. These are diagnostic development measurements, not production Core Web Vitals.

### Verified post-refactor facts

- `pnpm audit --prod` reported zero known advisories after dependency upgrades. This is a point-in-time result from the package advisory database, not proof that the dependency tree is vulnerability-free.
- Static import-graph regression coverage verifies that the local-only provider graph contains neither `convex/react` nor `@convex-dev/auth`; the configured stack is reached through a dynamic import.
- Repository tests cover one provider-owned subscription, serialized local mutations, IndexedDB transaction completion, schedule application, transfer integrity, and configured/local provider selection.
- The transfer writer emits v3, the reader accepts v3 and safely migrates unambiguous v2, and both repository implementations reconstruct document-local topic references with fresh IDs.

### Estimates and unmeasured outcomes

The browser tracing integration needed for reliable production Core Web Vitals was unavailable. No Lighthouse, CWV, post-refactor production bundle size, or quantified speedup is claimed. Lazy views, the local-only Convex boundary, fewer subscriptions, and deferred preview work should reduce startup or rendering work, but their production impact remains an estimate until a production build is profiled on representative hardware. The scaling concerns below are derived from code structure and development fixtures; they are not evidence that a Convex platform limit or a user-visible production threshold has already been reached.

### Final verification

- ESLint and the strict TypeScript check passed.
- All 43 test files and 502 tests passed.
- A fresh `pnpm audit --prod --audit-level=low` registry check reported zero advisories across 221 production dependencies.
- Next.js completed an optimized static production compilation through its supported webpack path. The harness prohibited Turbopack's internal CSS-worker socket, so this environment could not validate the default Turbopack build path; that restriction is not presented as an application result.
- `git diff --check` passed.
- The development service returned HTTP 200 with the documented security headers before its final generated-cache refresh. The external browser/tool allowance was exhausted immediately after that restart, so a post-refresh interactive browser pass is not claimed.

## Findings addressed

### Quality and correctness

- Scheduling now respects dependency order and uses configured horizons for shortfall calculations.
- Inclusive planning-day summaries replace endpoint-only counting.
- `applySchedule` commits generated blocks and the preferences used to calculate them together: one serialized snapshot commit locally and one Convex mutation transaction when synced.
- Context-menu actions use consistent icon-first, action-only labels.
- Sample datasets are deterministic, synthetic, and free of private-project provenance.
- Local persistence serializes concurrent mutations and resolves a save only when the IndexedDB transaction completes, not when its object-store request first succeeds. A failed or aborted transaction is not published to React.
- JSON import validates relationships before destructive replacement and preserves study history.
- Transfer v3 replaces database IDs and name-based links with document-local topic keys. Imports append fresh plans and study history without deduplication, while replacement replaces plans and history; both preserve preferences. Unambiguous v2 documents remain read-only migration inputs.

### Performance

- React owns one repository subscription instead of repeated consumers installing their own.
- Closed planning sheets no longer run the scheduling engine on every render.
- Timeline and Outline are separate lazy client chunks.
- Local-only startup neither constructs a Convex client nor statically pulls Convex React/Auth into its provider graph; the complete configured sync stack is a separate lazy client chunk.
- Convex-to-domain translation reuses unchanged source-derived values where possible.
- The remote Google font dependency was removed in favor of a local system stack, eliminating a build-time network dependency.

### Maintainability

- Authentication UI consumes a provider-neutral facade and registry.
- Repository state, actions, and errors are separated into narrow contexts.
- Topic creation and bulk-paste behavior moved out of the oversized Outline component into a cohesive feature module.
- Shared planning preview and summary logic is pure and directly tested.
- Package metadata, deterministic scripts, CI least-privilege settings, and dependency update automation were added.
- Contributor, architecture, authentication, transfer-format, security, and audit documentation now describe the implemented system.

### Security

- Production dependencies were upgraded until the package audit reported zero known advisories.
- Convex functions retain server-side ownership checks and now validate real dates, finite bounded numbers, text and collection sizes, progress invariants, complete reorders, dependency references, and cycles.
- Every planner function has an explicit return validator.
- OAuth automatic email account linking is disabled in preparation for a future Google provider.
- Response headers add a content security policy, clickjacking protection, MIME sniffing protection, a permissions policy, referrer controls, origin isolation, and production HSTS.
- Import files have a size limit and a versioned format with document-local references.
- Historical internal reports and a private-project-derived sample were removed from the working tree.

## Residual risks and next work

### Before public release

1. **Choose and add a license.** No `LICENSE` or equivalent file exists. Source visibility alone grants no clear reuse or redistribution rights, so this remains an open-source publication blocker.
2. **Rotate historical credentials.** Historical project material indicates that an OAuth client secret may once have been exposed. A targeted scan found no credential-shaped value in the current working tree, but deletion is not revocation and rotation cannot be verified from source. Revoke and replace the credential before publication, then inspect Git history with an approved secret scanner. This remains a release blocker until a maintainer verifies it externally.
3. **Define local-to-account migration.** Signing in currently switches stores. A deliberate preview/merge/replace workflow is required before advertising seamless sync.
4. **Exercise recovery.** Test export, import, provider revocation, account loss, and Convex restore procedures with production-like configuration.

### Performance backlog

1. **No row virtualization:** Outline and Timeline still render every visible row. The development DOM counts above show the shape of the current fixture, but no production break-even point has been measured. Add windowing before targeting datasets materially larger than the 344-topic fixture, and preserve keyboard focus, drag geometry, and accessible row counts when doing so.
2. **Convex query fan-out:** `listPlanTrees` is one reactive client subscription, but its server function performs one plans collection read, one courses read per plan, exams and topics reads per course, and one study-blocks read per topic (`1 + P + 2C + T`). All are index-backed; the risk is growing read volume and recomputation, not an observed full-table scan. Measure production query limits and cache behavior before choosing a batched or denormalized read model.
3. Profile a production build on representative hardware and establish budgets for initial JavaScript, view-switch latency, DOM nodes, and long tasks.
4. Narrow broad workspace-store subscriptions in hot timeline components if production profiling shows avoidable rerenders.

### Security backlog

1. **Script-readable auth tokens:** Convex Auth's current browser token storage uses `localStorage`. Keep third-party script count at zero, tighten CSP toward nonces or hashes when Next.js deployment support is selected, and reassess server-managed or HttpOnly-cookie sessions before higher-risk use. CSP reduces injection opportunities; it does not prevent an executing same-origin script from reading the token.
2. The CSP permits inline styles, and Next.js/the pre-paint theme path currently require inline script handling. Treat this as a documented compatibility tradeoff, not a complete XSS defense.
3. Add rate/abuse monitoring around authenticated mutations at deployment scale; semantic limits bound a call but do not replace platform-level rate controls.
4. Review data deletion and retention semantics before accepting real user accounts.

### Maintainability backlog

`convex/planner.ts`, `src/features/outline/outline-view.tsx`, `src/data/local-repository.ts`, and the timeline interaction modules remain large. Further decomposition should follow stable responsibilities—query assembly, mutation families, gesture state, or row rendering—and retain end-to-end behavior tests. Line count alone is not a reason to split tightly coupled logic.

## Google SSO decision

Google must launch as a separate provider-bound identity with `allowDangerousEmailAccountLinking: false`. Matching an OAuth email is not sufficient evidence to merge accounts. If linking is later offered, it must start from an authenticated account, require fresh authentication to both providers, disclose both data sets, detect an already-linked or already-existing destination identity, and perform a previewable, recoverable merge with explicit conflict rules. Local-to-synced migration requires separate user consent and must not be inferred from sign-in. See [authentication.md](authentication.md).
