import { normalizeEmail } from "./authEmail";

/**
 * Matches exact addresses and whole domains from a comma-separated dashboard
 * setting. Bare domains and `@domain` entries are both accepted.
 */
export function isAllowedRecipient(identifier: string, configured: string) {
  const normalizedIdentifier = normalizeEmail(identifier);
  const domain = normalizedIdentifier.split("@")[1];
  return configured
    .split(",")
    .map((entry) => normalizeEmail(entry).replace(/^@/, ""))
    .filter(Boolean)
    .some((entry) => (entry.includes("@") ? entry === normalizedIdentifier : entry === domain));
}
