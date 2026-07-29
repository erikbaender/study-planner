# OneDrive permission spike

This branch contains a deliberately small Microsoft Graph integration. It signs
in a work/school or personal Microsoft account, requests delegated
`Files.Read`, calls `/me/drive`, lists/searches files, and opens the
Microsoft-provided `webUrl` in a new browser tab.

It does not download file contents, create sharing links, request write access,
or persist links on topics yet. Its purpose is to test whether an actual
university tenant lets the signed-in student consent to the permission that the
planned feature needs.

## 1. Register the test application

The registration must be owned by a Microsoft Entra tenant you control. Do not
register it inside the university tenant unless that is how the eventual app
will be distributed; a same-tenant registration would not be a representative
test of an external study-planner app.

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Go to **Entra ID → App registrations → New registration**.
3. Give the application a name such as `Study Planner OneDrive Test`.
4. For **Supported account types**, select **Accounts in any organizational
   directory and personal Microsoft accounts**.
5. Register the application and copy its **Application (client) ID**.
6. Under **Authentication**, add the **Single-page application** platform with
   this redirect URI:

   ```text
   http://localhost:3000
   ```

7. Under **API permissions**, add **Microsoft Graph → Delegated permissions →
   Files.Read**. Do not add `Files.Read.All`, a write permission, or an
   application permission. Do not click **Grant admin consent**: the point of
   this test is to discover whether the student can consent without an admin.

No client secret is needed or safe in this browser application. MSAL Browser
uses the authorization-code flow with PKCE for the SPA.

Microsoft's references:

- [Register a Microsoft identity platform application](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)
- [MSAL Browser](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/about-msal-browser)
- [Microsoft Graph `Files.Read` permission](https://learn.microsoft.com/en-us/graph/permissions-reference#filesread)

## 2. Configure and run the branch

Create `.env.local` in the repository root:

```dotenv
NEXT_PUBLIC_MICROSOFT_CLIENT_ID=<the-application-client-id>
```

Then restart the app:

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>, choose **OneDrive test**, then **Connect Microsoft
account**. Select the university account even if another Microsoft account is
already signed in.

## 3. Interpret the result

- **Read permission confirmed** plus a list of files: the university tenant
  allowed this app to receive delegated `Files.Read`. The pure-web approach is
  technically viable for this account under the app's current publisher state.
- **Need admin approval**, `AADSTS90094`, or `AADSTS90095`: this tenant does not
  let this user consent to the app as registered. If requiring a university
  administrator is a hard non-starter, this registration state is not viable
  for that university.
- **AADSTS900941**: Microsoft classified the app as risky. This often affects an
  unverified multitenant test app. It proves this unverified registration is
  blocked, but does not establish that a publisher-verified production app
  would also be blocked.
- **AADSTS65004**: consent was declined by the person using the prompt; retry
  and accept if that was accidental.
- A successful sign-in followed by a Graph `404`/drive-not-found error usually
  means OneDrive has not been provisioned for that account, which is distinct
  from a consent-policy denial.

Microsoft documents `Files.Read` as not inherently requiring administrator
consent. Tenant administrators can still disable user consent or limit it to
verified publishers and selected permissions, so the real account test is the
reliable check:

- [Configure user consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)
- [Troubleshoot consent issues](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/troubleshoot-consent-issues)

## Security characteristics of this spike

- The browser asks Microsoft directly for a delegated token.
- The token can access only what the signed-in account can access under the
  granted scope.
- MSAL stores its cache in `sessionStorage`; no Microsoft token is sent to the
  planner's Convex backend.
- File links come from Graph's `driveItem.webUrl` and open on Microsoft's
  OneDrive/SharePoint host.
- Closing the tab clears the session-scoped MSAL cache. The user's consent grant
  remains in the tenant until the user or tenant administrator revokes it.
