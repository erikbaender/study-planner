/**
 * Semantic validation for the public planner API.
 *
 * Convex validators protect the wire shape. These pure guards protect the
 * meaning and cost of accepted values, and stay independent from Convex so the
 * security boundary can be covered by fast unit tests.
 */

export const PLANNER_LIMITS = {
  nameCharacters: 200,
  codeCharacters: 64,
  notesCharacters: 20_000,
  logNoteCharacters: 4_000,
  topicKeyCharacters: 128,
  accentColorCharacters: 64,
  units: 1_000_000_000,
  minutes: 10_080,
  bulkTopics: 250,
  reorderItems: 500,
  dependencyIds: 500,
  colorReferences: 500,
  reflowTopics: 250,
  reflowBlocks: 1_000,
  blackoutDates: 2_000,
  importPlans: 50,
  importEntities: 2_000,
  importReferences: 5_000,
  importTextCharacters: 1_000_000,
} as const;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const TOPIC_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export function assertIsoDate(value: string, label: string): void {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${label} must be a real date in YYYY-MM-DD format`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real date in YYYY-MM-DD format`);
  }
}

export function assertOrderedIsoDates(startDate: string, endDate?: string): void {
  assertIsoDate(startDate, "Start date");
  if (endDate === undefined) return;

  assertIsoDate(endDate, "End date");
  if (endDate < startDate) {
    throw new Error("End date cannot be before the start date");
  }
}

/** Required, canonical text for names, codes, and path components. */
export function assertTrimmedBoundedText(
  value: string,
  label: string,
  maxCharacters: number,
): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be non-empty and have no surrounding whitespace`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${label} cannot contain control characters`);
  }
  if (value.length > maxCharacters) {
    throw new Error(`${label} cannot exceed ${maxCharacters} characters`);
  }
}

/** Free-form text may preserve whitespace, but it still needs a storage bound. */
export function assertBoundedText(value: string, label: string, maxCharacters: number): void {
  if (value.length > maxCharacters) {
    throw new Error(`${label} cannot exceed ${maxCharacters} characters`);
  }
}

type NumberBounds = {
  min?: number;
  max?: number;
  integer?: boolean;
};

export function assertFiniteBoundedNumber(
  value: number,
  label: string,
  { min, max, integer = false }: NumberBounds = {},
): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`${label} must be at least ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${label} cannot exceed ${max}`);
  }
}

export function assertProgress(completedUnits: number, totalUnits: number): void {
  assertFiniteBoundedNumber(totalUnits, "Total units", { min: 0, max: PLANNER_LIMITS.units });
  assertFiniteBoundedNumber(completedUnits, "Completed units", {
    min: 0,
    max: PLANNER_LIMITS.units,
  });
  if (totalUnits > 0 && completedUnits > totalUnits) {
    throw new Error("Completed units cannot exceed the total");
  }
}

export function assertPlannedUnits(plannedUnits: number | undefined): void {
  if (plannedUnits !== undefined) {
    assertFiniteBoundedNumber(plannedUnits, "Planned units", {
      min: 0,
      max: PLANNER_LIMITS.units,
    });
  }
}

export function assertBoundedArray(values: readonly unknown[], label: string, maxItems: number): void {
  if (values.length > maxItems) {
    throw new Error(`${label} cannot contain more than ${maxItems} items`);
  }
}

export function assertDistinctBoundedArray<T>(
  values: readonly T[],
  label: string,
  maxItems: number,
  keyOf: (value: T) => unknown = (value) => value,
): void {
  assertBoundedArray(values, label, maxItems);

  const seen = new Set<unknown>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) {
      throw new Error(`${label} cannot contain duplicates`);
    }
    seen.add(key);
  }
}

export function assertReorderComplete(
  existingIds: readonly string[],
  requestedIds: readonly string[],
  label: string,
): void {
  assertDistinctBoundedArray(requestedIds, label, PLANNER_LIMITS.reorderItems);

  const existing = new Set(existingIds);
  if (requestedIds.length !== existing.size || requestedIds.some((id) => !existing.has(id))) {
    throw new Error(`${label} must contain every sibling exactly once`);
  }
}

export type PreferencesInput = {
  dailyCapacityUnits?: number;
  studyDaysOfWeek: readonly number[];
  blackoutDates: readonly string[];
  accentColor: string;
};

export function assertPreferences(input: PreferencesInput): void {
  if (input.dailyCapacityUnits !== undefined) {
    assertFiniteBoundedNumber(input.dailyCapacityUnits, "Daily capacity", {
      min: 0,
      max: PLANNER_LIMITS.units,
    });
  }

  assertDistinctBoundedArray(input.studyDaysOfWeek, "Study days", 7);
  for (const weekday of input.studyDaysOfWeek) {
    assertFiniteBoundedNumber(weekday, "Study day", { min: 0, max: 6, integer: true });
  }

  assertDistinctBoundedArray(
    input.blackoutDates,
    "Blackout dates",
    PLANNER_LIMITS.blackoutDates,
  );
  for (const date of input.blackoutDates) {
    assertIsoDate(date, "Blackout date");
  }

  assertTrimmedBoundedText(
    input.accentColor,
    "Accent color",
    PLANNER_LIMITS.accentColorCharacters,
  );
}

export type ScheduleBlockGuardInput = {
  topicId: string;
  startDate: string;
  endDate: string;
  plannedUnits?: number;
};

export function assertAutoBlockReplacement(
  topicIds: readonly string[],
  blocks: readonly ScheduleBlockGuardInput[],
): void {
  assertDistinctBoundedArray(topicIds, "Reflow topic ids", PLANNER_LIMITS.reflowTopics);
  assertDistinctBoundedArray(
    blocks,
    "Generated blocks",
    PLANNER_LIMITS.reflowBlocks,
    (block) => JSON.stringify([block.topicId, block.startDate, block.endDate]),
  );

  const allowed = new Set(topicIds);
  for (const block of blocks) {
    if (!allowed.has(block.topicId)) {
      throw new Error("Cannot write blocks for a topic outside the reflow scope");
    }
    assertOrderedIsoDates(block.startDate, block.endDate);
    assertPlannedUnits(block.plannedUnits);
  }
}

export function assertScheduleApplication(
  topicIds: readonly string[],
  blocks: readonly ScheduleBlockGuardInput[],
  preferences: PreferencesInput,
): void {
  assertAutoBlockReplacement(topicIds, blocks);
  assertPreferences(preferences);
}

type ImportBlockInput = {
  startDate: string;
  endDate: string;
  plannedUnits?: number;
};

type ImportTopicInput = {
  key: string;
  name: string;
  totalUnits: number;
  completedUnits: number;
  notes: string;
  dependencies: readonly string[];
  blocks: readonly ImportBlockInput[];
};

type ImportExamInput = {
  name: string;
  startDate: string;
  endDate?: string;
  notes: string;
};

type ImportCourseInput = {
  name: string;
  code?: string;
  notes: string;
  exams: readonly ImportExamInput[];
  topics: readonly ImportTopicInput[];
};

export type ImportPlanGuardInput = {
  name: string;
  notes: string;
  courses: readonly ImportCourseInput[];
};

export type ImportLogGuardInput = {
  topicKey: string;
  date: string;
  units: number;
  minutes?: number;
  note?: string;
};

type ImportBudget = {
  entities: number;
  references: number;
  textCharacters: number;
};

function addImportEntity(budget: ImportBudget): void {
  budget.entities += 1;
  if (budget.entities > PLANNER_LIMITS.importEntities) {
    throw new Error(`Import cannot contain more than ${PLANNER_LIMITS.importEntities} records`);
  }
}

function addImportReferences(budget: ImportBudget, count: number): void {
  budget.references += count;
  if (budget.references > PLANNER_LIMITS.importReferences) {
    throw new Error(
      `Import cannot contain more than ${PLANNER_LIMITS.importReferences} references`,
    );
  }
}

function addImportText(budget: ImportBudget, value: string): void {
  budget.textCharacters += value.length;
  if (budget.textCharacters > PLANNER_LIMITS.importTextCharacters) {
    throw new Error(
      `Import text cannot exceed ${PLANNER_LIMITS.importTextCharacters} characters in total`,
    );
  }
}

function assertImportRequiredText(
  value: string,
  label: string,
  maxCharacters: number,
  budget: ImportBudget,
): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be non-empty and have no surrounding whitespace`);
  }
  if (value.length > maxCharacters) {
    throw new Error(`${label} cannot exceed ${maxCharacters} characters`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${label} cannot contain control characters`);
  }
  addImportText(budget, value);
}

function assertImportName(value: string, label: string, budget: ImportBudget): void {
  assertImportRequiredText(value, label, PLANNER_LIMITS.nameCharacters, budget);
}

function assertImportTopicKey(value: string, label: string, budget: ImportBudget): void {
  if (
    value.length === 0 ||
    value.length > PLANNER_LIMITS.topicKeyCharacters ||
    !TOPIC_KEY_PATTERN.test(value)
  ) {
    throw new Error(
      `${label} must contain 1-${PLANNER_LIMITS.topicKeyCharacters} letters, numbers, underscores, or hyphens`,
    );
  }
  addImportText(budget, value);
}

function assertImportNotes(value: string, label: string, budget: ImportBudget): void {
  assertBoundedText(value, label, PLANNER_LIMITS.notesCharacters);
  addImportText(budget, value);
}

function assertAcyclicDependencies(topics: readonly ImportTopicInput[]): void {
  const dependencyCount = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const topic of topics) {
    dependencyCount.set(topic.key, topic.dependencies.length);
    for (const dependency of topic.dependencies) {
      const current = dependents.get(dependency) ?? [];
      current.push(topic.key);
      dependents.set(dependency, current);
    }
  }

  const ready = [...dependencyCount]
    .filter(([, count]) => count === 0)
    .map(([name]) => name);
  let resolved = 0;

  while (ready.length > 0) {
    const name = ready.pop();
    if (name === undefined) break;
    resolved += 1;

    for (const dependent of dependents.get(name) ?? []) {
      const remaining = (dependencyCount.get(dependent) ?? 0) - 1;
      dependencyCount.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }

  if (resolved !== topics.length) {
    throw new Error("Imported topic dependencies cannot contain a cycle");
  }
}

/**
 * Validates the complete canonical document before any import writes happen.
 */
export function assertImportPayload(
  plans: readonly ImportPlanGuardInput[],
  studyLog: readonly ImportLogGuardInput[] = [],
): void {
  if (plans.length > PLANNER_LIMITS.importPlans) {
    throw new Error(`Import cannot contain more than ${PLANNER_LIMITS.importPlans} plans`);
  }

  const budget: ImportBudget = { entities: 0, references: 0, textCharacters: 0 };
  const courseByTopicKey = new Map<string, string>();

  for (const [planIndex, plan] of plans.entries()) {
    addImportEntity(budget);
    assertImportName(plan.name, "Plan name", budget);
    assertImportNotes(plan.notes, "Plan notes", budget);
    assertBoundedArray(plan.courses, "Plan courses", PLANNER_LIMITS.importEntities);

    for (const [courseIndex, course] of plan.courses.entries()) {
      const courseIdentity = `${planIndex}:${courseIndex}`;
      addImportEntity(budget);
      assertImportName(course.name, "Course name", budget);
      if (course.code !== undefined) {
        assertImportRequiredText(
          course.code,
          "Course code",
          PLANNER_LIMITS.codeCharacters,
          budget,
        );
      }
      assertImportNotes(course.notes, "Course notes", budget);
      assertBoundedArray(course.exams, "Course exams", PLANNER_LIMITS.importEntities);
      assertBoundedArray(course.topics, "Course topics", PLANNER_LIMITS.importEntities);

      for (const exam of course.exams) {
        addImportEntity(budget);
        assertImportName(exam.name, "Exam name", budget);
        assertImportNotes(exam.notes, "Exam notes", budget);
        assertOrderedIsoDates(exam.startDate, exam.endDate);
      }

      for (const topic of course.topics) {
        addImportEntity(budget);
        assertImportTopicKey(topic.key, "Topic key", budget);
        if (courseByTopicKey.has(topic.key)) {
          throw new Error(`Topic key ${topic.key} is duplicated`);
        }
        courseByTopicKey.set(topic.key, courseIdentity);
        assertImportName(topic.name, "Topic name", budget);
        assertImportNotes(topic.notes, "Topic notes", budget);
        assertProgress(topic.completedUnits, topic.totalUnits);
        assertDistinctBoundedArray(
          topic.dependencies,
          `Dependencies for ${topic.name}`,
          PLANNER_LIMITS.dependencyIds,
        );
        addImportReferences(budget, topic.dependencies.length);
        for (const dependency of topic.dependencies) {
          assertImportTopicKey(dependency, "Dependency key", budget);
        }

        assertBoundedArray(topic.blocks, "Topic blocks", PLANNER_LIMITS.importEntities);
        for (const block of topic.blocks) {
          addImportEntity(budget);
          assertOrderedIsoDates(block.startDate, block.endDate);
          assertPlannedUnits(block.plannedUnits);
        }
      }
    }
  }

  for (const [planIndex, plan] of plans.entries()) {
    for (const [courseIndex, course] of plan.courses.entries()) {
      const courseIdentity = `${planIndex}:${courseIndex}`;
      for (const topic of course.topics) {
        for (const dependency of topic.dependencies) {
          const dependencyCourse = courseByTopicKey.get(dependency);
          if (!dependencyCourse) {
            throw new Error(`Dependency ${dependency} does not reference an imported topic`);
          }
          if (dependencyCourse !== courseIdentity) {
            throw new Error("Dependencies must reference topics in the same course");
          }
        }
      }
      assertAcyclicDependencies(course.topics);
    }
  }

  for (const entry of studyLog) {
    addImportEntity(budget);
    addImportReferences(budget, 1);
    assertImportTopicKey(entry.topicKey, "Log topic key", budget);
    if (!courseByTopicKey.has(entry.topicKey)) {
      throw new Error(`Log entry references missing topic key ${entry.topicKey}`);
    }
    assertIsoDate(entry.date, "Log date");
    assertFiniteBoundedNumber(entry.units, "Log units", {
      min: -PLANNER_LIMITS.units,
      max: PLANNER_LIMITS.units,
    });
    if (entry.minutes !== undefined) {
      assertFiniteBoundedNumber(entry.minutes, "Log minutes", {
        min: 0,
        max: PLANNER_LIMITS.minutes,
      });
    }
    if (entry.note !== undefined) {
      assertBoundedText(entry.note, "Log note", PLANNER_LIMITS.logNoteCharacters);
      addImportText(budget, entry.note);
    }
  }
}
