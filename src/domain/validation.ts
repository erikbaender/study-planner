/**
 * Client-side validation rules for repository operations.
 *
 * Previously these lived only in Convex, so local mode could build states the
 * server would have rejected — dependency cycles in particular. Putting them
 * here gives local mode the same semantics. Convex mirrors these rules in its
 * independent server guard so it remains a trustworthy security boundary.
 *
 * This is *not* the security boundary. Convex re-checks ownership and
 * invariants server-side; client validation exists so the UI can fail fast and
 * explain itself.
 */

import { isValidIsoDate } from "./dates";
import type { EntityId, Topic } from "./types";

/**
 * Cost and field limits for direct planner mutations.
 *
 * These mirror the public Convex boundary. Import has additional aggregate
 * budgets in `planner-transfer.ts`; the overlapping text and number limits are
 * intentionally the same so moving between repositories cannot change what a
 * valid planner value means.
 */
export const PLANNER_LIMITS = {
  nameCharacters: 200,
  codeCharacters: 64,
  notesCharacters: 20_000,
  logNoteCharacters: 4_000,
  accentColorCharacters: 64,
  units: 1_000_000_000,
  minutes: 10_080,
  bulkTopics: 250,
  reorderItems: 500,
  dependencyIds: 500,
  reflowTopics: 250,
  reflowBlocks: 1_000,
  blackoutDates: 2_000,
} as const;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export class ValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${field} is required`, field);
  return trimmed;
}

/** Required canonical text for persisted names and codes. */
export function requireTrimmedBoundedText(
  value: string,
  field: string,
  maximum: number,
): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new ValidationError(
      `${field} must be non-empty and have no surrounding whitespace`,
      field,
    );
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new ValidationError(`${field} cannot contain control characters`, field);
  }
  if (value.length > maximum) {
    throw new ValidationError(`${field} cannot exceed ${maximum} characters`, field);
  }
}

/** Free-form notes retain whitespace but still have a storage bound. */
export function requireBoundedText(value: string, field: string, maximum: number): void {
  if (value.length > maximum) {
    throw new ValidationError(`${field} cannot exceed ${maximum} characters`, field);
  }
}

export function requireAllowedValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} is invalid`, field);
  }
}

export function requireValidDate(value: string, field: string): string {
  if (!isValidIsoDate(value)) {
    throw new ValidationError(`${field} must be a valid date`, field);
  }
  return value;
}

/** Enforces `start <= end`; a same-day range is valid. */
export function requireOrderedDates(start: string, end?: string): void {
  requireValidDate(start, "Start date");
  if (end === undefined) return;
  requireValidDate(end, "End date");
  if (end < start) {
    throw new ValidationError("End date cannot be before start date", "endDate");
  }
}

type NumberBounds = {
  minimum?: number;
  maximum?: number;
  integer?: boolean;
};

export function requireFiniteBoundedNumber(
  value: number,
  field: string,
  { minimum, maximum, integer = false }: NumberBounds = {},
): number {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a finite number`, field);
  }
  if (integer && !Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer`, field);
  }
  if (minimum !== undefined && value < minimum) {
    throw new ValidationError(`${field} must be at least ${minimum}`, field);
  }
  if (maximum !== undefined && value > maximum) {
    throw new ValidationError(`${field} cannot exceed ${maximum}`, field);
  }
  return value;
}

export function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${field} must be zero or greater`, field);
  }
  return value;
}

/**
 * Completed units may not exceed the total, except when the total is `0`
 * ("size untracked"), where any completed count is meaningless but harmless.
 */
export function requireValidProgress(completedUnits: number, totalUnits: number): void {
  requireFiniteBoundedNumber(completedUnits, "Completed units", {
    minimum: 0,
    maximum: PLANNER_LIMITS.units,
  });
  requireFiniteBoundedNumber(totalUnits, "Total units", {
    minimum: 0,
    maximum: PLANNER_LIMITS.units,
  });
  if (totalUnits > 0 && completedUnits > totalUnits) {
    throw new ValidationError("Completed units cannot exceed the total", "completedUnits");
  }
}

export function requirePlannedUnits(plannedUnits: number | undefined): void {
  if (plannedUnits === undefined) return;
  requireFiniteBoundedNumber(plannedUnits, "Planned units", {
    minimum: 0,
    maximum: PLANNER_LIMITS.units,
  });
}

export function requireBoundedArray(
  values: readonly unknown[],
  field: string,
  maximum: number,
): void {
  if (values.length > maximum) {
    throw new ValidationError(`${field} cannot contain more than ${maximum} items`, field);
  }
}

export function requireDistinctBoundedArray<T>(
  values: readonly T[],
  field: string,
  maximum: number,
  keyOf: (value: T) => unknown = (value) => value,
): void {
  requireBoundedArray(values, field, maximum);
  const seen = new Set<unknown>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) {
      throw new ValidationError(`${field} cannot contain duplicates`, field);
    }
    seen.add(key);
  }
}

export function requireCompleteReorder(
  existingIds: readonly EntityId[],
  requestedIds: readonly EntityId[],
  field: string,
): void {
  requireDistinctBoundedArray(requestedIds, field, PLANNER_LIMITS.reorderItems);
  const existing = new Set(existingIds);
  if (requestedIds.length !== existing.size || requestedIds.some((id) => !existing.has(id))) {
    throw new ValidationError(`${field} must contain every sibling exactly once`, field);
  }
}

export type ScheduleBlockValidationInput = {
  topicId: EntityId;
  startDate: string;
  endDate: string;
  plannedUnits?: number;
};

export function requireValidAutoBlockReplacement(
  topicIds: readonly EntityId[],
  blocks: readonly ScheduleBlockValidationInput[],
): void {
  requireDistinctBoundedArray(topicIds, "Reflow topic ids", PLANNER_LIMITS.reflowTopics);
  requireDistinctBoundedArray(
    blocks,
    "Generated blocks",
    PLANNER_LIMITS.reflowBlocks,
    (block) => JSON.stringify([block.topicId, block.startDate, block.endDate]),
  );

  const scope = new Set(topicIds);
  for (const block of blocks) {
    if (!scope.has(block.topicId)) {
      throw new ValidationError("Cannot write blocks for a topic outside the reflow scope");
    }
    requireOrderedDates(block.startDate, block.endDate);
    requirePlannedUnits(block.plannedUnits);
  }
}

export type PreferencesValidationInput = {
  dailyCapacityUnits?: number;
  studyDaysOfWeek: readonly number[];
  blackoutDates: readonly string[];
  theme: unknown;
  accentColor: string;
};

export function requireValidPreferences(preferences: PreferencesValidationInput): void {
  if (preferences.dailyCapacityUnits !== undefined) {
    requireFiniteBoundedNumber(preferences.dailyCapacityUnits, "Daily capacity", {
      minimum: 0,
      maximum: PLANNER_LIMITS.units,
    });
  }

  requireDistinctBoundedArray(preferences.studyDaysOfWeek, "Study days", 7);
  for (const weekday of preferences.studyDaysOfWeek) {
    requireFiniteBoundedNumber(weekday, "Study day", {
      minimum: 0,
      maximum: 6,
      integer: true,
    });
  }

  requireDistinctBoundedArray(
    preferences.blackoutDates,
    "Blackout dates",
    PLANNER_LIMITS.blackoutDates,
  );
  for (const date of preferences.blackoutDates) {
    requireValidDate(date, "Blackout date");
  }

  // Convex's wire validator enforces this enum. Local calls need the same
  // runtime check because TypeScript types do not survive arbitrary JS callers.
  requireAllowedValue(preferences.theme, ["system", "light", "dark"], "Theme");
  requireTrimmedBoundedText(
    preferences.accentColor,
    "Accent color",
    PLANNER_LIMITS.accentColorCharacters,
  );
}

export function requireValidScheduleApplication(
  topicIds: readonly EntityId[],
  blocks: readonly ScheduleBlockValidationInput[],
  preferences: PreferencesValidationInput,
): void {
  requireValidAutoBlockReplacement(topicIds, blocks);
  requireValidPreferences(preferences);
}

type DependencyGraph = ReadonlyMap<EntityId, readonly EntityId[]>;

export function buildDependencyGraph(topics: readonly Topic[]): DependencyGraph {
  return new Map(topics.map((topic) => [topic.id, topic.dependencyIds]));
}

/**
 * Would assigning `dependencyIds` to `topicId` close a loop?
 *
 * Iterative depth-first search from each proposed dependency, following
 * existing edges. Iterative rather than recursive so a long dependency chain
 * cannot blow the stack. Self-dependency is caught by the initial seeding.
 */
export function createsCycle(
  graph: DependencyGraph,
  topicId: EntityId,
  dependencyIds: readonly EntityId[],
): boolean {
  const stack = [...dependencyIds];
  const visited = new Set<EntityId>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === topicId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(graph.get(current) ?? []));
  }

  return false;
}

export function requireAcyclic(
  graph: DependencyGraph,
  topicId: EntityId,
  dependencyIds: readonly EntityId[],
): void {
  if (createsCycle(graph, topicId, dependencyIds)) {
    throw new ValidationError("That would create a circular dependency", "dependencyIds");
  }
}

/**
 * Topics in dependency-first order, ties broken by `order` so the result is
 * stable. Topics inside a cycle are appended at the end rather than dropped —
 * validation should prevent cycles, but a scheduler that silently loses topics
 * because of bad data would be worse than one that schedules them late.
 */
export function topologicalOrder(topics: readonly Topic[]): Topic[] {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const permanent = new Set<EntityId>();
  const temporary = new Set<EntityId>();
  const sorted: Topic[] = [];

  const visit = (topic: Topic): void => {
    if (permanent.has(topic.id) || temporary.has(topic.id)) return;
    temporary.add(topic.id);
    for (const dependencyId of topic.dependencyIds) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    temporary.delete(topic.id);
    permanent.add(topic.id);
    sorted.push(topic);
  };

  for (const topic of [...topics].sort((left, right) => left.order - right.order)) {
    visit(topic);
  }

  return sorted;
}
