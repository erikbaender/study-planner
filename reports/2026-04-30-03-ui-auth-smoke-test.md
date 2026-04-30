# Progress Report 03: UI, Auth Scaffold, and Browser Smoke Test

Date: 2026-04-30

## Summary
The first usable Study Planner prototype is running locally and has passed lint, typecheck, production build, Convex push, and browser smoke testing.

## Completed
- Added Convex Auth scaffolding:
  - `convex/auth.ts`
  - `convex/auth.config.ts`
  - `convex/http.ts`
  - client-side Convex provider wrapper
- Set Convex `SITE_URL` for local development to `http://localhost:3000`.
- Added GitHub as the configured OAuth provider in Convex Auth.
- Kept a local development-mode login fallback while OAuth credentials are incomplete.
- Verified the planner UI in the browser after auth provider setup.
- Verified Gantt bars render.
- Verified drag-to-move updates a study range label and inspector state.
- Fixed Gantt overflow containment for mobile-style layouts.
- Updated README with setup, verification, Convex, OAuth, and report instructions.

## Verification Run
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm build` passed.
- `pnpm exec convex dev --once --typecheck disable` passed.
- Browser smoke test confirmed five sample Gantt bars render.
- Browser drag smoke test moved a range from `May 18 - May 25` to `May 20 - May 27`.

## Remaining Blocker
Real GitHub OAuth cannot be fully completed until GitHub OAuth app credentials are available and configured in Convex:

- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- Convex Auth JWT variables: `JWT_PRIVATE_KEY` and `JWKS`

The callback URL should be:

```text
<NEXT_PUBLIC_CONVEX_SITE_URL>/api/auth/callback/github
```

## Next
- Configure the missing OAuth/JWT environment variables.
- Replace local planner state with Convex queries and mutations.
- Expand CRUD editing and deletion flows.
- Improve GitHub import with a preview step and clearer handling for inferred date ranges.
