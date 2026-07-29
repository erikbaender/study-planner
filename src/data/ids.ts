/**
 * Client-side id generation, for the local repository and for import.
 *
 * Convex assigns its own ids, so these only ever exist in local mode. The
 * prefix is purely diagnostic: a stray `topic_…` in a block field is obvious in
 * a console log in a way that a bare UUID is not.
 */

let counter = 0;

export type IdFactory = (prefix: string) => string;

export const createId: IdFactory = (prefix) => {
  counter += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : counter.toString(36).padStart(8, "0");
  return `${prefix}_${random}${counter.toString(36)}`;
};

/** Deterministic ids for tests: `topic_1`, `topic_2`, … */
export function sequentialIdFactory(): IdFactory {
  const counters = new Map<string, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
