# Quality, performance, maintainability, and security audit

Audit date: 2026-08-20; cloud-only cutover updated 2026-09-04

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
- Configuration tests verify that missing public Convex URLs fail explicitly and never mount the planner.
- Authentication tests cover the signed-out gate, sign-in failure/retry, sign-out, and authenticated repository startup/cleanup. Repository tests cover one provider-owned subscription, every Convex mutation mapping, error recovery, schedule application, and transfer integrity.
- Convex function tests reject unauthenticated access and exercise two-account isolation plus persistence through a second session.

### Estimates and unmeasured outcomes

The browser tracing integration needed for reliable production Core Web Vitals was unavailable. No Lighthouse, CWV, post-refactor production bundle size, or quantified speedup is claimed. Lazy views, one provider-owned subscription, and deferred preview work should reduce rendering work, but their production impact remains an estimate until a production build is profiled on representative hardware. The scaling concerns below are derived from code structure and development fixtures; they are not evidence that a Convex platform limit or a user-visible production threshold has already been reached.

### Final verification

- ESLint and the strict TypeScript check passed.
- All 7 cloud-cutover test files and 23 tests passed. The complete suite passed 457 tests; two pre-existing Today motion assertions, in files unchanged from the default branch, still fail and are recorded rather than attributed to this cutover.
- A fresh `pnpm audit --prod --audit-level=low` registry check reported no known production dependency vulnerabilities.
- Next.js completed an optimized static production build with Turbopack.
- `git diff --check` passed.
- The development service returned HTTP 200 and browser inspection confirmed that missing cloud configuration displays the dedicated actionable error without mounting planner data.
- This worktree had no Convex deployment variables or OAuth credentials, so the real-deployment two-account smoke checklist remains a rollout gate and is not claimed here.

## Findings addressed

### Quality and correctness

- Scheduling now respects dependency order and uses configured horizons for shortfall calculations.
- Inclusive planning-day summaries replace endpoint-only counting.
- `applySchedule` commits generated blocks and the preferences used to calculate them in one Convex mutation transaction.
- Context-menu actions use consistent icon-first, action-only labels.
- Sample datasets are deterministic and date-relative; they consist of the preserved MHH outline and a feature-showcase variant built from it.
- JSON import validates relationships before destructive replacement and preserves study history.
- Transfer v3 replaces database IDs and name-based links with document-local topic keys. Imports append fresh plans and study history without deduplication, while replacement replaces plans and history; both preserve preferences. Unambiguous v2 documents remain read-only migration inputs.

### Performance

- React owns one repository subscription instead of repeated consumers installing their own.
- Closed planning sheets no longer run the scheduling engine on every render.
- Timeline and Outline are separate lazy client chunks.
- Startup fails explicitly when Convex configuration is missing. With configuration present, protected queries are not created until authentication succeeds.
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
3. **Complete the deployment smoke test.** Exercise two real accounts, two browser sessions, export/import, provider revocation, account loss, and Convex restore procedures against the non-production deployment before rollout.

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

`convex/planner.ts`, `src/features/outline/outline-view.tsx`, and the timeline interaction modules remain large. Further decomposition should follow stable responsibilities—query assembly, mutation families, gesture state, or row rendering—and retain end-to-end behavior tests. Line count alone is not a reason to split tightly coupled logic.

## Google SSO decision

Google must launch as a separate provider-bound identity with `allowDangerousEmailAccountLinking: false`. Matching an OAuth email is not sufficient evidence to merge accounts. If linking is later offered, it must start from an authenticated account, require fresh authentication to both providers, disclose both data sets, detect an already-linked or already-existing destination identity, and perform a previewable, recoverable merge with explicit conflict rules. See [authentication.md](authentication.md).
