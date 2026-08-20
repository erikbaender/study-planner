/**
 * Authentication providers exposed by the product.
 *
 * UI code consumes this provider-neutral registry instead of embedding Auth.js
 * identifiers. Google can be added here after its account-linking and local
 * data migration flows are defined; email matching must remain disabled.
 */
export const AUTH_PROVIDERS = [{ id: "github", label: "GitHub" }] as const;

export type AuthProviderId = (typeof AUTH_PROVIDERS)[number]["id"];

export const DEFAULT_AUTH_PROVIDER: AuthProviderId = AUTH_PROVIDERS[0].id;
