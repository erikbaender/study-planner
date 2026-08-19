/**
 * Local-only repository, backed by IndexedDB.
 *
 * The whole snapshot is stored as a single record rather than one object store
 * per entity. For this app's shape — a semester is on the order of ten courses,
 * a few hundred topics and a few thousand log entries, so a few hundred
 * kilobytes of JSON — a whole-snapshot write costs a millisecond or two and
 * buys atomicity across the tree for free. Normalised stores would only start
 * to pay off an order of magnitude further up.
 *
 * Updates are immutable along the path that changed and reuse every untouched
 * sibling, so `React.memo` on a course row does what it looks like it does.
 */

import {
  DEFAULT_PREFERENCES,
  EMPTY_SNAPSHOT,
  type Course,
  type EntityId,
  type Exam,
  type Plan,
  type PlannerSnapshot,
  type Preferences,
  type StudyBlock,
  type StudyLogEntry,
  type Topic,
} from "@/domain/types";
import { resolveCourseColorId } from "@/domain/palette";
import {
  buildDependencyGraph,
  requireAcyclic,
  requireOrderedDates,
  requireValidProgress,
  ValidationError,
} from "@/domain/validation";
import { toPlans, type PlannerExport } from "@/lib/import-export";
import { createId as defaultCreateId, type IdFactory } from "./ids";
import type {
  CourseInput,
  ExamInput,
  GeneratedBlock,
  PlannerRepository,
  PlanInput,
  RepositoryState,
  StudyBlockInput,
  StudyLogInput,
  TopicInput,
  TopicPatch,
} from "./repository";

/* ---------------------------------------------------------------- storage */

export interface SnapshotStorage {
  load(): Promise<PlannerSnapshot | null>;
  save(snapshot: PlannerSnapshot): Promise<void>;
}

const DB_NAME = "study-planner";
const DB_VERSION = 1;
const STORE = "snapshot";
const KEY = "current";

export function indexedDbStorage(): SnapshotStorage {
  let handle: Promise<IDBDatabase> | null = null;

  const open = () => {
    handle ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open the local database"));
    });
    return handle;
  };

  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Local database write failed"));
    });
  };

  return {
    async load() {
      const value = await run<PlannerSnapshot | undefined>("readonly", (store) => store.get(KEY));
      return value ?? null;
    },
    async save(snapshot) {
      await run("readwrite", (store) => store.put(snapshot, KEY));
    },
  };
}

/** For tests and for server rendering, where `indexedDB` does not exist. */
export function memoryStorage(initial: PlannerSnapshot | null = null): SnapshotStorage {
  let value = initial;
  return {
    async load() {
      return value;
    },
    async save(snapshot) {
      value = snapshot;
    },
  };
}

/**
 * IndexedDB in the browser, memory everywhere else. The fallback matters
 * because this module is reached during server rendering, where touching
 * `indexedDB` is a ReferenceError rather than a missing feature.
 */
export function defaultStorage(): SnapshotStorage {
  return typeof indexedDB === "undefined" ? memoryStorage() : indexedDbStorage();
}

/* ------------------------------------------------------------ tree lookups */

/** Mirrors `nextOrder` in `convex/planner.ts`: max + 1, never `length`. */
function nextOrder(siblings: ReadonlyArray<{ order: number }>): number {
  return siblings.reduce((highest, sibling) => Math.max(highest, sibling.order + 1), 0);
}

function findCourse(snapshot: PlannerSnapshot, courseId: EntityId): Course {
  for (const plan of snapshot.plans) {
    const course = plan.courses.find((candidate) => candidate.id === courseId);
    if (course) return course;
  }
  throw new ValidationError("Course not found");
}

function findTopic(snapshot: PlannerSnapshot, topicId: EntityId): { course: Course; topic: Topic } {
  for (const plan of snapshot.plans) {
    for (const course of plan.courses) {
      const topic = course.topics.find((candidate) => candidate.id === topicId);
      if (topic) return { course, topic };
    }
  }
  throw new ValidationError("Topic not found");
}

function findBlock(snapshot: PlannerSnapshot, blockId: EntityId): { topic: Topic; block: StudyBlock } {
  for (const plan of snapshot.plans) {
    for (const course of plan.courses) {
      for (const topic of course.topics) {
        const block = topic.blocks.find((candidate) => candidate.id === blockId);
        if (block) return { topic, block };
      }
    }
  }
  throw new ValidationError("Study block not found");
}

/* ------------------------------------------------------- immutable updates */

function mapPlan(snapshot: PlannerSnapshot, planId: EntityId, fn: (plan: Plan) => Plan): Plan[] {
  let found = false;
  const plans = snapshot.plans.map((plan) => {
    if (plan.id !== planId) return plan;
    found = true;
    return fn(plan);
  });
  if (!found) throw new ValidationError("Plan not found");
  return plans;
}

function mapCourse(snapshot: PlannerSnapshot, courseId: EntityId, fn: (course: Course) => Course): Plan[] {
  let found = false;
  const plans = snapshot.plans.map((plan) => {
    if (!plan.courses.some((course) => course.id === courseId)) return plan;
    found = true;
    return {
      ...plan,
      courses: plan.courses.map((course) => (course.id === courseId ? fn(course) : course)),
    };
  });
  if (!found) throw new ValidationError("Course not found");
  return plans;
}

function mapTopic(snapshot: PlannerSnapshot, topicId: EntityId, fn: (topic: Topic) => Topic): Plan[] {
  const { course } = findTopic(snapshot, topicId);
  return mapCourse(snapshot, course.id, (current) => ({
    ...current,
    topics: current.topics.map((topic) => (topic.id === topicId ? fn(topic) : topic)),
  }));
}

/* ------------------------------------------------------------- repository */

function normalizeSnapshotColors(snapshot: PlannerSnapshot): PlannerSnapshot {
  let changed = false;
  const plans = snapshot.plans.map((plan) => ({
    ...plan,
    courses: plan.courses.map((course) => {
      const color = resolveCourseColorId(course.color);
      const topics = course.topics.map((topic) => {
        const topicColor = resolveCourseColorId(topic.color);
        if (topicColor === topic.color) return topic;
        changed = true;
        return { ...topic, color: topicColor };
      });
      if (color === course.color && topics.every((topic, index) => topic === course.topics[index])) {
        return course;
      }
      changed = true;
      return { ...course, color, topics };
    }),
  }));
  return changed ? { ...snapshot, plans } : snapshot;
}

export type LocalRepositoryOptions = {
  storage?: SnapshotStorage;
  createId?: IdFactory;
};

export function createLocalRepository(options: LocalRepositoryOptions = {}): PlannerRepository {
  const storage = options.storage ?? defaultStorage();
  const createId = options.createId ?? defaultCreateId;

  let state: RepositoryState = { status: "loading" };
  const listeners = new Set<(state: RepositoryState) => void>();

  const publish = (next: RepositoryState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  const loaded = storage
    .load()
    .then(async (snapshot) => {
      const loadedSnapshot = snapshot ?? EMPTY_SNAPSHOT;
      const normalized = normalizeSnapshotColors(loadedSnapshot);
      if (normalized !== loadedSnapshot) await storage.save(normalized);
      publish({ status: "ready", snapshot: normalized });
    })
    .catch((error: unknown) =>
      publish({
        status: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    );

  /**
   * Every mutation funnels through here: read the current snapshot, compute the
   * next one, publish, persist. Publishing before the write lands keeps the UI
   * responsive; a failed write surfaces as an error state rather than silently
   * diverging from what is on screen.
   */
  const commit = async (update: (snapshot: PlannerSnapshot) => PlannerSnapshot) => {
    await loaded;
    if (state.status !== "ready") {
      throw new ValidationError("The local database is not available");
    }
    const next = update(state.snapshot);
    publish({ status: "ready", snapshot: next });
    await storage.save(next);
  };

  /** `commit`, for the mutations that also have to return a freshly-made id. */
  const commitWithId = async <T>(update: (snapshot: PlannerSnapshot) => [PlannerSnapshot, T]) => {
    let result!: T;
    await commit((snapshot) => {
      const [next, value] = update(snapshot);
      result = value;
      return next;
    });
    return result;
  };

  const withPlans = (snapshot: PlannerSnapshot, plans: Plan[]): PlannerSnapshot => ({
    ...snapshot,
    plans,
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    /* ------------------------------------------------------------- plans */

    createPlan(input: PlanInput) {
      return commitWithId((snapshot) => {
        const plan: Plan = {
          id: createId("plan"),
          name: input.name,
          notes: input.notes ?? "",
          courses: [],
        };
        return [withPlans(snapshot, [...snapshot.plans, plan]), plan.id];
      });
    },

    async updatePlan(planId, input) {
      await commit((snapshot) => {
        return withPlans(
          snapshot,
          mapPlan(snapshot, planId, (plan) => ({
            ...plan,
            name: input.name,
            notes: input.notes ?? "",
          })),
        );
      });
    },

    async deletePlan(planId) {
      await commit((snapshot) => {
        const plan = snapshot.plans.find((candidate) => candidate.id === planId);
        if (!plan) throw new ValidationError("Plan not found");
        const orphaned = new Set(
          plan.courses.flatMap((course) => course.topics.map((topic) => topic.id)),
        );
        return {
          ...snapshot,
          plans: snapshot.plans.filter((candidate) => candidate.id !== planId),
          studyLog: snapshot.studyLog.filter((entry) => !orphaned.has(entry.topicId)),
        };
      });
    },

    /* ----------------------------------------------------------- courses */

    createCourse(planId, input: CourseInput) {
      return commitWithId((snapshot) => {
        const courseId = createId("course");
        const plans = mapPlan(snapshot, planId, (plan) => ({
          ...plan,
          courses: [
            ...plan.courses,
            {
              id: courseId,
              planId,
              name: input.name,
              code: input.code,
              color: resolveCourseColorId(input.color),
              notes: input.notes ?? "",
              order: nextOrder(plan.courses),
              exams: [],
              topics: [],
            } satisfies Course,
          ],
        }));
        return [withPlans(snapshot, plans), courseId];
      });
    },

    async updateCourse(courseId, input) {
      await commit((snapshot) =>
        withPlans(
          snapshot,
          mapCourse(snapshot, courseId, (course) => ({
            ...course,
            name: input.name,
            code: input.code,
            notes: input.notes,
            color: resolveCourseColorId(input.color),
          })),
        ),
      );
    },

    async deleteCourse(courseId) {
      await commit((snapshot) => {
        const course = findCourse(snapshot, courseId);
        const orphaned = new Set(course.topics.map((topic) => topic.id));
        return {
          ...snapshot,
          plans: snapshot.plans.map((plan) =>
            plan.courses.some((candidate) => candidate.id === courseId)
              ? {
                  ...plan,
                  courses: plan.courses.filter((candidate) => candidate.id !== courseId),
                }
              : plan,
          ),
          studyLog: snapshot.studyLog.filter((entry) => !orphaned.has(entry.topicId)),
        };
      });
    },

    async reorderCourses(planId, courseIds) {
      await commit((snapshot) =>
        withPlans(
          snapshot,
          mapPlan(snapshot, planId, (plan) => {
            const positions = new Map(courseIds.map((id, index) => [id, index]));
            if (positions.size !== plan.courses.length) {
              throw new ValidationError("Reorder must list every course in the plan exactly once");
            }
            return {
              ...plan,
              courses: [...plan.courses]
                .map((course) => {
                  const order = positions.get(course.id);
                  if (order === undefined) {
                    throw new ValidationError("Course does not belong to that plan");
                  }
                  return { ...course, order };
                })
                .sort((left, right) => left.order - right.order),
            };
          }),
        ),
      );
    },

    async reorderTopics(courseId, topicIds) {
      await commit((snapshot) =>
        withPlans(
          snapshot,
          mapCourse(snapshot, courseId, (course) => {
            const positions = new Map(topicIds.map((id, index) => [id, index]));
            // The whole course, or nothing. A partial list would leave two
            // topics claiming the same position, and the order they then render
            // in would depend on the sort's stability rather than on anything
            // the user asked for.
            if (positions.size !== course.topics.length) {
              throw new ValidationError("Reorder must list every topic in the course exactly once");
            }
            return {
              ...course,
              topics: [...course.topics]
                .map((topic) => {
                  const order = positions.get(topic.id);
                  if (order === undefined) {
                    throw new ValidationError("Topic does not belong to that course");
                  }
                  return { ...topic, order };
                })
                .sort((left, right) => left.order - right.order),
            };
          }),
        ),
      );
    },

    /* ------------------------------------------------------------- exams */

    createExam(courseId, input: ExamInput) {
      return commitWithId((snapshot) => {
        if (input.endDate) requireOrderedDates(input.startDate, input.endDate);
        const examId = createId("exam");
        const plans = mapCourse(snapshot, courseId, (course) => ({
          ...course,
          exams: [
            ...course.exams,
            {
              id: examId,
              courseId,
              name: input.name,
              kind: input.kind ?? "exam",
              startDate: input.startDate,
              endDate: input.endDate,
              // An end date without an explicit status means a window was
              // given, which is exactly what "provisional" describes.
              status: input.status ?? (input.endDate ? "provisional" : "confirmed"),
              notes: input.notes ?? "",
              order: nextOrder(course.exams),
            } satisfies Exam,
          ],
        }));
        return [withPlans(snapshot, plans), examId];
      });
    },

    async updateExam(examId, input) {
      await commit((snapshot) => {
        if (input.endDate) requireOrderedDates(input.startDate, input.endDate);
        const course = snapshot.plans
          .flatMap((plan) => plan.courses)
          .find((candidate) => candidate.exams.some((exam) => exam.id === examId));
        if (!course) throw new ValidationError("Exam not found");

        return withPlans(
          snapshot,
          mapCourse(snapshot, course.id, (current) => ({
            ...current,
            exams: current.exams.map((exam) =>
              exam.id === examId
                ? {
                    ...exam,
                    name: input.name,
                    kind: input.kind,
                    startDate: input.startDate,
                    endDate: input.endDate,
                    status: input.status,
                    notes: input.notes,
                  }
                : exam,
            ),
          })),
        );
      });
    },

    async deleteExam(examId) {
      await commit((snapshot) => {
        const course = snapshot.plans
          .flatMap((plan) => plan.courses)
          .find((candidate) => candidate.exams.some((exam) => exam.id === examId));
        if (!course) throw new ValidationError("Exam not found");

        return withPlans(
          snapshot,
          mapCourse(snapshot, course.id, (current) => ({
            ...current,
            exams: current.exams.filter((exam) => exam.id !== examId),
          })),
        );
      });
    },

    /* ------------------------------------------------------------ topics */

    createTopic(courseId, input: TopicInput) {
      return commitWithId((snapshot) => {
        const totalUnits = input.totalUnits ?? 0;
        requireValidProgress(0, totalUnits);
        const topicId = createId("topic");
        const plans = mapCourse(snapshot, courseId, (course) => ({
          ...course,
          topics: [
            ...course.topics,
            {
              id: topicId,
              courseId,
              name: input.name,
              unit: input.unit ?? "slides",
              totalUnits,
              completedUnits: 0,
              status: "planned",
              priority: input.priority ?? "normal",
              dependencyIds: [],
              color: resolveCourseColorId(input.color),
              notes: input.notes ?? "",
              order: nextOrder(course.topics),
              blocks: [],
            } satisfies Topic,
          ],
        }));
        return [withPlans(snapshot, plans), topicId];
      });
    },

    createTopics(courseId, topics, color) {
      return commitWithId((snapshot) => {
        const created = topics.map((topic) => {
          requireValidProgress(0, topic.totalUnits);
          return { ...topic, id: createId("topic") };
        });
        const plans = mapCourse(snapshot, courseId, (course) => ({
          ...course,
          topics: [
            ...course.topics,
            ...created.map(
              (topic, index): Topic => ({
                id: topic.id,
                courseId,
                name: topic.name,
                unit: topic.unit,
                totalUnits: topic.totalUnits,
                completedUnits: 0,
                status: "planned",
                priority: "normal",
                dependencyIds: [],
                color: resolveCourseColorId(color),
                notes: "",
                order: nextOrder(course.topics) + index,
                blocks: [],
              }),
            ),
          ],
        }));
        return [withPlans(snapshot, plans), created.map((topic) => topic.id)];
      });
    },

    async updateTopic(topicId, patch: TopicPatch) {
      await commit((snapshot) => {
        requireValidProgress(patch.completedUnits, patch.totalUnits);
        return withPlans(
          snapshot,
          mapTopic(snapshot, topicId, (topic) => ({
            ...topic,
            ...patch,
            color: resolveCourseColorId(patch.color),
          })),
        );
      });
    },

    async moveTopic(topicId, courseId) {
      await commit((snapshot) => {
        const { course: oldCourse, topic } = findTopic(snapshot, topicId);
        const targetCourse = findCourse(snapshot, courseId);
        if (oldCourse.id === targetCourse.id) return snapshot;
        if (oldCourse.planId !== targetCourse.planId) {
          throw new ValidationError("A topic can only move within its plan");
        }

        const inheritedColor = resolveCourseColorId(topic.color) === resolveCourseColorId(oldCourse.color);
        return withPlans(
          snapshot,
          snapshot.plans.map((plan) => ({
            ...plan,
            courses: plan.courses.map((course) => {
              if (course.id === oldCourse.id) {
                return {
                  ...course,
                  topics: course.topics
                    .filter((candidate) => candidate.id !== topicId)
                    .map((candidate) =>
                      candidate.dependencyIds.includes(topicId)
                        ? {
                            ...candidate,
                            dependencyIds: candidate.dependencyIds.filter((id) => id !== topicId),
                          }
                        : candidate,
                    ),
                };
              }
              if (course.id === targetCourse.id) {
                return {
                  ...course,
                  topics: [
                    ...course.topics,
                    {
                      ...topic,
                      courseId: targetCourse.id,
                      order: nextOrder(course.topics),
                      // A topic with an inherited tint should follow its new
                      // course; a deliberately chosen tint is its own fact and
                      // must survive the move. Dependencies are course-local,
                      // so they are cleared while old references are removed.
                      color: inheritedColor ? resolveCourseColorId(targetCourse.color) : topic.color,
                      dependencyIds: [],
                    },
                  ],
                };
              }
              return course;
            }),
          })),
        );
      });
    },

    async deleteTopic(topicId) {
      await commit((snapshot) => {
        const { course } = findTopic(snapshot, topicId);
        return {
          ...snapshot,
          plans: mapCourse(snapshot, course.id, (current) => ({
            ...current,
            topics: current.topics
              .filter((topic) => topic.id !== topicId)
              // Strip the deleted topic from anything that depended on it —
              // otherwise the survivors keep an id that no longer resolves.
              .map((topic) =>
                topic.dependencyIds.includes(topicId)
                  ? {
                      ...topic,
                      dependencyIds: topic.dependencyIds.filter((id) => id !== topicId),
                    }
                  : topic,
              ),
          })),
          studyLog: snapshot.studyLog.filter((entry) => entry.topicId !== topicId),
        };
      });
    },

    async setTopicDependencies(topicId, dependencyIds) {
      await commit((snapshot) => {
        const { course } = findTopic(snapshot, topicId);
        const siblingIds = new Set(course.topics.map((topic) => topic.id));
        if (dependencyIds.some((id) => !siblingIds.has(id))) {
          throw new ValidationError("Dependencies must be topics in the same course");
        }
        if (dependencyIds.includes(topicId)) {
          throw new ValidationError("A topic cannot depend on itself", "dependencyIds");
        }
        requireAcyclic(buildDependencyGraph(course.topics), topicId, dependencyIds);

        return withPlans(
          snapshot,
          mapTopic(snapshot, topicId, (topic) => ({ ...topic, dependencyIds: [...dependencyIds] })),
        );
      });
    },

    /* ------------------------------------------------------- study blocks */

    createStudyBlock(input: StudyBlockInput) {
      return commitWithId((snapshot) => {
        requireOrderedDates(input.startDate, input.endDate);
        const blockId = createId("block");
        const plans = mapTopic(snapshot, input.topicId, (topic) => ({
          ...topic,
          blocks: [
            ...topic.blocks,
            {
              id: blockId,
              topicId: input.topicId,
              startDate: input.startDate,
              endDate: input.endDate,
              plannedUnits: input.plannedUnits,
              // Anything created without an explicit source came from a gesture.
              source: input.source ?? "manual",
            } satisfies StudyBlock,
          ],
        }));
        return [withPlans(snapshot, plans), blockId];
      });
    },

    async updateStudyBlock(blockId, input) {
      await commit((snapshot) => {
        requireOrderedDates(input.startDate, input.endDate);
        const { topic } = findBlock(snapshot, blockId);
        return withPlans(
          snapshot,
          mapTopic(snapshot, topic.id, (current) => ({
            ...current,
            blocks: current.blocks.map((block) =>
              block.id === blockId
                ? {
                    ...block,
                    startDate: input.startDate,
                    endDate: input.endDate,
                    plannedUnits: input.plannedUnits ?? block.plannedUnits,
                    // Dragging a generated block adopts it: the next reflow must
                    // not undo a placement the user made deliberately.
                    source: "manual" as const,
                  }
                : block,
            ),
          })),
        );
      });
    },

    async deleteStudyBlock(blockId) {
      await commit((snapshot) => {
        const { topic } = findBlock(snapshot, blockId);
        return withPlans(
          snapshot,
          mapTopic(snapshot, topic.id, (current) => ({
            ...current,
            blocks: current.blocks.filter((block) => block.id !== blockId),
          })),
        );
      });
    },

    async replaceAutoBlocks(topicIds, blocks: GeneratedBlock[]) {
      await commit((snapshot) => {
        const scope = new Set(topicIds);
        const byTopic = new Map<EntityId, GeneratedBlock[]>();
        for (const block of blocks) {
          if (!scope.has(block.topicId)) {
            throw new ValidationError("Cannot write blocks for a topic outside the reflow scope");
          }
          requireOrderedDates(block.startDate, block.endDate);
          byTopic.set(block.topicId, [...(byTopic.get(block.topicId) ?? []), block]);
        }

        return withPlans(
          snapshot,
          snapshot.plans.map((plan) => ({
            ...plan,
            courses: plan.courses.map((course) =>
              course.topics.some((topic) => scope.has(topic.id))
                ? {
                    ...course,
                    topics: course.topics.map((topic) =>
                      scope.has(topic.id)
                        ? {
                            ...topic,
                            blocks: [
                              ...topic.blocks.filter((block) => block.source === "manual"),
                              ...(byTopic.get(topic.id) ?? []).map(
                                (block): StudyBlock => ({
                                  id: createId("block"),
                                  topicId: topic.id,
                                  startDate: block.startDate,
                                  endDate: block.endDate,
                                  plannedUnits: block.plannedUnits,
                                  source: "auto",
                                }),
                              ),
                            ],
                          }
                        : topic,
                    ),
                  }
                : course,
            ),
          })),
        );
      });
    },

    /* --------------------------------------------------------- study log */

    async logStudy(input: StudyLogInput) {
      await commit((snapshot) => {
        if (!Number.isFinite(input.units)) {
          throw new ValidationError("Units must be a number", "units");
        }
        const { topic } = findTopic(snapshot, input.topicId);
        const raw = topic.completedUnits + input.units;
        const completedUnits = Math.max(
          0,
          topic.totalUnits > 0 ? Math.min(topic.totalUnits, raw) : raw,
        );

        const entry: StudyLogEntry = {
          id: createId("log"),
          topicId: input.topicId,
          date: input.date,
          units: input.units,
          minutes: input.minutes,
          note: input.note,
        };

        return {
          ...snapshot,
          plans: mapTopic(snapshot, input.topicId, (current) => ({
            ...current,
            completedUnits,
            status:
              current.totalUnits > 0 && completedUnits >= current.totalUnits
                ? "done"
                : completedUnits > 0
                  ? "active"
                  : "planned",
          })),
          studyLog: [...snapshot.studyLog, entry].sort((left, right) =>
            left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
          ),
        };
      });
    },

    /* ------------------------------------------------------- preferences */

    async savePreferences(preferences: Preferences) {
      await commit((snapshot) => ({
        ...snapshot,
        preferences: { ...DEFAULT_PREFERENCES, ...preferences },
      }));
    },

    /* ----------------------------------------------------- import / seed */

    async importPlans(document: PlannerExport) {
      await commit((snapshot) => {
        const { plans } = toPlans(document, createId);
        return withPlans(snapshot, [...snapshot.plans, ...plans]);
      });
    },

    async replaceAll(document: PlannerExport) {
      await commit((snapshot) => {
        const { plans } = toPlans(document, createId);

        // Log entries reference their topic by course and topic name, because
        // ids do not exist until the document has been materialised.
        const topicIdsByPath = new Map<string, EntityId>();
        for (const plan of plans) {
          for (const course of plan.courses) {
            for (const topic of course.topics) {
              topicIdsByPath.set(`${course.name}\0${topic.name}`, topic.id);
            }
          }
        }

        return {
          plans,
          studyLog: document.studyLog.flatMap((entry): StudyLogEntry[] => {
            const topicId = topicIdsByPath.get(`${entry.courseName}\0${entry.topicName}`);
            // Skipped rather than thrown: an entry pointing at a topic that is
            // not in the document is stale data, not a reason to fail the seed.
            if (!topicId) return [];
            return [
              {
                id: createId("log"),
                topicId,
                date: entry.date,
                units: entry.units,
                minutes: entry.minutes,
                note: entry.note,
              },
            ];
          }),
          preferences: snapshot.preferences,
        };
      });
    },
  };
}
