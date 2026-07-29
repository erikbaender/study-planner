# OneDrive permission spike

Date: 2026-07-30

Branch: `feature/onedrive-permission-spike`

Base: `redesign/planner-ux-overhaul` at `e5bbbc2`

## Outcome

Implemented a browser-only Microsoft account permission probe on top of the
committed UX-overhaul branch. It supports the concrete feasibility test needed
before building topic attachments:

- work/school and personal account selection through the multitenant `common`
  authority;
- delegated `Files.Read` only;
- `/me/drive` as the permission/provisioning probe;
- root-folder browsing, nested-folder navigation, and OneDrive search;
- opening Graph-provided `driveItem.webUrl` links in a new browser tab;
- visible Microsoft/Graph diagnostic details when consent or access fails;
- no file download, sharing-link creation, write scope, or backend token
  persistence.

The UI is exposed as **OneDrive test** in the planner toolbar.

## Configuration

The implementation requires a multitenant Microsoft Entra SPA registration and
the public client ID in `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`. Exact setup and result
interpretation are documented in `docs/onedrive-permission-spike.md`.

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test -- --run` — 13 files, 219 tests passed
- `pnpm build` — production bundle and static generation passed
- temporary dev-server request — `/` returned HTTP 200 with the rendered app

The feature tests cover successful `Files.Read` confirmation and browser-link
rendering, preservation of the `AADSTS90094` diagnostic, and missing app
registration guidance.

The repository's prescribed `agent-browser` visual check could not run because
that executable is not installed in this environment. Port 3000 was also in use
by the UX-overhaul agent's live server, so the non-disruptive runtime check used
port 3001 temporarily and shut it down immediately afterward.

## Workflow exception

A GitHub issue and Study Planner Project item could not be created because the
available GitHub CLI credential is invalid, the connected GitHub integration
cannot access this private repository, and no `PROJECTS_ACCESS` token is
available. The work remains isolated on the requested local feature branch.

## Deliberate next-step boundary

This spike does not modify the topic data model or persist chosen file IDs.
Those changes should follow only after the real university account test
confirms that the target tenant permits the intended authorization flow.
