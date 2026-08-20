/** Strict JSON parsing and version migration for planner transfer files. */

import { z } from "zod";
import { isValidIsoDate } from "@/domain/dates";
import {
  DEFAULT_COLOR_ID,
  isCourseColorId,
  resolveCourseColorId,
  type CourseColorId,
} from "@/domain/palette";
import { EXAM_KINDS, EXAM_STATUSES, PRIORITIES, TOPIC_STATUSES, UNITS } from "@/domain/types";
import {
  assertPlannerTransferIntegrity,
  EXPORT_VERSION,
  MAX_PLANNER_IMPORT_BYTES,
  MAX_PLANNER_IMPORT_MIB,
  PLANNER_TRANSFER_LIMITS,
  PLANNER_TOPIC_KEY_PATTERN,
  PlannerTransferError,
  type PlannerTransferDocument,
} from "./planner-transfer";

const limits = PLANNER_TRANSFER_LIMITS;

const requiredText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), "Must not have surrounding whitespace")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Must not contain control characters");
const freeText = (maximum: number) => z.string().max(maximum);
const topicKey = z
  .string()
  .min(1)
  .max(limits.topicKeyCharacters)
  .regex(PLANNER_TOPIC_KEY_PATTERN, "Must use only letters, numbers, underscores, or hyphens");
const isoDate = z
  .string()
  .refine(isValidIsoDate, "Must be a real date in YYYY-MM-DD format");
const finiteNumber = z
  .number({ error: "Must be a finite number" })
  .refine(Number.isFinite, "Must be a finite number");
const nonNegativeUnits = finiteNumber.min(0).max(limits.units);
const signedUnits = finiteNumber.min(-limits.units).max(limits.units);
const studyMinutes = finiteNumber.min(0).max(limits.minutes);
const canonicalColor = z.custom<CourseColorId>(
  (value) => typeof value === "string" && isCourseColorId(value),
  "Unknown course color",
);
const legacyColor = z
  .string()
  .max(limits.codeCharacters)
  .default(DEFAULT_COLOR_ID)
  .transform(resolveCourseColorId);

const blockSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    plannedUnits: nonNegativeUnits.optional(),
    source: z.enum(["auto", "manual"]),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.endDate < block.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date cannot be before the start date",
      });
    }
  });

const topicSchema = z
  .object({
    key: topicKey,
    name: requiredText(limits.nameCharacters),
    unit: z.enum(UNITS),
    totalUnits: nonNegativeUnits,
    completedUnits: nonNegativeUnits,
    status: z.enum(TOPIC_STATUSES),
    priority: z.enum(PRIORITIES),
    color: canonicalColor,
    notes: freeText(limits.notesCharacters),
    dependencies: z.array(topicKey).max(limits.dependencyIds),
    blocks: z.array(blockSchema).max(limits.importEntities),
  })
  .strict()
  .superRefine((topic, context) => {
    if (topic.totalUnits > 0 && topic.completedUnits > topic.totalUnits) {
      context.addIssue({
        code: "custom",
        path: ["completedUnits"],
        message: "Completed units cannot exceed the total",
      });
    }
  });

const examSchema = z
  .object({
    name: requiredText(limits.nameCharacters),
    kind: z.enum(EXAM_KINDS),
    startDate: isoDate,
    endDate: isoDate.optional(),
    status: z.enum(EXAM_STATUSES),
    notes: freeText(limits.notesCharacters),
  })
  .strict()
  .superRefine((exam, context) => {
    if (exam.endDate !== undefined && exam.endDate < exam.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date cannot be before the start date",
      });
    }
  });

const courseSchema = z
  .object({
    name: requiredText(limits.nameCharacters),
    code: requiredText(limits.codeCharacters).optional(),
    color: canonicalColor,
    notes: freeText(limits.notesCharacters),
    exams: z.array(examSchema).max(limits.importEntities),
    topics: z.array(topicSchema).max(limits.importEntities),
  })
  .strict();

const planSchema = z
  .object({
    name: requiredText(limits.nameCharacters),
    notes: freeText(limits.notesCharacters),
    courses: z.array(courseSchema).max(limits.importEntities),
  })
  .strict();

const logEntrySchema = z
  .object({
    topicKey,
    date: isoDate,
    units: signedUnits,
    minutes: studyMinutes.optional(),
    note: freeText(limits.logNoteCharacters).optional(),
  })
  .strict();

const plannerTransferSchema = z
  .object({
    version: z.literal(EXPORT_VERSION),
    exportedAt: freeText(64).optional(),
    plans: z.array(planSchema).max(limits.importPlans),
    studyLog: z.array(logEntrySchema).max(limits.importEntities),
  })
  .strict();

/* --------------------------------------------------------------- v2 input */

const legacyBlockSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    plannedUnits: nonNegativeUnits.optional(),
    source: z.enum(["auto", "manual"]).default("manual"),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.endDate < block.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date cannot be before the start date",
      });
    }
  });

const legacyTopicSchema = z
  .object({
    name: requiredText(limits.nameCharacters),
    section: freeText(limits.nameCharacters).optional(),
    unit: z.enum(UNITS).default("slides"),
    totalUnits: nonNegativeUnits.default(0),
    completedUnits: nonNegativeUnits.default(0),
    status: z.enum(TOPIC_STATUSES).default("planned"),
    priority: z.enum(PRIORITIES).default("normal"),
    color: legacyColor,
    notes: freeText(limits.notesCharacters).default(""),
    dependencies: z
      .array(requiredText(limits.nameCharacters))
      .max(limits.dependencyIds)
      .default([]),
    blocks: z.array(legacyBlockSchema).max(limits.importEntities).default([]),
  })
  .strict()
  .superRefine((topic, context) => {
    if (topic.totalUnits > 0 && topic.completedUnits > topic.totalUnits) {
      context.addIssue({
        code: "custom",
        path: ["completedUnits"],
        message: "Completed units cannot exceed the total",
      });
    }
  });

const legacyExamSchema = z
  .object({
    name: requiredText(limits.nameCharacters),
    kind: z.enum(EXAM_KINDS).default("exam"),
    startDate: isoDate,
    endDate: isoDate.optional(),
    status: z.enum(EXAM_STATUSES).default("confirmed"),
    notes: freeText(limits.notesCharacters).default(""),
  })
  .strict()
  .superRefine((exam, context) => {
    if (exam.endDate !== undefined && exam.endDate < exam.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date cannot be before the start date",
      });
    }
  });

const legacyCourseSchema = z
  .object({
    name: requiredText(limits.nameCharacters),
    code: requiredText(limits.codeCharacters).optional(),
    color: legacyColor,
    notes: freeText(limits.notesCharacters).default(""),
    exams: z.array(legacyExamSchema).max(limits.importEntities).default([]),
    topics: z.array(legacyTopicSchema).max(limits.importEntities).default([]),
  })
  .strict();

const legacyPlanSchema = z
  .object({
    name: requiredText(limits.nameCharacters),
    notes: freeText(limits.notesCharacters).default(""),
    courses: z.array(legacyCourseSchema).max(limits.importEntities).default([]),
  })
  .strict();

const legacyLogEntrySchema = z
  .object({
    courseName: requiredText(limits.nameCharacters),
    topicName: requiredText(limits.nameCharacters),
    date: isoDate,
    units: signedUnits,
    minutes: studyMinutes.optional(),
    note: freeText(limits.logNoteCharacters).optional(),
  })
  .strict();

const legacyDocumentSchema = z
  .object({
    version: z.literal(2),
    exportedAt: freeText(64).optional(),
    plans: z.array(legacyPlanSchema).max(limits.importPlans),
    studyLog: z.array(legacyLogEntrySchema).max(limits.importEntities).default([]),
  })
  .strict();

type LegacyDocument = z.infer<typeof legacyDocumentSchema>;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join(".");
  return path ? `${path}: ${issue.message}` : (issue?.message ?? "Not a planner transfer file");
}

function legacyPathKey(courseName: string, topicName: string): string {
  return JSON.stringify([courseName, topicName]);
}

function assertLegacyPathText(value: string, label: string): void {
  if (value.includes("\0")) {
    throw new ImportError(
      `Version 2 ${label} contains a NUL character and cannot be referenced unambiguously.`,
    );
  }
}

function canonicalizeLegacyDocument(legacy: LegacyDocument): PlannerTransferDocument {
  let nextTopicKey = 0;
  const pathCandidates = new Map<string, string[]>();

  const plans = legacy.plans.map((plan) => ({
    name: plan.name,
    notes: plan.notes,
    courses: plan.courses.map((course) => {
      assertLegacyPathText(course.name, "course name");
      const keyedTopics = course.topics.map((topic) => {
        assertLegacyPathText(topic.name, "topic name");
        const key = `topic_${(nextTopicKey++).toString(36)}`;
        const path = legacyPathKey(course.name, topic.name);
        pathCandidates.set(path, [...(pathCandidates.get(path) ?? []), key]);
        return { key, topic };
      });
      const keysByName = new Map<string, string[]>();
      for (const { key, topic } of keyedTopics) {
        keysByName.set(topic.name, [...(keysByName.get(topic.name) ?? []), key]);
      }

      return {
        name: course.name,
        code: course.code,
        color: course.color,
        notes: course.notes,
        exams: course.exams,
        topics: keyedTopics.map(({ key, topic }) => ({
          key,
          name: topic.name,
          unit: topic.unit,
          totalUnits: topic.totalUnits,
          completedUnits: topic.completedUnits,
          status: topic.status,
          priority: topic.priority,
          color: topic.color,
          notes: topic.notes,
          dependencies: topic.dependencies.map((dependencyName) => {
            const candidates = keysByName.get(dependencyName) ?? [];
            if (candidates.length === 0) {
              throw new ImportError(
                `Version 2 dependency ${dependencyName} does not name a topic in course ${course.name}.`,
              );
            }
            if (candidates.length > 1) {
              throw new ImportError(
                `Version 2 dependency ${dependencyName} is ambiguous in course ${course.name}.`,
              );
            }
            return candidates[0];
          }),
          blocks: topic.blocks,
        })),
      };
    }),
  }));

  const studyLog = legacy.studyLog.map((entry) => {
    assertLegacyPathText(entry.courseName, "log course name");
    assertLegacyPathText(entry.topicName, "log topic name");
    const candidates = pathCandidates.get(legacyPathKey(entry.courseName, entry.topicName)) ?? [];
    if (candidates.length === 0) {
      throw new ImportError(
        `Version 2 study log path ${entry.courseName} / ${entry.topicName} is missing.`,
      );
    }
    if (candidates.length > 1) {
      throw new ImportError(
        `Version 2 study log path ${entry.courseName} / ${entry.topicName} is ambiguous.`,
      );
    }
    return {
      topicKey: candidates[0],
      date: entry.date,
      units: entry.units,
      minutes: entry.minutes,
      note: entry.note,
    };
  });

  return {
    version: EXPORT_VERSION,
    exportedAt: legacy.exportedAt,
    plans,
    studyLog,
  };
}

function assertCanonicalIntegrity(document: PlannerTransferDocument): PlannerTransferDocument {
  try {
    assertPlannerTransferIntegrity(document);
    return document;
  } catch (cause) {
    if (cause instanceof PlannerTransferError) throw new ImportError(cause.message);
    throw cause;
  }
}

/** Parses v3 or safely upgrades an unambiguous v2 document to canonical v3. */
export function parsePlannerJson(contents: string): PlannerTransferDocument {
  if (new TextEncoder().encode(contents).byteLength > MAX_PLANNER_IMPORT_BYTES) {
    throw new ImportError(`Planner files must be ${MAX_PLANNER_IMPORT_MIB} MiB or smaller.`);
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new ImportError("That file is not valid JSON.");
  }

  const version = (json as { version?: unknown } | null)?.version;
  if (version !== 2 && version !== EXPORT_VERSION) {
    throw new ImportError(
      `Unsupported export version ${String(version)}. This build reads versions 2 and ${EXPORT_VERSION}.`,
    );
  }

  if (version === 2) {
    const result = legacyDocumentSchema.safeParse(json);
    if (!result.success) throw new ImportError(issueMessage(result.error));
    return assertCanonicalIntegrity(canonicalizeLegacyDocument(result.data));
  }

  const result = plannerTransferSchema.safeParse(json);
  if (!result.success) throw new ImportError(issueMessage(result.error));
  return assertCanonicalIntegrity(result.data);
}
