# OneDrive integration feasibility

Date: 2026-07-30
Scope: `redesign/planner-ux-overhaul` at `e5bbbc2`, including the other agent's
in-progress working tree
Priority: Microsoft work/school accounts and OneDrive for Business first;
personal Microsoft accounts also supported

## Executive conclusion

OneDrive integration is realistic in the existing web app for Microsoft Entra
tenants that allow end-user consent to delegated `Files.Read`. An Electron
rewrite is not needed for those tenants.

It is **not possible to guarantee** that a Graph-based integration works in
every university tenant without university involvement. Tenant administrators
can disable or restrict user consent for all third-party applications. If
"every managed student account must work and no university may ever approve
the app" is a hard requirement, automatic Graph browsing is not feasible as the
only integration path. The product then needs manual browser-link entry or a
Windows desktop/local-sync path.

The recommended product is:

1. Keep the planner as a web app.
2. Treat Microsoft authorization as a separate connection from the planner's
   existing GitHub/Convex sign-in.
3. Use delegated Microsoft Graph access with the least-privileged
   `Files.Read` permission.
4. Let the user select one or more files for a topic.
5. Store the OneDrive `driveId`, `itemId`, display metadata, and `webUrl`, but
   never the file content or a temporary download URL.
6. Open the stored `webUrl` in a new browser tab. Microsoft then enforces the
   user's existing file permissions and asks them to sign in again if needed.
7. Provide a manual HTTPS-link fallback for university tenants that block
   third-party app consent.

This supports presentations, PDFs, Office documents, and videos equally because
the planner stores links to Microsoft Graph `driveItem` objects rather than
handling their content.

The main feasibility risk is institutional policy, not browser capability.
Microsoft marks delegated `Files.Read` as not requiring administrator consent,
but a university can still disable or restrict user consent. A broadly
distributed multitenant app should also become a verified publisher; otherwise
many managed tenants will block or distrust its consent prompt.

## Fit with the UX overhaul

The assessment is based on the redesign branch rather than `main`.

The branch has already introduced the boundaries this feature needs:

- storage-independent domain types in `src/domain/`;
- one `PlannerRepository` interface with local IndexedDB and Convex
  implementations;
- a workload-oriented `Topic` model;
- JSON portability;
- a Radix-based design system;
- an inspector planned for phase 3 of the redesign.

The natural UI is a **Resources** section in the topic inspector. A topic can
have several resources, each with an icon/type, name, and Open action, plus a
`Link from OneDrive` button. This should be built against the planned inspector,
not bolted into the temporary phase-2 shell.

The resource persistence work can be developed independently, but the final UI
should follow the phase-3 inspector so the two agents do not build competing
topic-detail surfaces.

## Recommended web architecture

### Microsoft application registration

Register a Microsoft Entra application with the
`AzureADandPersonalMicrosoftAccount` audience. This covers:

- any Microsoft Entra organization, including university work/school tenants;
- personal Microsoft accounts.

Use MSAL Browser's authorization-code flow with PKCE. The public-cloud
`common` authority supports both audiences. If personal accounts were removed
from scope, `organizations` would restrict sign-in to work/school accounts.

Request delegated `Files.Read` for the MVP. Do not request write permissions.
Do not use application permissions: the planner acts only on behalf of the
signed-in student.

There are two sensible token designs:

1. **MVP: browser-managed MSAL connection.** MSAL obtains and refreshes the
   Graph token in the browser. The backend stores only resource metadata. This
   is the smallest security surface and works in both local and Convex planner
   modes. On a new device the user may need to reconnect Microsoft before
   adding or refreshing links, but existing `webUrl` links still open.
2. **Later: server-managed OAuth connection.** A Next.js route handler or
   dedicated Convex HTTP flow exchanges the code and stores an encrypted
   refresh token in a server-only connection table. This gives durable
   cross-device linking and server-side link health checks, but adds a token
   vault, revocation, encryption/key rotation, CSRF/state handling, and more
   operational responsibility.

The first design is sufficient for the requested behavior. The second should be
added only if persistent cross-device Microsoft connection or background
validation becomes a requirement.

### Do not reuse Convex Auth's provider token

The app currently uses GitHub through `@convex-dev/auth`. Adding Microsoft as an
additional sign-in provider could be useful eventually, especially for the
student audience, but it does not by itself solve Graph access.

The installed Convex Auth implementation creates/links an `authAccounts`
record, then discards the provider's Graph access and refresh tokens after the
OAuth callback. Its stored refresh tokens are planner-session tokens, not
Microsoft Graph refresh tokens.

Microsoft identity and OneDrive authorization should therefore be separate
concerns for the MVP. This also avoids accidentally switching a GitHub-signed
planner user to a second planner account merely because they connected a
university Microsoft account.

### Selecting files

There are two web picker options.

#### Preferred MVP: a small Graph-backed picker

Build a Radix dialog that:

- lists `GET /me/drive/root/children`;
- navigates folders through
  `GET /drives/{driveId}/items/{itemId}/children`;
- searches with
  `GET /me/drive/root/search(q='{text}')`;
- supports multi-select;
- requests only fields needed by the planner.

This is a modest amount of UI because the app only needs selection, not upload,
editing, preview, or file management. It also gives exact control over the
permission scope and error states.

Start with the user's default OneDrive for Business. Teams channel files and
arbitrary SharePoint libraries should be a separate expansion because they can
require broader discovery and consent scopes. A student with no provisioned or
licensed OneDrive can receive a clear unsupported-account message from
`GET /me/drive`.

#### Alternative: Microsoft File Picker v8

Microsoft's hosted picker can run in a popup or iframe and returns the selected
item ID and parent drive ID. It is attractive for a native Microsoft 365
browsing experience.

It deserves a short spike, not an immediate dependency:

- the picker uses tenant-specific SharePoint/OneDrive URLs and a postMessage
  token protocol;
- Microsoft's setup example asks for broad Graph and SharePoint permissions,
  while the permissions table also says `Graph.Files.Read` is sufficient for a
  OneDrive read flow;
- broader requested scopes are more likely to trigger university admin review;
- the personal picker uses a different authority, token resource, and base URL
  from OneDrive for Business, so combined account coverage needs an independent
  test even though the underlying stored resource model is the same.

For an organization-first product the hosted picker may work well, but it
should be accepted only if it works with `Files.Read` in a representative
managed student tenant. Otherwise the custom Graph picker is both safer and
simpler.

### Durable linking and click behavior

Store the OneDrive identifiers, not a filesystem path:

```ts
type StudyResource = {
  id: EntityId;
  topicId: EntityId;
  provider: "onedrive" | "url";
  name: string;
  driveId?: string;
  itemId?: string;
  tenantId?: string;
  webUrl: string;
  mimeType?: string;
  size?: number;
  order: number;
};
```

For OneDrive resources, `driveId + itemId` is the canonical durable reference.
Microsoft documents that a drive item's ID survives moves and renames. Store
the returned `webUrl` as the immediate launch target; it is explicitly the URL
that displays the resource in a browser.

Clicking a resource can immediately use:

```text
window.open(webUrl, "_blank", "noopener,noreferrer")
```

No Graph token is needed merely to follow that URL. Microsoft enforces the
user's permissions in the destination tab.

When a Microsoft connection is available, the app can periodically resolve
`GET /drives/{driveId}/items/{itemId}` to refresh the name and `webUrl` and to
detect a deleted or inaccessible resource. It should not delay every click on a
Graph round trip.

Never store `@microsoft.graph.downloadUrl`: Microsoft describes it as
short-lived and unauthenticated. Never call `createLink` for this feature:
creating a sharing link changes file-sharing state, asks for unnecessary write
access, and is not needed to open a file the student already has permission to
view.

### Changes required in this codebase

The redesign makes these changes straightforward:

- Add `StudyResource` to the domain model and `resources` to `Topic`.
- Add a Convex `resources` table indexed by `topicId`.
- Add create, delete, reorder, and optional refresh methods to
  `PlannerRepository`.
- Implement the methods in both `local-repository.ts` and
  `convex-repository.ts`.
- Join resources in `listPlanTrees` and cascade-delete them with their topic.
- Apply the existing ownership chain
  `resource → topic → course → plan → owner` on every server mutation.
- Add resources to JSON import/export and increment the export version.
- Never include Microsoft access or refresh tokens in `PlannerSnapshot`, local
  export files, or client-visible Convex queries.
- Add the Resources inspector section and a picker dialog after the phase-3
  shell lands.

Manual links should use the same `StudyResource` type with `provider: "url"`.
Accept HTTPS only and always open external URLs with `noopener,noreferrer`.

## Organization-managed account constraints

Work/school accounts are fully supported by Microsoft Graph and MSAL. The
constraints are administrative:

- A multitenant Entra registration is required for students from different
  universities.
- A tenant may disable user consent even though `Files.Read` is normally
  user-consentable.
- Many tenants allow only verified publishers and permissions classified as
  low impact.
- Some tenants require users to be explicitly assigned to an enterprise app.
- Conditional Access may require MFA, a compliant device, or another claims
  challenge.
- A student without a OneDrive license/default drive cannot use the picker.
- Sovereign/national Microsoft clouds need separate endpoint and registration
  planning and should be out of the initial public-cloud MVP.

The app needs first-class states for:

- connected;
- connection expired, reconnect;
- admin approval required, with instructions/request path;
- no OneDrive provisioned;
- resource removed or access revoked.

A verified publisher is an adoption requirement for a product intended to work
across unrelated universities, not merely a consent-screen polish item.
Microsoft's risk-based consent protections can block users from consenting to
new, unverified multitenant apps that request more than basic sign-in/profile
permissions.

The manual-link fallback is important. It gives students in locked-down tenants
a usable, if less convenient, path without asking the planner for Graph access.

### Does every university have to approve the app?

No. `Files.Read` is a delegated permission with
`AdminConsentRequired: No`. Under Microsoft's current managed consent policy,
end users can consent to user-consentable delegated permissions except a
specific group of broad permissions including `Files.Read.All` and
`Files.ReadWrite.All`. The narrower `Files.Read` scope is not in that excluded
group.

There are still two reasons a particular student can see "Need admin approval":

1. A new multitenant application that is not publisher verified can be stepped
   up to admin approval by Microsoft's risk-based consent protection.
2. The university can choose a stricter policy, disable user consent entirely,
   require app assignment, or classify `Files.Read` outside the permissions its
   students may approve.

Publisher verification can address the first reason. Nothing implemented by
the planner can override the second.

Consequently:

- **Feasible:** the product may support tenants that permit self-consent and
  provide a manual-link fallback for locked tenants.
- **Not universally feasible:** automatic OneDrive browsing must work for every
  university account without any possible administrator action.

## Electron/local OneDrive alternative

An Electron wrapper using the Windows OneDrive sync folder is technically
possible:

1. Ask the user to choose one or more OneDrive sync roots with a native folder
   dialog.
2. Store a root identifier plus a relative file path for each resource.
3. Open the file with Electron's `shell.openPath`, which delegates to the
   default Windows application.
4. OneDrive Files On-Demand downloads an online-only placeholder when it is
   opened and the device is online.

It is still the weaker product architecture:

- Windows-only rather than web, macOS, and mobile.
- Requires the OneDrive sync client to be installed, configured, and allowed by
  the university.
- Only sees content exposed in synchronized roots.
- Local paths break on rename/move and do not survive another computer's
  different root names or account layout.
- Multiple personal, university, and guest accounts create root ambiguity.
- Links stored in Convex become machine-specific.
- It cannot naturally turn a local path into the browser `webUrl`.
- Electron adds packaging, code signing, updates, native IPC, and a materially
  larger security surface.
- Managed university devices may block installing the Electron app even when
  OneDrive sync itself is permitted.

Electron's one advantage is that it can avoid Microsoft Graph consent when the
student already has the file synchronized locally. That makes it a possible
special-purpose fallback for a known Windows-only deployment, not the primary
solution for this planner.

## Feasibility comparison

| Criterion | Web + Graph | Electron + local sync |
|---|---|---|
| Organization OneDrive | Strong, subject to tenant consent | Only synchronized roots |
| Personal OneDrive | Strong | Only configured local account |
| Opens requested target | Browser `webUrl` | Local default application |
| Move/rename resilience | Strong with drive/item IDs | Weak with paths |
| Cross-device | Strong for stored links | Weak |
| Mobile/macOS | Yes | No |
| Admin-policy risk | Graph app may need approval | App install/sync may be blocked |
| Security/operations | Moderate | Higher |
| Product recommendation | **Primary** | Contingency only |

## Delivery estimate

For a polished organization-first web MVP:

- Entra registration and real-tenant spike: 2–3 engineering days;
- resource domain/schema/repositories/import-export: 2–3 days;
- custom Graph picker and Microsoft connection UI: 3–5 days;
- topic inspector integration, tests, and failure states: 2–4 days.

Total: approximately **9–15 engineering days**, plus external time for
publisher verification or university admin approval.

A durable server-side token vault and broader Teams/SharePoint library browsing
would add roughly another week. A production Electron route would likely take
3–5 weeks once Windows packaging, signing, updater, filesystem edge cases, and
managed-device testing are included.

## Required spike before implementation

Use at least one real managed student account, one developer/test Entra tenant,
and one personal Microsoft account.

The spike should prove:

1. Combined work/school and personal app registration.
2. `Files.Read` consent in an ordinary tenant.
3. A useful admin-approval error in a restricted tenant.
4. Browse, search, and multi-select in the default OneDrive.
5. Link a PDF, slide deck, Office document, and video.
6. Open each `webUrl` in a new tab without proxying file bytes.
7. Retain the link after a file rename and move by resolving its IDs.
8. Detect deleted/revoked resources.
9. Persist links in local and Convex modes and round-trip them through JSON.
10. Decide whether File Picker v8 can be used with the accepted least-privilege
    scope; fall back to the custom picker if not.

## Official sources

- [Microsoft account types and multitenant app audiences](https://learn.microsoft.com/en-us/entra/identity-platform/howto-modify-supported-accounts)
- [MSAL Browser and authorization code with PKCE](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/about-msal-browser)
- [Microsoft Graph OneDrive permission scopes](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/permissions_reference?view=odsp-graph-online)
- [Get a user's OneDrive](https://learn.microsoft.com/en-us/graph/api/drive-get?view=graph-rest-1.0)
- [Microsoft Graph driveItem and `webUrl`](https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0)
- [Durable ID-based OneDrive addressing](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/addressing-driveitems?view=odsp-graph-online)
- [OneDrive File Picker v8](https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/?view=odsp-graph-online)
- [Microsoft Entra user-consent controls](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)
- [Microsoft-managed app consent policy](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies)
- [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)
- [OneDrive Files On-Demand](https://support.microsoft.com/en-us/office/save-disk-space-with-onedrive-files-on-demand-for-windows-0e6860d3-d9f3-4971-b321-7092438fb38e)
- [Electron `shell.openPath`](https://www.electronjs.org/docs/latest/api/shell)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
