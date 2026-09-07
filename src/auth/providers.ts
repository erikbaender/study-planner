/**
 * Authentication providers exposed by the product.
 *
 * UI code consumes this provider-neutral registry instead of embedding Auth.js
 * identifiers. Provider IDs are deliberately small and stable because they
 * are also used by the Convex Auth adapter.
 */
export const AUTH_PROVIDERS = [{ id: "email-otp", label: "Email" }] as const;

/** Internal migration providers remain callable only from explicit account flows. */
export type AuthProviderId = (typeof AUTH_PROVIDERS)[number]["id"] | "email-change" | "github";

export const DEFAULT_AUTH_PROVIDER: AuthProviderId = AUTH_PROVIDERS[0].id;
