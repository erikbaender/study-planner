/**
 * The portable planner document, independent of its JSON parser.
 *
 * This module deliberately has no Zod dependency. Exporting is part of the
 * normal application bundle; parsing an untrusted file is an uncommon action
 * and lives in `import-export.ts`, which AppShell loads on demand.
 */

import {
  EXAM_KINDS,
  EXAM_STATUSES,
  PRIORITIES,
  TOPIC_STATUSES,
  UNITS,
  type BlockSource,
  type ExamKind,
  type ExamStatus,
  type IsoDate,
  type Plan,
  type PlannerSnapshot,
  type Priority,
  type TopicStatus,
  type Unit,
} from "@/domain/types";
import {
  isCourseColorId,
  resolveCourseColorId,
  type CourseColorId,
} from "@/domain/palette";
import { isValidIsoDate } from "@/domain/dates";

export const EXPORT_VERSION = 3 as const;
export const MAX_PLANNER_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_PLANNER_IMPORT_MIB = 5;
export const PLANNER_TOPIC_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/** Kept aligned with the server boundary in `convex/plannerGuards.ts`. */
export const PLANNER_TRANSFER_LIMITS = {
  nameCharacters: 200,
  codeCharacters: 64,
  notesCharacters: 20_000,
  logNoteCharacters: 4_000,
  topicKeyCharacters: 128,
  units: 1_000_000_000,
  minutes: 10_080,
  dependencyIds: 500,
  importPlans: 50,
  importEntities: 2_000,
  importReferences: 5_000,
  importTextCharacters: 1_000_000,
} as const;

export type TransferredBlock = {
  startDate: IsoDate;
  endDate: IsoDate;
  plannedUnits?: number;
  source: BlockSource;
};

export type TransferredTopic = {
  /** Opaque within this document; never a database id or a display name. */
  key: string;
  name: string;
  unit: Unit;
  totalUnits: number;
  completedUnits: number;
  status: TopicStatus;
  priority: Priority;
  color: CourseColorId;
  notes: string;
  /** Topic keys, always restricted to this topic's course. */
  dependencies: string[];
  blocks: TransferredBlock[];
};

export type TransferredExam = {
  name: string;
  kind: ExamKind;
  startDate: IsoDate;
  endDate?: IsoDate;
  status: ExamStatus;
  notes: string;
};

export type TransferredCourse = {
  name: string;
  code?: string;
  color: CourseColorId;
  notes: string;
  exams: TransferredExam[];
  topics: TransferredTopic[];
};

export type TransferredPlan = {
  name: string;
  notes: string;
  courses: TransferredCourse[];
};

export type TransferredLogEntry = {
  topicKey: string;
  date: IsoDate;
  units: number;
  minutes?: number;
  note?: string;
};

export type PlannerTransferDocument = {
  version: typeof EXPORT_VERSION;
  exportedAt?: string;
  plans: TransferredPlan[];
  studyLog: TransferredLogEntry[];
};

export class PlannerTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerTransferError";
  }
}

function makeTopicKey(index: number): string {
  return `topic_${index.toString(36)}`;
}

/**
 * `exportedAt` is injected so callers and tests control the clock.
 *
 * Orphaned log rows are the one inconsistency intentionally tolerated here:
 * there is no useful portable reference for a deleted topic, so those rows are
 * omitted. Other broken references throw instead of producing a corrupt file.
 */
export function serializePlans(
  snapshot: PlannerSnapshot,
  exportedAt?: string,
): PlannerTransferDocument {
  const topicKeysById = new Map<string, string>();
  let nextTopicKey = 0;

  for (const plan of snapshot.plans) {
    for (const course of plan.courses) {
      if (course.planId !== plan.id) {
        throw new PlannerTransferError(
          `Cannot export course ${course.name}: its plan reference does not match its container.`,
        );
      }
      for (const exam of course.exams) {
        if (exam.courseId !== course.id) {
          throw new PlannerTransferError(
            `Cannot export exam ${exam.name}: its course reference does not match its container.`,
          );
        }
      }
      for (const topic of course.topics) {
        if (topic.courseId !== course.id) {
          throw new PlannerTransferError(
            `Cannot export topic ${topic.name}: its course reference does not match its container.`,
          );
        }
        for (const block of topic.blocks) {
          if (block.topicId !== topic.id) {
            throw new PlannerTransferError(
              `Cannot export a block for ${topic.name}: its topic reference does not match its container.`,
            );
          }
        }
        if (topicKeysById.has(topic.id)) {
          throw new PlannerTransferError(`Cannot export duplicate internal topic id ${topic.id}.`);
        }
        topicKeysById.set(topic.id, makeTopicKey(nextTopicKey));
        nextTopicKey += 1;
      }
    }
  }

  const document: PlannerTransferDocument = {
    version: EXPORT_VERSION,
    exportedAt,
    plans: snapshot.plans.map((plan) => ({
      name: plan.name,
      notes: plan.notes,
      courses: plan.courses.map((course) => {
        const courseTopicKeys = new Map(
          course.topics.map((topic) => [topic.id, topicKeysById.get(topic.id)!]),
        );

        return {
          name: course.name,
          code: course.code,
          color: resolveCourseColorId(course.color),
          notes: course.notes,
          exams: course.exams.map((exam) => ({
            name: exam.name,
            kind: exam.kind,
            startDate: exam.startDate,
            endDate: exam.endDate,
            status: exam.status,
            notes: exam.notes,
          })),
          topics: course.topics.map((topic) => ({
            key: topicKeysById.get(topic.id)!,
            name: topic.name,
            unit: topic.unit,
            totalUnits: topic.totalUnits,
            completedUnits: topic.completedUnits,
            status: topic.status,
            priority: topic.priority,
            color: resolveCourseColorId(topic.color),
            notes: topic.notes,
            dependencies: topic.dependencyIds.map((dependencyId) => {
              const dependencyKey = courseTopicKeys.get(dependencyId);
              if (!dependencyKey) {
                throw new PlannerTransferError(
                  `Cannot export topic ${topic.name}: dependency ${dependencyId} is not in its course.`,
                );
              }
              return dependencyKey;
            }),
            blocks: topic.blocks.map((block) => ({
              startDate: block.startDate,
              endDate: block.endDate,
              plannedUnits: block.plannedUnits,
              source: block.source,
            })),
          })),
        };
      }),
    })),
    studyLog: snapshot.studyLog.flatMap((entry): TransferredLogEntry[] => {
      const topicKey = topicKeysById.get(entry.topicId);
      if (!topicKey) return [];
      return [
        {
          topicKey,
          date: entry.date,
          units: entry.units,
          minutes: entry.minutes,
          note: entry.note,
        },
      ];
    }),
  };

  assertPlannerTransferIntegrity(document);
  return document;
}

type Budget = {
  entities: number;
  references: number;
  textCharacters: number;
};

function assertBoundedArray(values: readonly unknown[], label: string, maximum: number): void {
  if (values.length > maximum) {
    throw new PlannerTransferError(`${label} cannot contain more than ${maximum} items.`);
  }
}

function addEntity(budget: Budget): void {
  budget.entities += 1;
  if (budget.entities > PLANNER_TRANSFER_LIMITS.importEntities) {
    throw new PlannerTransferError(
      `Import cannot contain more than ${PLANNER_TRANSFER_LIMITS.importEntities} records.`,
    );
  }
}

function addReference(budget: Budget, count = 1): void {
  budget.references += count;
  if (budget.references > PLANNER_TRANSFER_LIMITS.importReferences) {
    throw new PlannerTransferError(
      `Import cannot contain more than ${PLANNER_TRANSFER_LIMITS.importReferences} references.`,
    );
  }
}

function addText(budget: Budget, value: string): void {
  budget.textCharacters += value.length;
  if (budget.textCharacters > PLANNER_TRANSFER_LIMITS.importTextCharacters) {
    throw new PlannerTransferError(
      `Import text cannot exceed ${PLANNER_TRANSFER_LIMITS.importTextCharacters} characters in total.`,
    );
  }
}

function assertRequiredText(value: string, label: string, maximum: number, budget: Budget): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new PlannerTransferError(
      `${label} must be non-empty and have no surrounding whitespace.`,
    );
  }
  if (value.length > maximum) {
    throw new PlannerTransferError(`${label} cannot exceed ${maximum} characters.`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new PlannerTransferError(`${label} cannot contain control characters.`);
  }
  addText(budget, value);
}

function assertFreeText(value: string, label: string, maximum: number, budget: Budget): void {
  if (value.length > maximum) {
    throw new PlannerTransferError(`${label} cannot exceed ${maximum} characters.`);
  }
  addText(budget, value);
}

function assertTopicKey(value: string, label: string, budget: Budget): void {
  if (
    value.length === 0 ||
    value.length > PLANNER_TRANSFER_LIMITS.topicKeyCharacters ||
    !PLANNER_TOPIC_KEY_PATTERN.test(value)
  ) {
    throw new PlannerTransferError(
      `${label} must contain 1–${PLANNER_TRANSFER_LIMITS.topicKeyCharacters} letters, numbers, underscores, or hyphens.`,
    );
  }
  addText(budget, value);
}

function assertFiniteNumber(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new PlannerTransferError(
      `${label} must be a finite number from ${minimum} to ${maximum}.`,
    );
  }
}

function assertDate(value: string, label: string): void {
  if (!isValidIsoDate(value)) {
    throw new PlannerTransferError(`${label} must be a real date in YYYY-MM-DD format.`);
  }
}

function assertDateRange(startDate: string, endDate: string | undefined, label: string): void {
  assertDate(startDate, `${label} start date`);
  if (endDate === undefined) return;
  assertDate(endDate, `${label} end date`);
  if (endDate < startDate) {
    throw new PlannerTransferError(`${label} end date cannot be before its start date.`);
  }
}

function assertDistinct(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new PlannerTransferError(`${label} cannot contain duplicates.`);
  }
}

function assertAcyclicCourse(topics: readonly TransferredTopic[], courseLabel: string): void {
  const remainingDependencies = new Map(
    topics.map((topic) => [topic.key, topic.dependencies.length]),
  );
  const dependents = new Map<string, string[]>();

  for (const topic of topics) {
    for (const dependency of topic.dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), topic.key]);
    }
  }

  const ready = [...remainingDependencies]
    .filter(([, count]) => count === 0)
    .map(([key]) => key);
  let resolved = 0;

  while (ready.length > 0) {
    const key = ready.pop();
    if (key === undefined) break;
    resolved += 1;
    for (const dependent of dependents.get(key) ?? []) {
      const remaining = (remainingDependencies.get(dependent) ?? 0) - 1;
      remainingDependencies.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }

  if (resolved !== topics.length) {
    throw new PlannerTransferError(`${courseLabel} contains a topic dependency cycle.`);
  }
}

/**
 * Validates canonical cross-references and all resource budgets without Zod.
 * The JSON parser additionally uses strict Zod schemas for the untrusted shape.
 */
export function assertPlannerTransferIntegrity(document: PlannerTransferDocument): void {
  if (document.version !== EXPORT_VERSION) {
    throw new PlannerTransferError(`Expected planner transfer version ${EXPORT_VERSION}.`);
  }
  assertBoundedArray(document.plans, "Plans", PLANNER_TRANSFER_LIMITS.importPlans);
  assertBoundedArray(
    document.studyLog,
    "Study log",
    PLANNER_TRANSFER_LIMITS.importEntities,
  );

  const budget: Budget = { entities: 0, references: 0, textCharacters: 0 };
  if (document.exportedAt !== undefined) {
    assertFreeText(document.exportedAt, "Export timestamp", 64, budget);
  }

  const courseByTopicKey = new Map<string, string>();
  const allTopicKeys = new Set<string>();

  for (const [planIndex, plan] of document.plans.entries()) {
    addEntity(budget);
    assertRequiredText(
      plan.name,
      `Plan ${planIndex + 1} name`,
      PLANNER_TRANSFER_LIMITS.nameCharacters,
      budget,
    );
    assertFreeText(
      plan.notes,
      `Plan ${planIndex + 1} notes`,
      PLANNER_TRANSFER_LIMITS.notesCharacters,
      budget,
    );
    assertBoundedArray(plan.courses, `Plan ${planIndex + 1} courses`, PLANNER_TRANSFER_LIMITS.importEntities);

    for (const [courseIndex, course] of plan.courses.entries()) {
      const courseLabel = `Plan ${planIndex + 1}, course ${courseIndex + 1}`;
      const courseIdentity = `${planIndex}:${courseIndex}`;
      addEntity(budget);
      assertRequiredText(
        course.name,
        `${courseLabel} name`,
        PLANNER_TRANSFER_LIMITS.nameCharacters,
        budget,
      );
      if (course.code !== undefined) {
        assertRequiredText(
          course.code,
          `${courseLabel} code`,
          PLANNER_TRANSFER_LIMITS.codeCharacters,
          budget,
        );
      }
      if (!isCourseColorId(course.color)) {
        throw new PlannerTransferError(`${courseLabel} has an unknown color.`);
      }
      assertFreeText(
        course.notes,
        `${courseLabel} notes`,
        PLANNER_TRANSFER_LIMITS.notesCharacters,
        budget,
      );
      assertBoundedArray(course.exams, `${courseLabel} exams`, PLANNER_TRANSFER_LIMITS.importEntities);
      assertBoundedArray(course.topics, `${courseLabel} topics`, PLANNER_TRANSFER_LIMITS.importEntities);

      for (const [examIndex, exam] of course.exams.entries()) {
        const examLabel = `${courseLabel}, exam ${examIndex + 1}`;
        addEntity(budget);
        assertRequiredText(
          exam.name,
          `${examLabel} name`,
          PLANNER_TRANSFER_LIMITS.nameCharacters,
          budget,
        );
        if (!EXAM_KINDS.includes(exam.kind)) {
          throw new PlannerTransferError(`${examLabel} has an unknown kind.`);
        }
        if (!EXAM_STATUSES.includes(exam.status)) {
          throw new PlannerTransferError(`${examLabel} has an unknown status.`);
        }
        assertDateRange(exam.startDate, exam.endDate, examLabel);
        assertFreeText(
          exam.notes,
          `${examLabel} notes`,
          PLANNER_TRANSFER_LIMITS.notesCharacters,
          budget,
        );
      }

      for (const [topicIndex, topic] of course.topics.entries()) {
        const topicLabel = `${courseLabel}, topic ${topicIndex + 1}`;
        addEntity(budget);
        assertTopicKey(topic.key, `${topicLabel} key`, budget);
        if (allTopicKeys.has(topic.key)) {
          throw new PlannerTransferError(`Topic key ${topic.key} is duplicated.`);
        }
        allTopicKeys.add(topic.key);
        courseByTopicKey.set(topic.key, courseIdentity);

        assertRequiredText(
          topic.name,
          `${topicLabel} name`,
          PLANNER_TRANSFER_LIMITS.nameCharacters,
          budget,
        );
        if (!UNITS.includes(topic.unit)) {
          throw new PlannerTransferError(`${topicLabel} has an unknown unit.`);
        }
        if (!TOPIC_STATUSES.includes(topic.status)) {
          throw new PlannerTransferError(`${topicLabel} has an unknown status.`);
        }
        if (!PRIORITIES.includes(topic.priority)) {
          throw new PlannerTransferError(`${topicLabel} has an unknown priority.`);
        }
        if (!isCourseColorId(topic.color)) {
          throw new PlannerTransferError(`${topicLabel} has an unknown color.`);
        }
        assertFiniteNumber(
          topic.totalUnits,
          `${topicLabel} total units`,
          0,
          PLANNER_TRANSFER_LIMITS.units,
        );
        assertFiniteNumber(
          topic.completedUnits,
          `${topicLabel} completed units`,
          0,
          PLANNER_TRANSFER_LIMITS.units,
        );
        if (topic.totalUnits > 0 && topic.completedUnits > topic.totalUnits) {
          throw new PlannerTransferError(`${topicLabel} completed units exceed its total.`);
        }
        assertFreeText(
          topic.notes,
          `${topicLabel} notes`,
          PLANNER_TRANSFER_LIMITS.notesCharacters,
          budget,
        );
        assertBoundedArray(
          topic.dependencies,
          `${topicLabel} dependencies`,
          PLANNER_TRANSFER_LIMITS.dependencyIds,
        );
        assertDistinct(topic.dependencies, `${topicLabel} dependencies`);
        addReference(budget, topic.dependencies.length);
        for (const dependency of topic.dependencies) {
          assertTopicKey(dependency, `${topicLabel} dependency`, budget);
        }
        assertBoundedArray(topic.blocks, `${topicLabel} blocks`, PLANNER_TRANSFER_LIMITS.importEntities);
        for (const [blockIndex, block] of topic.blocks.entries()) {
          const blockLabel = `${topicLabel}, block ${blockIndex + 1}`;
          addEntity(budget);
          assertDateRange(block.startDate, block.endDate, blockLabel);
          if (block.source !== "auto" && block.source !== "manual") {
            throw new PlannerTransferError(`${blockLabel} has an unknown source.`);
          }
          if (block.plannedUnits !== undefined) {
            assertFiniteNumber(
              block.plannedUnits,
              `${blockLabel} planned units`,
              0,
              PLANNER_TRANSFER_LIMITS.units,
            );
          }
        }
      }
    }
  }

  for (const [planIndex, plan] of document.plans.entries()) {
    for (const [courseIndex, course] of plan.courses.entries()) {
      const courseLabel = `Plan ${planIndex + 1}, course ${courseIndex + 1}`;
      const courseIdentity = `${planIndex}:${courseIndex}`;
      for (const topic of course.topics) {
        for (const dependency of topic.dependencies) {
          const dependencyCourse = courseByTopicKey.get(dependency);
          if (!dependencyCourse) {
            throw new PlannerTransferError(
              `${courseLabel}, topic ${topic.name} references missing topic key ${dependency}.`,
            );
          }
          if (dependencyCourse !== courseIdentity) {
            throw new PlannerTransferError(
              `${courseLabel}, topic ${topic.name} has a dependency outside its course.`,
            );
          }
        }
      }
      assertAcyclicCourse(course.topics, courseLabel);
    }
  }

  for (const [logIndex, entry] of document.studyLog.entries()) {
    addEntity(budget);
    addReference(budget);
    assertTopicKey(entry.topicKey, `Study log ${logIndex + 1} topic key`, budget);
    if (!allTopicKeys.has(entry.topicKey)) {
      throw new PlannerTransferError(
        `Study log ${logIndex + 1} references missing topic key ${entry.topicKey}.`,
      );
    }
    assertDate(entry.date, `Study log ${logIndex + 1} date`);
    assertFiniteNumber(
      entry.units,
      `Study log ${logIndex + 1} units`,
      -PLANNER_TRANSFER_LIMITS.units,
      PLANNER_TRANSFER_LIMITS.units,
    );
    if (entry.minutes !== undefined) {
      assertFiniteNumber(
        entry.minutes,
        `Study log ${logIndex + 1} minutes`,
        0,
        PLANNER_TRANSFER_LIMITS.minutes,
      );
    }
    if (entry.note !== undefined) {
      assertFreeText(
        entry.note,
        `Study log ${logIndex + 1} note`,
        PLANNER_TRANSFER_LIMITS.logNoteCharacters,
        budget,
      );
    }
  }
}

/** Builds fresh domain ids and restores every key-based reference. */
export function materializePlannerTransfer(
  document: PlannerTransferDocument,
  createId: (prefix: string) => string,
): Pick<PlannerSnapshot, "plans" | "studyLog"> {
  assertPlannerTransferIntegrity(document);

  const topicIdsByKey = new Map<string, string>();
  const planInputs = document.plans.map((planInput) => ({
    planId: createId("plan"),
    planInput,
    courses: planInput.courses.map((courseInput) => ({
      courseId: createId("course"),
      courseInput,
      topics: courseInput.topics.map((topicInput) => {
        const topicId = createId("topic");
        topicIdsByKey.set(topicInput.key, topicId);
        return { topicId, topicInput };
      }),
    })),
  }));

  const plans = planInputs.map(({ planId, planInput, courses }) => ({
    id: planId,
    name: planInput.name,
    notes: planInput.notes,
    courses: courses.map(({ courseId, courseInput, topics }, courseIndex) => ({
      id: courseId,
      planId,
      name: courseInput.name,
      code: courseInput.code,
      color: courseInput.color,
      notes: courseInput.notes,
      order: courseIndex,
      exams: courseInput.exams.map((examInput, examIndex) => ({
        id: createId("exam"),
        courseId,
        name: examInput.name,
        kind: examInput.kind,
        startDate: examInput.startDate,
        endDate: examInput.endDate,
        status: examInput.status,
        notes: examInput.notes,
        order: examIndex,
      })),
      topics: topics.map(({ topicId, topicInput }, topicIndex) => ({
        id: topicId,
        courseId,
        name: topicInput.name,
        unit: topicInput.unit,
        totalUnits: topicInput.totalUnits,
        completedUnits: topicInput.completedUnits,
        status: topicInput.status,
        priority: topicInput.priority,
        dependencyIds: topicInput.dependencies.map((dependencyKey) => {
          const dependencyId = topicIdsByKey.get(dependencyKey);
          if (!dependencyId) {
            throw new PlannerTransferError(`Missing validated topic key ${dependencyKey}.`);
          }
          return dependencyId;
        }),
        color: topicInput.color,
        notes: topicInput.notes,
        order: topicIndex,
        blocks: topicInput.blocks.map((blockInput) => ({
          id: createId("block"),
          topicId,
          startDate: blockInput.startDate,
          endDate: blockInput.endDate,
          plannedUnits: blockInput.plannedUnits,
          source: blockInput.source,
        })),
      })),
    })),
  })) satisfies Plan[];

  const studyLog = document.studyLog.map((entry) => {
    const topicId = topicIdsByKey.get(entry.topicKey);
    if (!topicId) {
      throw new PlannerTransferError(`Missing validated topic key ${entry.topicKey}.`);
    }
    return {
      id: createId("log"),
      topicId,
      date: entry.date,
      units: entry.units,
      minutes: entry.minutes,
      note: entry.note,
    };
  });

  return { plans, studyLog };
}

export function exportFilename(date: string): string {
  return `study-planner-${date}.json`;
}
