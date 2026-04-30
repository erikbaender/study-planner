# Auth Env Recovery

## What changed

- Confirmed `JWT_PRIVATE_KEY` was absent from the Convex dev deployment while the other auth variables were present.
- Generated a fresh RSA signing key pair locally without printing either generated value.
- Set `JWT_PRIVATE_KEY` and refreshed `JWKS` together through `convex env set --from-file --force`, so both values now come from the same key pair.

## Verification

- Verified Convex env names only: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `JWKS`, `JWT_PRIVATE_KEY`, `SITE_URL`.
- Ran `pnpm exec convex dev --once --typecheck disable` successfully; Convex functions are ready.
- Clicked the local `Continue with GitHub` sign-in button and confirmed the flow now reaches GitHub instead of failing on missing Convex Auth keys.
- After adding the callback URL in GitHub, authorized the OAuth app and confirmed the callback returned to `http://localhost:3000/` with the planner rendered in an authenticated session.

## Remaining OAuth App Setting

Resolved. The GitHub OAuth app now accepts this authorization callback URL:

```text
https://proper-elk-932.eu-west-1.convex.site/api/auth/callback/github
```

## Notes

- Avoid using raw `pnpm exec convex env list` output in shared messages because it prints secret values.
- The GitHub OAuth client secret should still be rotated because a previous diagnostic command exposed it in terminal output.