/**
 * JSON portability.
 *
 * Version 2 of the export format, matching the workload-based domain model.
 * Version 1 (courses → topics → date ranges, with no notion of how much
 * material a topic held) is not readable: it carried no unit counts, so
 * anything reconstructed from it would have to invent sizes. Since v1 was never
 * reachable from the UI, no file in that format exists in the wild.
 *
 * Database ids are deliberately absent from the format. Export-local topic
 * refs preserve dependencies and study history even when names repeat, while
 * readable names remain in the document for people and early-v2 compatibility.
 */

import { z } from "zod";
import {
  EXAM_KINDS,
  EXAM_STATUSES,
  PRIORITIES,
  TOPIC_STATUSES,
  UNITS,
} from "@/domain/types";
import type { Plan, PlannerSnapshot } from "@/domain/types";

export const EXPORT_VERSION = 2;

const blockSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  plannedUnits: z.number().nonnegative().optional(),
  source: z.enum(["auto", "manual"]).default("manual"),
});

const topicSchema = z.object({
  /** Export-local identity. Unlike a name, this remains unique when lecture titles repeat. */
  ref: z.string().min(1).optional(),
  name: z.string().min(1),
  section: z.string().optional(),
  unit: z.enum(UNITS).default("slides"),
  totalUnits: z.number().nonnegative().default(0),
  completedUnits: z.number().nonnegative().default(0),
  status: z.enum(TOPIC_STATUSES).default("planned"),
  priority: z.enum(PRIORITIES).default("normal"),
  color: z.string().default("#007aff"),
  notes: z.string().default(""),
  /** Preferred dependency representation for files written by this build. */
  dependencyRefs: z.array(z.string()).optional(),
  /** Retained for readable files and compatibility with early version-2 exports. */
  dependencies: z.array(z.string()).default([]),
  blocks: z.array(blockSchema).default([]),
});

const examSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(EXAM_KINDS).default("exam"),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  status: z.enum(EXAM_STATUSES).default("confirmed"),
  notes: z.string().default(""),
});

const courseSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  color: z.string().default("#007aff"),
  notes: z.string().default(""),
  exams: z.array(examSchema).default([]),
  topics: z.array(topicSchema).default([]),
});

const planSchema = z.object({
  name: z.string().min(1),
  notes: z.string().default(""),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  courses: z.array(courseSchema).default([]),
});

const logEntrySchema = z.object({
  /** Preferred identity; names alone are ambiguous across repeated courses and topics. */
  topicRef: z.string().min(1).optional(),
  courseName: z.string().min(1),
  topicName: z.string().min(1),
  date: z.string().min(1),
  units: z.number(),
  minutes: z.number().optional(),
  note: z.string().optional(),
});

const preferencesSchema = z.object({
  dailyCapacityUnits: z.number().positive().optional(),
  studyDaysOfWeek: z.array(z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ])),
  blackoutDates: z.array(z.string()),
  theme: z.enum(["system", "light", "dark"]),
  accentColor: z.string().min(1),
});

export const plannerExportSchema = z
  .object({
    version: z.literal(EXPORT_VERSION),
    exportedAt: z.string().optional(),
    plans: z.array(planSchema),
    studyLog: z.array(logEntrySchema).default([]),
    preferences: preferencesSchema.optional(),
  })
  .superRefine((document, context) => {
    const refs = new Set<string>();
    for (const [planIndex, plan] of document.plans.entries()) {
      for (const [courseIndex, course] of plan.courses.entries()) {
        for (const [topicIndex, topic] of course.topics.entries()) {
          if (!topic.ref) continue;
          if (refs.has(topic.ref)) {
            context.addIssue({
              code: "custom",
              path: ["plans", planIndex, "courses", courseIndex, "topics", topicIndex, "ref"],
              message: `Duplicate topic reference ${topic.ref}`,
            });
          }
          refs.add(topic.ref);
        }
      }
    }

    for (const [entryIndex, entry] of document.studyLog.entries()) {
      if (entry.topicRef && !refs.has(entry.topicRef)) {
        context.addIssue({
          code: "custom",
          path: ["studyLog", entryIndex, "topicRef"],
          message: `Unknown topic reference ${entry.topicRef}`,
        });
      }
    }
  });

export type PlannerExport = z.infer<typeof plannerExportSchema>;
export type ExportedPlan = z.infer<typeof planSchema>;
export type ExportedLogEntry = z.infer<typeof logEntrySchema>;

/**
 * `exportedAt` is passed in rather than read from the clock, so a round-trip
 * test can assert on the whole document.
 */
export function serializePlans(snapshot: PlannerSnapshot, exportedAt?: string): PlannerExport {
  const topicPaths = new Map<
    string,
    { ref: string; courseName: string; topicName: string }
  >();
  for (const [planIndex, plan] of snapshot.plans.entries()) {
    for (const [courseIndex, course] of plan.courses.entries()) {
      for (const [topicIndex, topic] of course.topics.entries()) {
        topicPaths.set(topic.id, {
          ref: topicReference(planIndex, courseIndex, topicIndex),
          courseName: course.name,
          topicName: topic.name,
        });
      }
    }
  }

  return {
    version: EXPORT_VERSION,
    exportedAt,
    plans: snapshot.plans.map((plan, planIndex) => ({
      name: plan.name,
      notes: plan.notes,
      startDate: plan.startDate,
      endDate: plan.endDate,
      courses: plan.courses.map((course, courseIndex) => {
        const namesById = new Map(course.topics.map((topic) => [topic.id, topic.name]));
        const refsById = new Map(
          course.topics.map((topic, topicIndex) => [
            topic.id,
            topicReference(planIndex, courseIndex, topicIndex),
          ]),
        );
        return {
          name: course.name,
          code: course.code,
          color: course.color,
          notes: course.notes,
          exams: course.exams.map((exam) => ({
            name: exam.name,
            kind: exam.kind,
            startDate: exam.startDate,
            endDate: exam.endDate,
            status: exam.status,
            notes: exam.notes,
          })),
          topics: course.topics.map((topic, topicIndex) => ({
            ref: topicReference(planIndex, courseIndex, topicIndex),
            name: topic.name,
            section: topic.section,
            unit: topic.unit,
            totalUnits: topic.totalUnits,
            completedUnits: topic.completedUnits,
            status: topic.status,
            priority: topic.priority,
            color: topic.color,
            notes: topic.notes,
            dependencyRefs: topic.dependencyIds
              .map((id) => refsById.get(id))
              .filter((ref): ref is string => ref !== undefined),
            dependencies: topic.dependencyIds
              .map((id) => namesById.get(id))
              .filter((name): name is string => name !== undefined),
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
    studyLog: snapshot.studyLog.flatMap((entry) => {
      const path = topicPaths.get(entry.topicId);
      // An entry whose topic has been deleted has nothing to point at on
      // import; dropping it is better than emitting an unresolvable reference.
      if (!path) return [];
      return [
        {
          topicRef: path.ref,
          courseName: path.courseName,
          topicName: path.topicName,
          date: entry.date,
          units: entry.units,
          minutes: entry.minutes,
          note: entry.note,
        },
      ];
    }),
    preferences: snapshot.preferences,
  };
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Throws `ImportError` with a readable message rather than a raw Zod dump. */
export function parsePlannerJson(contents: string): PlannerExport {
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new ImportError("That file is not valid JSON.");
  }

  const version = (json as { version?: unknown })?.version;
  if (version !== undefined && version !== EXPORT_VERSION) {
    throw new ImportError(
      `Unsupported export version ${String(version)}. This build reads version ${EXPORT_VERSION}.`,
    );
  }

  const result = plannerExportSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".");
    throw new ImportError(
      path ? `${path}: ${issue.message}` : (issue?.message ?? "That file is not a planner export."),
    );
  }

  return result.data;
}

/**
 * Builds the in-memory representation of an imported file.
 *
 * Ids are generated by the caller so the same document can be materialised into
 * either repository — Convex assigns its own on insert.
 */
export function toPlans(
  document: PlannerExport,
  createId: (prefix: string) => string,
): Pick<PlannerSnapshot, "plans"> {
  return {
    plans: document.plans.map((planInput) => {
      const planId = createId("plan");
      return {
        id: planId,
        name: planInput.name,
        notes: planInput.notes,
        startDate: planInput.startDate,
        endDate: planInput.endDate,
        courses: planInput.courses.map((courseInput, courseIndex) => {
          const courseId = createId("course");
          const topicIdsByName = new Map<string, string>();
          const topicIdsByRef = new Map<string, string>();

          const topics = courseInput.topics.map((topicInput, topicIndex) => {
            const topicId = createId("topic");
            topicIdsByName.set(topicInput.name, topicId);
            if (topicInput.ref) topicIdsByRef.set(topicInput.ref, topicId);
            return { topicId, topicInput, topicIndex };
          });

          return {
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
            topics: topics.map(({ topicId, topicInput, topicIndex }) => ({
              id: topicId,
              courseId,
              name: topicInput.name,
              section: topicInput.section,
              unit: topicInput.unit,
              totalUnits: topicInput.totalUnits,
              completedUnits: topicInput.completedUnits,
              status: topicInput.status,
              priority: topicInput.priority,
              dependencyIds: (topicInput.dependencyRefs
                ? topicInput.dependencyRefs.map((ref) => topicIdsByRef.get(ref))
                : topicInput.dependencies.map((name) => topicIdsByName.get(name)))
                .filter((id): id is string => id !== undefined && id !== topicId),
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
          };
        }),
      } satisfies Plan;
    }),
  };
}

export function exportFilename(date: string): string {
  return `study-planner-${date}.json`;
}

function topicReference(planIndex: number, courseIndex: number, topicIndex: number): string {
  return `p${planIndex}:c${courseIndex}:t${topicIndex}`;
}
