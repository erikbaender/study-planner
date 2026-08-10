/**
 * Validation rules shared by every repository.
 *
 * Previously these lived only in Convex, so local mode could build states the
 * server would have rejected — dependency cycles in particular. Putting them
 * here means both backends enforce the same rules from the same source.
 *
 * This is *not* the security boundary. Convex re-checks ownership and
 * invariants server-side; client validation exists so the UI can fail fast and
 * explain itself.
 */

import { isValidIsoDate } from "./dates";
import type { EntityId, Topic } from "./types";

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

function requireValidDate(value: string, field: string): string {
  if (!isValidIsoDate(value)) {
    throw new ValidationError(`${field} must be a valid date`, field);
  }
  return value;
}

/** Enforces `start <= end`; a same-day range is valid. */
export function requireOrderedDates(start: string, end: string): void {
  requireValidDate(start, "Start date");
  requireValidDate(end, "End date");
  if (end < start) {
    throw new ValidationError("End date cannot be before start date", "endDate");
  }
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
  requireNonNegative(completedUnits, "Completed units");
  requireNonNegative(totalUnits, "Total units");
  if (totalUnits > 0 && completedUnits > totalUnits) {
    throw new ValidationError("Completed units cannot exceed the total", "completedUnits");
  }
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
