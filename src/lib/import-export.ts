/**
 * JSON portability.
 *
 * Version 2 of the export format, matching the workload-based domain model.
 * Version 1 (courses → topics → date ranges, with no notion of how much
 * material a topic held) is not readable: it carried no unit counts, so
 * anything reconstructed from it would have to invent sizes. Since v1 was never
 * reachable from the UI, no file in that format exists in the wild.
 *
 * Ids are deliberately absent from the format. Dependencies travel as topic
 * names, resolved per course on import, so a file can be imported into any
 * account without id collisions.
 */

import { z } from "zod";
import { DEFAULT_COLOR_ID, resolveCourseColorId } from "@/domain/palette";
import { EXAM_KINDS, EXAM_STATUSES, PRIORITIES, TOPIC_STATUSES, UNITS } from "@/domain/types";
import type { Plan, PlannerSnapshot } from "@/domain/types";

export const EXPORT_VERSION = 2;

const blockSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  plannedUnits: z.number().nonnegative().optional(),
  source: z.enum(["auto", "manual"]).default("manual"),
});

const topicSchema = z.object({
  name: z.string().min(1),
  // Accepted only so exports from older builds remain importable; the
  // transform removes the retired grouping before it reaches the domain.
  section: z.string().optional(),
  unit: z.enum(UNITS).default("slides"),
  totalUnits: z.number().nonnegative().default(0),
  completedUnits: z.number().nonnegative().default(0),
  status: z.enum(TOPIC_STATUSES).default("planned"),
  priority: z.enum(PRIORITIES).default("normal"),
  color: z.string().default(DEFAULT_COLOR_ID).transform(resolveCourseColorId),
  notes: z.string().default(""),
  dependencies: z.array(z.string()).default([]),
  blocks: z.array(blockSchema).default([]),
}).transform((topic) => {
  const legacyFreeTopic = { ...topic };
  delete legacyFreeTopic.section;
  return legacyFreeTopic;
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
  color: z.string().default(DEFAULT_COLOR_ID).transform(resolveCourseColorId),
  notes: z.string().default(""),
  exams: z.array(examSchema).default([]),
  topics: z.array(topicSchema).default([]),
});

const planSchema = z.object({
  name: z.string().min(1),
  notes: z.string().default(""),
  courses: z.array(courseSchema).default([]),
});

const logEntrySchema = z.object({
  courseName: z.string().min(1),
  topicName: z.string().min(1),
  date: z.string().min(1),
  units: z.number(),
  minutes: z.number().optional(),
  note: z.string().optional(),
});

const plannerExportSchema = z.object({
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string().optional(),
  plans: z.array(planSchema),
  studyLog: z.array(logEntrySchema).default([]),
});

export type PlannerExport = z.infer<typeof plannerExportSchema>;
export type ExportedPlan = z.infer<typeof planSchema>;
export type ExportedLogEntry = z.infer<typeof logEntrySchema>;

/**
 * `exportedAt` is passed in rather than read from the clock, so a round-trip
 * test can assert on the whole document.
 */
export function serializePlans(snapshot: PlannerSnapshot, exportedAt?: string): PlannerExport {
  const topicPaths = new Map<string, { courseName: string; topicName: string }>();
  for (const plan of snapshot.plans) {
    for (const course of plan.courses) {
      for (const topic of course.topics) {
        topicPaths.set(topic.id, { courseName: course.name, topicName: topic.name });
      }
    }
  }

  return {
    version: EXPORT_VERSION,
    exportedAt,
    plans: snapshot.plans.map((plan) => ({
      name: plan.name,
      notes: plan.notes,
      courses: plan.courses.map((course) => {
        const namesById = new Map(course.topics.map((topic) => [topic.id, topic.name]));
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
            name: topic.name,
            unit: topic.unit,
            totalUnits: topic.totalUnits,
            completedUnits: topic.completedUnits,
            status: topic.status,
            priority: topic.priority,
            color: resolveCourseColorId(topic.color),
            notes: topic.notes,
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
          courseName: path.courseName,
          topicName: path.topicName,
          date: entry.date,
          units: entry.units,
          minutes: entry.minutes,
          note: entry.note,
        },
      ];
    }),
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
        courses: planInput.courses.map((courseInput, courseIndex) => {
          const courseId = createId("course");
          const topicIdsByName = new Map<string, string>();

          const topics = courseInput.topics.map((topicInput, topicIndex) => {
            const topicId = createId("topic");
            topicIdsByName.set(topicInput.name, topicId);
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
              unit: topicInput.unit,
              totalUnits: topicInput.totalUnits,
              completedUnits: topicInput.completedUnits,
              status: topicInput.status,
              priority: topicInput.priority,
              dependencyIds: topicInput.dependencies
                .map((name) => topicIdsByName.get(name))
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
