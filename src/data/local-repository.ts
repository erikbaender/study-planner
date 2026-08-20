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
  EXAM_KINDS,
  EXAM_STATUSES,
  PRIORITIES,
  TOPIC_STATUSES,
  UNITS,
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
  PLANNER_LIMITS,
  requireAcyclic,
  requireAllowedValue,
  requireBoundedArray,
  requireBoundedText,
  requireCompleteReorder,
  requireDistinctBoundedArray,
  requireFiniteBoundedNumber,
  requireOrderedDates,
  requirePlannedUnits,
  requireTrimmedBoundedText,
  requireValidAutoBlockReplacement,
  requireValidDate,
  requireValidPreferences,
  requireValidProgress,
  requireValidScheduleApplication,
  ValidationError,
} from "@/domain/validation";
import {
  materializePlannerTransfer,
  type PlannerTransferDocument,
} from "@/lib/planner-transfer";
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
const BLOCK_SOURCES = ["auto", "manual"] as const;

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

      // A request can succeed before the surrounding transaction commits.
      // Resolving on `oncomplete` is what makes “saved before published” true
      // when the browser aborts late (for example after a quota failure).
      transaction.oncomplete = () => resolve(request.result);
      let requestError: DOMException | null = null;
      request.onerror = () => {
        requestError = request.error;
      };
      const rejectTransaction = () =>
        reject(
          transaction.error ?? requestError ?? new Error("Local database transaction failed"),
        );
      transaction.onerror = rejectTransaction;
      transaction.onabort = rejectTransaction;
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

function withReplacedAutoBlocks(
  snapshot: PlannerSnapshot,
  topicIds: readonly EntityId[],
  blocks: readonly GeneratedBlock[],
  createId: IdFactory,
): PlannerSnapshot {
  const scope = new Set(topicIds);
  const byTopic = new Map<EntityId, GeneratedBlock[]>();

  const scopedTopics = topicIds.map((topicId) => findTopic(snapshot, topicId).topic);
  const existingAutoBlocks = scopedTopics.reduce(
    (count, topic) => count + topic.blocks.filter((block) => block.source === "auto").length,
    0,
  );
  if (existingAutoBlocks > PLANNER_LIMITS.reflowBlocks) {
    throw new ValidationError("Existing generated schedule exceeds the replacement limit");
  }

  for (const block of blocks) {
    byTopic.set(block.topicId, [...(byTopic.get(block.topicId) ?? []), block]);
  }

  return {
    ...snapshot,
    plans: snapshot.plans.map((plan) => ({
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
  };
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
  let mutationQueue: Promise<void> = Promise.resolve();

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
   * next one, persist, then publish. Mutations are serialized so each update is
   * based on the last durable snapshot and a slower earlier save can never
   * overwrite a later one. A rejected save leaves `state` untouched; keeping
   * the queue itself fulfilled lets a later mutation retry normally.
   */
  const commit = (update: (snapshot: PlannerSnapshot) => PlannerSnapshot): Promise<void> => {
    const mutation = mutationQueue.then(async () => {
      await loaded;
      if (state.status !== "ready") {
        throw new ValidationError("The local database is not available");
      }

      const next = update(state.snapshot);
      await storage.save(next);
      publish({ status: "ready", snapshot: next });
    });

    mutationQueue = mutation.catch(() => undefined);
    return mutation;
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
        requireTrimmedBoundedText(
          input.name,
          "Plan name",
          PLANNER_LIMITS.nameCharacters,
        );
        requireBoundedText(
          input.notes ?? "",
          "Plan notes",
          PLANNER_LIMITS.notesCharacters,
        );
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
        requireTrimmedBoundedText(
          input.name,
          "Plan name",
          PLANNER_LIMITS.nameCharacters,
        );
        requireBoundedText(
          input.notes ?? "",
          "Plan notes",
          PLANNER_LIMITS.notesCharacters,
        );
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
        requireTrimmedBoundedText(
          input.name,
          "Course name",
          PLANNER_LIMITS.nameCharacters,
        );
        if (input.code !== undefined) {
          requireTrimmedBoundedText(
            input.code,
            "Course code",
            PLANNER_LIMITS.codeCharacters,
          );
        }
        requireBoundedText(
          input.notes ?? "",
          "Course notes",
          PLANNER_LIMITS.notesCharacters,
        );
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
      await commit((snapshot) => {
        requireTrimmedBoundedText(
          input.name,
          "Course name",
          PLANNER_LIMITS.nameCharacters,
        );
        if (input.code !== undefined) {
          requireTrimmedBoundedText(
            input.code,
            "Course code",
            PLANNER_LIMITS.codeCharacters,
          );
        }
        requireBoundedText(input.notes, "Course notes", PLANNER_LIMITS.notesCharacters);
        return withPlans(
          snapshot,
          mapCourse(snapshot, courseId, (course) => ({
            ...course,
            name: input.name,
            code: input.code,
            notes: input.notes,
            color: resolveCourseColorId(input.color),
          })),
        );
      });
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
            requireCompleteReorder(
              plan.courses.map((course) => course.id),
              courseIds,
              "Course ids",
            );
            const positions = new Map(courseIds.map((id, index) => [id, index]));
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
            requireCompleteReorder(
              course.topics.map((topic) => topic.id),
              topicIds,
              "Topic ids",
            );
            const positions = new Map(topicIds.map((id, index) => [id, index]));
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
        requireTrimmedBoundedText(
          input.name,
          "Exam name",
          PLANNER_LIMITS.nameCharacters,
        );
        requireBoundedText(
          input.notes ?? "",
          "Exam notes",
          PLANNER_LIMITS.notesCharacters,
        );
        requireOrderedDates(input.startDate, input.endDate);
        const kind = input.kind ?? "exam";
        const status = input.status ?? (input.endDate ? "provisional" : "confirmed");
        requireAllowedValue(kind, EXAM_KINDS, "Exam kind");
        requireAllowedValue(status, EXAM_STATUSES, "Exam status");
        const examId = createId("exam");
        const plans = mapCourse(snapshot, courseId, (course) => ({
          ...course,
          exams: [
            ...course.exams,
            {
              id: examId,
              courseId,
              name: input.name,
              kind,
              startDate: input.startDate,
              endDate: input.endDate,
              // An end date without an explicit status means a window was
              // given, which is exactly what "provisional" describes.
              status,
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
        requireTrimmedBoundedText(
          input.name,
          "Exam name",
          PLANNER_LIMITS.nameCharacters,
        );
        requireBoundedText(input.notes, "Exam notes", PLANNER_LIMITS.notesCharacters);
        requireOrderedDates(input.startDate, input.endDate);
        requireAllowedValue(input.kind, EXAM_KINDS, "Exam kind");
        requireAllowedValue(input.status, EXAM_STATUSES, "Exam status");
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
        requireTrimmedBoundedText(
          input.name,
          "Topic name",
          PLANNER_LIMITS.nameCharacters,
        );
        requireBoundedText(
          input.notes ?? "",
          "Topic notes",
          PLANNER_LIMITS.notesCharacters,
        );
        const totalUnits = input.totalUnits ?? 0;
        const unit = input.unit ?? "slides";
        const priority = input.priority ?? "normal";
        requireAllowedValue(unit, UNITS, "Topic unit");
        requireAllowedValue(priority, PRIORITIES, "Topic priority");
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
              unit,
              totalUnits,
              completedUnits: 0,
              status: "planned",
              priority,
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
        requireBoundedArray(topics, "Topics", PLANNER_LIMITS.bulkTopics);
        const created = topics.map((topic) => {
          requireTrimmedBoundedText(
            topic.name,
            "Topic name",
            PLANNER_LIMITS.nameCharacters,
          );
          requireAllowedValue(topic.unit, UNITS, "Topic unit");
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
        requireTrimmedBoundedText(
          patch.name,
          "Topic name",
          PLANNER_LIMITS.nameCharacters,
        );
        requireBoundedText(patch.notes, "Topic notes", PLANNER_LIMITS.notesCharacters);
        requireAllowedValue(patch.unit, UNITS, "Topic unit");
        requireAllowedValue(patch.status, TOPIC_STATUSES, "Topic status");
        requireAllowedValue(patch.priority, PRIORITIES, "Topic priority");
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
        requireDistinctBoundedArray(
          dependencyIds,
          "Dependency ids",
          PLANNER_LIMITS.dependencyIds,
        );
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
        requirePlannedUnits(input.plannedUnits);
        const source = input.source ?? "manual";
        requireAllowedValue(source, BLOCK_SOURCES, "Block source");
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
              source,
            } satisfies StudyBlock,
          ],
        }));
        return [withPlans(snapshot, plans), blockId];
      });
    },

    async updateStudyBlock(blockId, input) {
      await commit((snapshot) => {
        requireOrderedDates(input.startDate, input.endDate);
        requirePlannedUnits(input.plannedUnits);
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
        requireValidAutoBlockReplacement(topicIds, blocks);
        return withReplacedAutoBlocks(snapshot, topicIds, blocks, createId);
      });
    },

    async applySchedule(topicIds, blocks, preferences) {
      await commit((snapshot) => {
        const nextPreferences = { ...DEFAULT_PREFERENCES, ...preferences };
        requireValidScheduleApplication(topicIds, blocks, nextPreferences);
        return {
          ...withReplacedAutoBlocks(snapshot, topicIds, blocks, createId),
          preferences: nextPreferences,
        };
      });
    },

    /* --------------------------------------------------------- study log */

    async logStudy(input: StudyLogInput) {
      await commit((snapshot) => {
        const { topic } = findTopic(snapshot, input.topicId);
        requireValidDate(input.date, "Study date");
        requireFiniteBoundedNumber(input.units, "Units", {
          minimum: -PLANNER_LIMITS.units,
          maximum: PLANNER_LIMITS.units,
        });
        if (input.minutes !== undefined) {
          requireFiniteBoundedNumber(input.minutes, "Minutes", {
            minimum: 0,
            maximum: PLANNER_LIMITS.minutes,
          });
        }
        if (input.note !== undefined) {
          requireBoundedText(input.note, "Study note", PLANNER_LIMITS.logNoteCharacters);
        }
        const raw = topic.completedUnits + input.units;
        const completedUnits = Math.max(
          0,
          topic.totalUnits > 0 ? Math.min(topic.totalUnits, raw) : raw,
        );
        requireValidProgress(completedUnits, topic.totalUnits);

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
      await commit((snapshot) => {
        const nextPreferences = { ...DEFAULT_PREFERENCES, ...preferences };
        requireValidPreferences(nextPreferences);
        return { ...snapshot, preferences: nextPreferences };
      });
    },

    /* ----------------------------------------------------- import / seed */

    async importPlans(document: PlannerTransferDocument) {
      await commit((snapshot) => {
        const imported = materializePlannerTransfer(document, createId);
        return {
          ...snapshot,
          plans: [...snapshot.plans, ...imported.plans],
          studyLog: [...snapshot.studyLog, ...imported.studyLog].sort((left, right) =>
            left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
          ),
        };
      });
    },

    async replaceAll(document: PlannerTransferDocument) {
      await commit((snapshot) => {
        const imported = materializePlannerTransfer(document, createId);

        return {
          plans: imported.plans,
          studyLog: imported.studyLog,
          preferences: snapshot.preferences,
        };
      });
    },
  };
}
