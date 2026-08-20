import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  serializePlans,
  type PlannerTransferDocument,
} from "@/lib/planner-transfer";
import { sequentialIdFactory } from "./ids";
import {
  createLocalRepository,
  memoryStorage,
  type SnapshotStorage,
} from "./local-repository";
import type { PlannerRepository, RepositoryState } from "./repository";
import { generateSeedData } from "@/domain/seed";
import { DEFAULT_PREFERENCES, type PlannerSnapshot } from "@/domain/types";
import { PLANNER_LIMITS } from "@/domain/validation";

const TODAY = "2026-07-29";

function setup(storage: SnapshotStorage = memoryStorage()) {
  const repository = createLocalRepository({ storage, createId: sequentialIdFactory() });
  return { repository, storage };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * The snapshot, once the repository has settled.
 *
 * A freshly constructed repository is still `loading` when `subscribe` first
 * calls back — the initial read resolves a microtask later — so this waits for
 * the first non-loading state rather than sampling synchronously.
 */
async function read(repository: PlannerRepository): Promise<PlannerSnapshot> {
  let unsubscribe: (() => void) | undefined;
  const state = await new Promise<RepositoryState>((resolve) => {
    unsubscribe = repository.subscribe((next) => {
      if (next.status !== "loading") resolve(next);
    });
  });
  unsubscribe?.();

  if (state.status !== "ready") {
    throw new Error(`Repository is ${state.status}`);
  }
  return state.snapshot;
}

/** A plan with one course, ready for whatever the test is actually about. */
async function withCourse(repository: PlannerRepository) {
  const planId = await repository.createPlan({ name: "Winter semester" });
  const courseId = await repository.createCourse(planId, { name: "Biochemistry", color: "#ff0000" });
  return { planId, courseId };
}

describe("subscription", () => {
  it("calls the listener immediately, before anything is loaded", () => {
    const { repository } = setup();
    const listener = vi.fn();
    repository.subscribe(listener);
    // Loading is a distinct state from an empty snapshot: showing "you have no
    // plans yet, here is how to make one" during startup was an audit finding.
    expect(listener).toHaveBeenCalledWith({ status: "loading" });
  });

  it("publishes the loaded snapshot, then every change", async () => {
    const { repository } = setup();
    const states: RepositoryState[] = [];
    repository.subscribe((state) => states.push(state));

    await repository.createPlan({ name: "Winter semester" });

    expect(states.map((state) => state.status)).toEqual(["loading", "ready", "ready"]);
    expect((states.at(-1) as { snapshot: PlannerSnapshot }).snapshot.plans).toHaveLength(1);
  });

  it("rewrites legacy colour values to stable palette references on load", async () => {
    const seeded = generateSeedData({ today: TODAY, courseLimit: 1 });
    const legacy: PlannerSnapshot = {
      plans: [
        {
          ...seeded.plan,
          courses: seeded.plan.courses.map((course) => ({
            ...course,
            color: "#ff3b30",
            topics: course.topics.map((topic) => ({ ...topic, color: "#3d8fd1" })),
          })),
        },
      ],
      studyLog: seeded.studyLog,
      preferences: seeded.preferences ?? DEFAULT_PREFERENCES,
    };
    const storage = memoryStorage(legacy);
    const { repository } = setup(storage);

    const loaded = await read(repository);
    expect(loaded.plans[0].courses[0].color).toBe("coral");
    expect(loaded.plans[0].courses[0].topics[0].color).toBe("violet");
    expect((await storage.load())?.plans[0].courses[0].color).toBe("coral");
  });

  it("stops after unsubscribing", async () => {
    const { repository } = setup();
    const listener = vi.fn();
    repository.subscribe(listener)();

    await repository.createPlan({ name: "Winter semester" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports a storage failure as an error state rather than throwing at startup", async () => {
    const broken: SnapshotStorage = {
      load: () => Promise.reject(new Error("IndexedDB is blocked")),
      save: () => Promise.resolve(),
    };
    const repository = createLocalRepository({ storage: broken });
    const states: RepositoryState[] = [];
    repository.subscribe((state) => states.push(state));

    await expect(repository.createPlan({ name: "Winter semester" })).rejects.toThrow(
      "The local database is not available",
    );
    expect(states.at(-1)).toMatchObject({ status: "error" });
  });
});

describe("persistence", () => {
  it("survives a reload", async () => {
    const storage = memoryStorage();
    const first = setup(storage).repository;
    await withCourse(first);

    // A second repository over the same storage is what a page reload looks like.
    const second = createLocalRepository({ storage, createId: sequentialIdFactory() });
    const snapshot = await read(second);
    expect(snapshot.plans[0].courses[0].name).toBe("Biochemistry");
  });

  it("publishes the same snapshot that was durably written", async () => {
    const saved: PlannerSnapshot[] = [];
    const storage: SnapshotStorage = {
      load: async () => null,
      save: async (snapshot) => {
        saved.push(snapshot);
      },
    };
    const { repository } = setup(storage);
    await repository.createPlan({ name: "Winter semester" });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(await read(repository));
  });

  it("serializes saves even when storage could finish a later write first", async () => {
    let durable: PlannerSnapshot | null = null;
    const firstSaveStarted = deferred();
    const releaseFirstSave = deferred();
    const saves: PlannerSnapshot[] = [];
    const storage: SnapshotStorage = {
      load: async () => durable,
      save: async (snapshot) => {
        const saveIndex = saves.push(snapshot) - 1;
        if (saveIndex === 0) {
          firstSaveStarted.resolve();
          await releaseFirstSave.promise;
        }
        // This storage performs no serialization of its own. Without the
        // repository queue, save 2 can land before the delayed save 1 and then
        // be overwritten by stale data when save 1 resumes.
        durable = snapshot;
      },
    };
    const { repository } = setup(storage);
    await read(repository);

    const first = repository.createPlan({ name: "First" });
    await firstSaveStarted.promise;
    const second = repository.createPlan({ name: "Second" });
    await Promise.resolve();

    expect(saves).toHaveLength(1);
    releaseFirstSave.resolve();

    const ids = await Promise.all([first, second]);
    expect(ids).toEqual(["plan_1", "plan_2"]);
    expect(saves.map((snapshot) => snapshot.plans.map((plan) => plan.name))).toEqual([
      ["First"],
      ["First", "Second"],
    ]);
    expect(durable).toBe(saves[1]);
    expect(await read(repository)).toBe(durable);
  });

  it("keeps the last durable snapshot and sends no phantom update when saving fails", async () => {
    const storage: SnapshotStorage = {
      load: async () => null,
      save: async () => {
        throw new Error("Disk full");
      },
    };
    const { repository } = setup(storage);
    const durable = await read(repository);
    const listener = vi.fn();
    repository.subscribe(listener);
    listener.mockClear();

    await expect(repository.createPlan({ name: "Never saved" })).rejects.toThrow("Disk full");

    expect(listener).not.toHaveBeenCalled();
    expect(await read(repository)).toBe(durable);
    expect((await read(repository)).plans).toEqual([]);
  });

  it("accepts a retry after a failed save and returns the persisted id", async () => {
    let durable: PlannerSnapshot | null = null;
    let failNextSave = true;
    const storage: SnapshotStorage = {
      load: async () => durable,
      save: async (snapshot) => {
        if (failNextSave) {
          failNextSave = false;
          throw new Error("Temporary failure");
        }
        durable = snapshot;
      },
    };
    const { repository } = setup(storage);
    await read(repository);

    await expect(repository.createPlan({ name: "First attempt" })).rejects.toThrow(
      "Temporary failure",
    );
    const planId = await repository.createPlan({ name: "Retry" });

    expect(planId).toBe("plan_2");
    const persisted = await storage.load();
    expect(persisted?.plans).toEqual([expect.objectContaining({ id: planId, name: "Retry" })]);
    expect(await read(repository)).toBe(persisted);
  });
});

describe("plans", () => {
  it("rejects non-canonical names and oversized notes before saving", async () => {
    let durable: PlannerSnapshot | null = null;
    const save = vi.fn(async (next: PlannerSnapshot) => {
      durable = next;
    });
    const { repository } = setup({ load: async () => durable, save });
    const planId = await repository.createPlan({ name: "Winter semester" });
    const before = await read(repository);
    const listener = vi.fn();
    repository.subscribe(listener);
    listener.mockClear();
    save.mockClear();

    await expect(repository.createPlan({ name: " Padded" })).rejects.toThrow("whitespace");
    await expect(
      repository.updatePlan(planId, {
        name: "Winter semester",
        notes: "x".repeat(PLANNER_LIMITS.notesCharacters + 1),
      }),
    ).rejects.toThrow("Plan notes cannot exceed");

    expect(save).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(await read(repository)).toBe(before);
    expect(durable).toBe(before);
  });

  it("takes the study log down with the plan", async () => {
    const { repository } = setup();
    const { planId, courseId } = await withCourse(repository);
    const topicId = await repository.createTopic(courseId, { name: "Glycolysis", color: "#f00" });
    await repository.logStudy({ topicId, date: TODAY, units: 10 });

    await repository.deletePlan(planId);
    const snapshot = await read(repository);
    expect(snapshot.plans).toEqual([]);
    // Orphaned entries would otherwise keep counting towards velocity forever.
    expect(snapshot.studyLog).toEqual([]);
  });

  it("refuses to update a plan that does not exist", async () => {
    const { repository } = setup();
    await expect(repository.updatePlan("plan_ghost", { name: "Ghost" })).rejects.toThrow(
      "Plan not found",
    );
  });
});

describe("courses", () => {
  it("validates course names, codes, and notes", async () => {
    const { repository } = setup();
    const { planId, courseId } = await withCourse(repository);

    await expect(
      repository.createCourse(planId, { name: "Other", code: " BAD ", color: "rose" }),
    ).rejects.toThrow("Course code");
    await expect(
      repository.updateCourse(courseId, {
        name: "Bio\0chemistry",
        color: "violet",
        notes: "",
      }),
    ).rejects.toThrow("control characters");
    await expect(
      repository.updateCourse(courseId, {
        name: "Biochemistry",
        color: "violet",
        notes: "x".repeat(PLANNER_LIMITS.notesCharacters + 1),
      }),
    ).rejects.toThrow("Course notes cannot exceed");
  });

  it("orders a new course after the highest existing one, not by count", async () => {
    // `siblings.length` ties with an existing order as soon as anything is
    // deleted, and two courses sharing an order sort unpredictably.
    const { repository } = setup();
    const planId = await repository.createPlan({ name: "Winter semester" });
    const first = await repository.createCourse(planId, { name: "A", color: "#f00" });
    await repository.createCourse(planId, { name: "B", color: "#0f0" });
    await repository.deleteCourse(first);
    await repository.createCourse(planId, { name: "C", color: "#00f" });

    const orders = (await read(repository)).plans[0].courses.map((course) => course.order);
    expect(orders).toEqual([1, 2]);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("reorders by an explicit list", async () => {
    const { repository } = setup();
    const planId = await repository.createPlan({ name: "Winter semester" });
    const a = await repository.createCourse(planId, { name: "A", color: "#f00" });
    const b = await repository.createCourse(planId, { name: "B", color: "#0f0" });

    await repository.reorderCourses(planId, [b, a]);
    expect((await read(repository)).plans[0].courses.map((course) => course.name)).toEqual([
      "B",
      "A",
    ]);
  });

  it("rejects a partial reorder", async () => {
    const { repository } = setup();
    const { planId, courseId } = await withCourse(repository);
    await repository.createCourse(planId, { name: "Second", color: "#0f0" });

    await expect(repository.reorderCourses(planId, [courseId])).rejects.toThrow(
      "Course ids must contain every sibling exactly once",
    );
  });

  it("rejects duplicate and oversized reorder lists", async () => {
    const { repository } = setup();
    const { planId, courseId } = await withCourse(repository);

    await expect(repository.reorderCourses(planId, [courseId, courseId])).rejects.toThrow(
      "duplicates",
    );
    await expect(
      repository.reorderCourses(
        planId,
        Array.from({ length: PLANNER_LIMITS.reorderItems + 1 }, (_, index) => `course_${index}`),
      ),
    ).rejects.toThrow(`more than ${PLANNER_LIMITS.reorderItems}`);
  });
});

describe("exams", () => {
  it("validates text, enums, and a standalone start date", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);

    await expect(
      repository.createExam(courseId, { name: " Final ", startDate: "2026-12-10" }),
    ).rejects.toThrow("whitespace");
    await expect(
      repository.createExam(courseId, { name: "Final", startDate: "2026-02-31" }),
    ).rejects.toThrow("Start date must be a valid date");
    await expect(
      repository.createExam(courseId, {
        name: "Final",
        kind: "quiz" as never,
        startDate: "2026-12-10",
      }),
    ).rejects.toThrow("Exam kind is invalid");

    const examId = await repository.createExam(courseId, {
      name: "Final",
      startDate: "2026-12-10",
    });
    await expect(
      repository.updateExam(examId, {
        name: "Final",
        kind: "exam",
        startDate: "2026-12-10",
        status: "cancelled" as never,
        notes: "",
      }),
    ).rejects.toThrow("Exam status is invalid");
    await expect(
      repository.updateExam(examId, {
        name: "Final",
        kind: "exam",
        startDate: "2026-12-10",
        status: "confirmed",
        notes: "x".repeat(PLANNER_LIMITS.notesCharacters + 1),
      }),
    ).rejects.toThrow("Exam notes cannot exceed");
  });

  it("infers provisional from the presence of a window", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    await repository.createExam(courseId, {
      name: "Final",
      startDate: "2026-12-10",
      endDate: "2026-12-17",
    });
    await repository.createExam(courseId, { name: "Midterm", startDate: "2026-10-10" });

    const exams = (await read(repository)).plans[0].courses[0].exams;
    expect(exams.map((exam) => exam.status)).toEqual(["provisional", "confirmed"]);
  });

  it("rejects a window that runs backwards", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    await expect(
      repository.createExam(courseId, {
        name: "Final",
        startDate: "2026-12-17",
        endDate: "2026-12-10",
      }),
    ).rejects.toThrow("End date cannot be before start date");
  });
});

describe("topics", () => {
  it("validates individual and bulk topic inputs", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);

    await expect(
      repository.createTopic(courseId, { name: " Topic ", color: "violet" }),
    ).rejects.toThrow("whitespace");
    await expect(
      repository.createTopic(courseId, {
        name: "Topic",
        totalUnits: PLANNER_LIMITS.units + 1,
        color: "violet",
      }),
    ).rejects.toThrow(`Total units cannot exceed ${PLANNER_LIMITS.units}`);
    await expect(
      repository.createTopics(
        courseId,
        Array.from({ length: PLANNER_LIMITS.bulkTopics + 1 }, (_, index) => ({
          name: `Topic ${index}`,
          unit: "slides" as const,
          totalUnits: 1,
        })),
        "violet",
      ),
    ).rejects.toThrow(`more than ${PLANNER_LIMITS.bulkTopics}`);
    await expect(
      repository.createTopics(
        courseId,
        [{ name: "Bad\0name", unit: "slides", totalUnits: 1 }],
        "violet",
      ),
    ).rejects.toThrow("control characters");

    const topicId = await repository.createTopic(courseId, {
      name: "Topic",
      color: "violet",
    });
    const current = (await read(repository)).plans[0].courses[0].topics[0];
    await expect(
      repository.updateTopic(topicId, {
        name: current.name,
        unit: "chapters" as never,
        totalUnits: current.totalUnits,
        completedUnits: current.completedUnits,
        status: current.status,
        priority: current.priority,
        notes: current.notes,
        color: current.color,
      }),
    ).rejects.toThrow("Topic unit is invalid");
  });

  it("creates a batch in outline order", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const ids = await repository.createTopics(
      courseId,
      [
        { name: "Glycolysis", unit: "slides", totalUnits: 42 },
        { name: "Krebs cycle", unit: "slides", totalUnits: 38 },
      ],
      "coral",
    );

    const topics = (await read(repository)).plans[0].courses[0].topics;
    expect(ids).toHaveLength(2);
    expect(topics.map((topic) => topic.order)).toEqual([0, 1]);
    expect(topics.map((topic) => topic.color)).toEqual(["coral", "coral"]);
  });

  it("appends a batch after existing topics", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    await repository.createTopic(courseId, { name: "Overview", color: "#f00" });
    await repository.createTopics(
      courseId,
      [
        { name: "Glycolysis", unit: "slides", totalUnits: 42 },
        { name: "Krebs cycle", unit: "slides", totalUnits: 38 },
      ],
      "#f00",
    );

    const orders = (await read(repository)).plans[0].courses[0].topics.map((topic) => topic.order);
    expect(orders).toEqual([0, 1, 2]);
  });

  it("requires each existing topic exactly once when reordering", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const first = await repository.createTopic(courseId, { name: "First", color: "violet" });
    await repository.createTopic(courseId, { name: "Second", color: "rose" });

    await expect(repository.reorderTopics(courseId, [first])).rejects.toThrow(
      "Topic ids must contain every sibling exactly once",
    );
    await expect(repository.reorderTopics(courseId, [first, first])).rejects.toThrow(
      "duplicates",
    );
  });

  it("rejects completing more than a topic holds", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const topicId = await repository.createTopic(courseId, {
      name: "Glycolysis",
      totalUnits: 100,
      color: "#f00",
    });

    await expect(
      repository.updateTopic(topicId, {
        name: "Glycolysis",
        unit: "slides",
        totalUnits: 100,
        completedUnits: 120,
        status: "active",
        priority: "normal",
        notes: "",
        color: "#f00",
      }),
    ).rejects.toThrow("Completed units cannot exceed the total");
  });

  it("strips the deleted topic from its dependants and from the log", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const first = await repository.createTopic(courseId, { name: "Glycolysis", color: "#f00" });
    const second = await repository.createTopic(courseId, { name: "Krebs cycle", color: "#f00" });
    await repository.setTopicDependencies(second, [first]);
    await repository.logStudy({ topicId: first, date: TODAY, units: 5 });

    await repository.deleteTopic(first);

    const snapshot = await read(repository);
    const topics = snapshot.plans[0].courses[0].topics;
    expect(topics).toHaveLength(1);
    // A dangling id would survive export and reappear as a broken reference.
    expect(topics[0].dependencyIds).toEqual([]);
    expect(snapshot.studyLog).toEqual([]);
  });

  it("moves a topic within its plan and severs course-local dependencies", async () => {
    const { repository } = setup();
    const { planId, courseId } = await withCourse(repository);
    const targetCourseId = await repository.createCourse(planId, {
      name: "Neurobiology",
      color: "blue",
    });
    const sourceColor = (await read(repository)).plans[0].courses.find(
      (candidate) => candidate.id === courseId,
    )!.color;
    const prerequisite = await repository.createTopic(courseId, {
      name: "Cells",
      color: sourceColor,
    });
    const moved = await repository.createTopic(courseId, {
      name: "Synapses",
      color: sourceColor,
    });
    const dependant = await repository.createTopic(courseId, {
      name: "Circuits",
      color: sourceColor,
    });
    await repository.setTopicDependencies(moved, [prerequisite]);
    await repository.setTopicDependencies(dependant, [moved]);

    await repository.moveTopic(moved, targetCourseId);

    const courses = (await read(repository)).plans[0].courses;
    const source = courses.find((candidate) => candidate.id === courseId)!;
    const target = courses.find((candidate) => candidate.id === targetCourseId)!;
    expect(source.topics.find((topic) => topic.id === dependant)?.dependencyIds).toEqual([]);
    expect(target.topics).toHaveLength(1);
    expect(target.topics[0]).toMatchObject({
      id: moved,
      courseId: targetCourseId,
      color: target.color,
      dependencyIds: [],
      order: 0,
    });
  });

  it("rejects cross-plan moves and preserves an explicit topic colour", async () => {
    const { repository } = setup();
    const { planId, courseId } = await withCourse(repository);
    const samePlanTarget = await repository.createCourse(planId, {
      name: "Neurobiology",
      color: "blue",
    });
    const custom = await repository.createTopic(courseId, {
      name: "Synapses",
      color: "violet",
    });
    await repository.moveTopic(custom, samePlanTarget);

    const otherPlan = await repository.createPlan({ name: "Summer semester" });
    const otherCourse = await repository.createCourse(otherPlan, {
      name: "Psychology",
      color: "green",
    });
    await expect(repository.moveTopic(custom, otherCourse)).rejects.toThrow(
      "A topic can only move within its plan",
    );

    const snapshot = await read(repository);
    const moved = snapshot.plans[0].courses
      .find((candidate) => candidate.id === samePlanTarget)!
      .topics.find((topic) => topic.id === custom)!;
    expect(moved.color).toBe("violet");
    expect(snapshot.plans[1].courses[0].topics).toEqual([]);
  });
});

describe("dependencies", () => {
  async function chain(repository: PlannerRepository) {
    const { courseId } = await withCourse(repository);
    const a = await repository.createTopic(courseId, { name: "A", color: "#f00" });
    const b = await repository.createTopic(courseId, { name: "B", color: "#f00" });
    const c = await repository.createTopic(courseId, { name: "C", color: "#f00" });
    await repository.setTopicDependencies(b, [a]);
    await repository.setTopicDependencies(c, [b]);
    return { courseId, a, b, c };
  }

  it("refuses a cycle", async () => {
    // This is the rule that only existed server-side before, so local mode
    // could build a graph the server would have rejected.
    const { repository } = setup();
    const { a, c } = await chain(repository);
    await expect(repository.setTopicDependencies(a, [c])).rejects.toThrow(
      "That would create a circular dependency",
    );
  });

  it("refuses self-dependency", async () => {
    const { repository } = setup();
    const { a } = await chain(repository);
    await expect(repository.setTopicDependencies(a, [a])).rejects.toThrow(
      "A topic cannot depend on itself",
    );
  });

  it("refuses a dependency in another course", async () => {
    const { repository } = setup();
    const { planId, courseId } = await withCourse(repository);
    const mine = await repository.createTopic(courseId, { name: "Mine", color: "#f00" });
    const otherCourseId = await repository.createCourse(planId, { name: "Other", color: "#0f0" });
    const theirs = await repository.createTopic(otherCourseId, { name: "Theirs", color: "#0f0" });

    await expect(repository.setTopicDependencies(mine, [theirs])).rejects.toThrow(
      "Dependencies must be topics in the same course",
    );
  });

  it("rejects duplicate and oversized dependency lists", async () => {
    const { repository } = setup();
    const { a, b } = await chain(repository);

    await expect(repository.setTopicDependencies(b, [a, a])).rejects.toThrow("duplicates");
    await expect(
      repository.setTopicDependencies(
        b,
        Array.from(
          { length: PLANNER_LIMITS.dependencyIds + 1 },
          (_, index) => `topic_${index}`,
        ),
      ),
    ).rejects.toThrow(`more than ${PLANNER_LIMITS.dependencyIds}`);
  });

  it("leaves the graph untouched when it rejects", async () => {
    const { repository } = setup();
    const { a, c } = await chain(repository);
    await expect(repository.setTopicDependencies(a, [c])).rejects.toThrow();

    const topics = (await read(repository)).plans[0].courses[0].topics;
    expect(topics.find((topic) => topic.id === a)?.dependencyIds).toEqual([]);
  });
});

describe("study blocks", () => {
  async function withTopic(repository: PlannerRepository) {
    const { courseId } = await withCourse(repository);
    const topicId = await repository.createTopic(courseId, {
      name: "Glycolysis",
      totalUnits: 120,
      color: "#f00",
    });
    return { courseId, topicId };
  }

  it("treats a block made without a stated source as hand-placed", async () => {
    const { repository } = setup();
    const { topicId } = await withTopic(repository);
    await repository.createStudyBlock({
      topicId,
      startDate: "2026-08-01",
      endDate: "2026-08-03",
    });

    const blocks = (await read(repository)).plans[0].courses[0].topics[0].blocks;
    expect(blocks[0].source).toBe("manual");
  });

  it("adopts a generated block that gets moved", async () => {
    // Dragging a scheduled block is a deliberate placement; the next reflow
    // must not undo it.
    const { repository } = setup();
    const { topicId } = await withTopic(repository);
    await repository.replaceAutoBlocks(
      [topicId],
      [{ topicId, startDate: "2026-08-01", endDate: "2026-08-02", plannedUnits: 40 }],
    );

    const before = (await read(repository)).plans[0].courses[0].topics[0].blocks[0];
    expect(before.source).toBe("auto");

    await repository.updateStudyBlock(before.id, {
      startDate: "2026-08-05",
      endDate: "2026-08-06",
    });

    const after = (await read(repository)).plans[0].courses[0].topics[0].blocks[0];
    expect(after).toMatchObject({ source: "manual", startDate: "2026-08-05", plannedUnits: 40 });
  });

  it("replaces generated blocks and keeps hand-placed ones", async () => {
    const { repository } = setup();
    const { topicId } = await withTopic(repository);
    await repository.createStudyBlock({
      topicId,
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      source: "manual",
    });
    await repository.replaceAutoBlocks(
      [topicId],
      [{ topicId, startDate: "2026-08-01", endDate: "2026-08-02" }],
    );
    await repository.replaceAutoBlocks(
      [topicId],
      [{ topicId, startDate: "2026-08-20", endDate: "2026-08-21" }],
    );

    const blocks = (await read(repository)).plans[0].courses[0].topics[0].blocks;
    expect(blocks.map((block) => [block.source, block.startDate])).toEqual([
      ["manual", "2026-08-10"],
      ["auto", "2026-08-20"],
    ]);
  });

  it("clears generated blocks for a topic in scope that gets none back", async () => {
    const { repository } = setup();
    const { topicId } = await withTopic(repository);
    await repository.replaceAutoBlocks(
      [topicId],
      [{ topicId, startDate: "2026-08-01", endDate: "2026-08-02" }],
    );
    await repository.replaceAutoBlocks([topicId], []);

    expect((await read(repository)).plans[0].courses[0].topics[0].blocks).toEqual([]);
  });

  it("refuses to write outside the reflow scope", async () => {
    const { repository } = setup();
    const { courseId, topicId } = await withTopic(repository);
    const other = await repository.createTopic(courseId, { name: "Krebs cycle", color: "#f00" });

    await expect(
      repository.replaceAutoBlocks(
        [topicId],
        [{ topicId: other, startDate: "2026-08-01", endDate: "2026-08-02" }],
      ),
    ).rejects.toThrow("Cannot write blocks for a topic outside the reflow scope");
  });

  it("validates block scalars, sources, duplicate ranges, and scoped topic ids", async () => {
    const { repository } = setup();
    const { topicId } = await withTopic(repository);

    await expect(
      repository.createStudyBlock({
        topicId,
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        plannedUnits: -1,
      }),
    ).rejects.toThrow("Planned units must be at least 0");
    await expect(
      repository.createStudyBlock({
        topicId,
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        source: "generated" as never,
      }),
    ).rejects.toThrow("Block source is invalid");

    const blockId = await repository.createStudyBlock({
      topicId,
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    await expect(
      repository.updateStudyBlock(blockId, {
        startDate: "2026-08-03",
        endDate: "2026-08-04",
        plannedUnits: Infinity,
      }),
    ).rejects.toThrow("finite number");

    const generated = { topicId, startDate: "2026-08-10", endDate: "2026-08-11" };
    await expect(repository.replaceAutoBlocks([topicId], [generated, generated])).rejects.toThrow(
      "Generated blocks cannot contain duplicates",
    );
    await expect(repository.replaceAutoBlocks(["topic_missing"], [])).rejects.toThrow(
      "Topic not found",
    );
  });

  it("rejects an invalid atomic schedule before saving or publishing either branch", async () => {
    let durable: PlannerSnapshot | null = null;
    const save = vi.fn(async (next: PlannerSnapshot) => {
      durable = next;
    });
    const { repository } = setup({ load: async () => durable, save });
    const { topicId } = await withTopic(repository);
    const before = await read(repository);
    const listener = vi.fn();
    repository.subscribe(listener);
    listener.mockClear();
    save.mockClear();

    await expect(
      repository.applySchedule(
        [topicId],
        [{ topicId, startDate: "2026-08-20", endDate: "2026-08-21" }],
        { ...DEFAULT_PREFERENCES, blackoutDates: ["2026-02-31"] },
      ),
    ).rejects.toThrow("Blackout date must be a valid date");

    expect(save).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(await read(repository)).toBe(before);
    expect(durable).toBe(before);
  });

  it("applies generated blocks and preferences in one durable commit", async () => {
    let durable: PlannerSnapshot | null = null;
    const save = vi.fn(async (next: PlannerSnapshot) => {
      durable = next;
    });
    const { repository } = setup({ load: async () => durable, save });
    const { topicId } = await withTopic(repository);
    await repository.createStudyBlock({
      topicId,
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      source: "manual",
    });
    await repository.replaceAutoBlocks(
      [topicId],
      [{ topicId, startDate: "2026-08-01", endDate: "2026-08-02" }],
    );
    save.mockClear();

    await repository.applySchedule(
      [topicId],
      [{ topicId, startDate: "2026-08-20", endDate: "2026-08-21", plannedUnits: 30 }],
      { ...DEFAULT_PREFERENCES, dailyCapacityUnits: 65 },
    );

    const applied = await read(repository);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(applied);
    expect(applied.preferences.dailyCapacityUnits).toBe(65);
    expect(applied.plans[0].courses[0].topics[0].blocks).toEqual([
      expect.objectContaining({ source: "manual", startDate: "2026-08-10" }),
      expect.objectContaining({ source: "auto", startDate: "2026-08-20", plannedUnits: 30 }),
    ]);
  });

  it("publishes neither schedule nor preferences when the durable commit fails", async () => {
    let durable: PlannerSnapshot | null = null;
    let failWrites = false;
    const storage: SnapshotStorage = {
      load: async () => durable,
      save: async (next) => {
        if (failWrites) throw new Error("Disk full");
        durable = next;
      },
    };
    const { repository } = setup(storage);
    const { topicId } = await withTopic(repository);
    await repository.replaceAutoBlocks(
      [topicId],
      [{ topicId, startDate: "2026-08-01", endDate: "2026-08-02" }],
    );
    const before = await read(repository);
    failWrites = true;

    await expect(
      repository.applySchedule(
        [topicId],
        [{ topicId, startDate: "2026-08-20", endDate: "2026-08-21" }],
        { ...DEFAULT_PREFERENCES, dailyCapacityUnits: 65 },
      ),
    ).rejects.toThrow("Disk full");

    expect(await read(repository)).toBe(before);
    expect(durable).toBe(before);
    expect(before.preferences.dailyCapacityUnits).toBeUndefined();
    expect(before.plans[0].courses[0].topics[0].blocks[0].startDate).toBe("2026-08-01");
  });

  it("rejects a block whose dates run backwards", async () => {
    const { repository } = setup();
    const { topicId } = await withTopic(repository);
    await expect(
      repository.createStudyBlock({ topicId, startDate: "2026-08-03", endDate: "2026-08-01" }),
    ).rejects.toThrow("End date cannot be before start date");
  });
});

describe("logStudy", () => {
  async function withTopic(repository: PlannerRepository, totalUnits: number) {
    const { courseId } = await withCourse(repository);
    return repository.createTopic(courseId, { name: "Glycolysis", totalUnits, color: "#f00" });
  }

  const topicOf = async (repository: PlannerRepository) =>
    (await read(repository)).plans[0].courses[0].topics[0];

  it("advances completion and moves the topic to active", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 100);
    await repository.logStudy({ topicId, date: TODAY, units: 30, minutes: 45 });

    expect(await topicOf(repository)).toMatchObject({ completedUnits: 30, status: "active" });
    expect((await read(repository)).studyLog[0]).toMatchObject({
      topicId,
      date: TODAY,
      units: 30,
      minutes: 45,
    });
  });

  it("marks the topic done once the material runs out", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 100);
    await repository.logStudy({ topicId, date: TODAY, units: 100 });
    expect(await topicOf(repository)).toMatchObject({ completedUnits: 100, status: "done" });
  });

  it("clamps an overshoot to the topic's size but records what was logged", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 100);
    await repository.logStudy({ topicId, date: TODAY, units: 130 });

    expect((await topicOf(repository)).completedUnits).toBe(100);
    // The log is the raw record; only the derived count is clamped.
    expect((await read(repository)).studyLog[0].units).toBe(130);
  });

  it("does not clamp a topic whose size is untracked", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 0);
    await repository.logStudy({ topicId, date: TODAY, units: 130 });
    expect(await topicOf(repository)).toMatchObject({ completedUnits: 130, status: "active" });
  });

  it("accepts a correction back to zero", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 100);
    await repository.logStudy({ topicId, date: TODAY, units: 30 });
    await repository.logStudy({ topicId, date: TODAY, units: -50 });

    expect(await topicOf(repository)).toMatchObject({ completedUnits: 0, status: "planned" });
  });

  it("rejects invalid dates, bounded values, minutes, and notes", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 100);

    await expect(
      repository.logStudy({ topicId, date: "2026-02-31", units: 1 }),
    ).rejects.toThrow("Study date must be a valid date");
    await expect(
      repository.logStudy({ topicId, date: TODAY, units: PLANNER_LIMITS.units + 1 }),
    ).rejects.toThrow(`Units cannot exceed ${PLANNER_LIMITS.units}`);
    await expect(
      repository.logStudy({ topicId, date: TODAY, units: -1, minutes: -1 }),
    ).rejects.toThrow("Minutes must be at least 0");
    await expect(
      repository.logStudy({
        topicId,
        date: TODAY,
        units: -1,
        note: "x".repeat(PLANNER_LIMITS.logNoteCharacters + 1),
      }),
    ).rejects.toThrow("Study note cannot exceed");
  });

  it("rejects a log whose derived untracked progress would exceed the unit bound", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 0);
    await repository.logStudy({ topicId, date: TODAY, units: PLANNER_LIMITS.units });
    const before = await read(repository);

    await expect(
      repository.logStudy({ topicId, date: TODAY, units: 1 }),
    ).rejects.toThrow(`Completed units cannot exceed ${PLANNER_LIMITS.units}`);

    expect(await read(repository)).toBe(before);
    expect((await topicOf(repository)).completedUnits).toBe(PLANNER_LIMITS.units);
    expect((await read(repository)).studyLog).toHaveLength(1);
  });

  it("keeps the log in date order", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 500);
    await repository.logStudy({ topicId, date: "2026-07-29", units: 10 });
    await repository.logStudy({ topicId, date: "2026-07-20", units: 10 });
    await repository.logStudy({ topicId, date: "2026-07-25", units: 10 });

    expect((await read(repository)).studyLog.map((entry) => entry.date)).toEqual([
      "2026-07-20",
      "2026-07-25",
      "2026-07-29",
    ]);
  });

  it("rejects a non-numeric amount", async () => {
    const { repository } = setup();
    const topicId = await withTopic(repository, 100);
    await expect(
      repository.logStudy({ topicId, date: TODAY, units: Number.NaN }),
    ).rejects.toThrow("Units must be a finite number");
  });
});

describe("preferences", () => {
  it("fills in the defaults for anything not supplied", async () => {
    const { repository } = setup();
    await repository.savePreferences({
      ...DEFAULT_PREFERENCES,
      dailyCapacityUnits: 60,
      studyDaysOfWeek: [1, 3, 5],
    });

    expect((await read(repository)).preferences).toEqual({
      ...DEFAULT_PREFERENCES,
      dailyCapacityUnits: 60,
      studyDaysOfWeek: [1, 3, 5],
    });
  });

  it("rejects invalid capacities, weekdays, dates, themes, and accent values", async () => {
    const { repository } = setup();

    await expect(
      repository.savePreferences({ ...DEFAULT_PREFERENCES, dailyCapacityUnits: Infinity }),
    ).rejects.toThrow("finite number");
    await expect(
      repository.savePreferences({ ...DEFAULT_PREFERENCES, studyDaysOfWeek: [1, 1] }),
    ).rejects.toThrow("duplicates");
    await expect(
      repository.savePreferences({ ...DEFAULT_PREFERENCES, blackoutDates: ["2026-02-31"] }),
    ).rejects.toThrow("Blackout date must be a valid date");
    await expect(
      repository.savePreferences({ ...DEFAULT_PREFERENCES, theme: "sepia" as never }),
    ).rejects.toThrow("Theme is invalid");
    await expect(
      repository.savePreferences({ ...DEFAULT_PREFERENCES, accentColor: " blue " }),
    ).rejects.toThrow("whitespace");
  });
});

describe("import and replaceAll", () => {
  const seedDocument = (): PlannerTransferDocument => {
    const seed = generateSeedData({ today: TODAY, courseLimit: 2 });
    return serializePlans(
      { plans: [seed.plan], studyLog: seed.studyLog, preferences: DEFAULT_PREFERENCES },
      `${TODAY}T00:00:00.000Z`,
    );
  };

  it("adds imported plans and study log alongside what is already there", async () => {
    const { repository } = setup();
    const planId = await repository.createPlan({ name: "Existing" });
    const courseId = await repository.createCourse(planId, {
      name: "Existing course",
      color: "blue",
    });
    const existingTopicId = await repository.createTopic(courseId, {
      name: "Existing topic",
      color: "blue",
    });
    await repository.logStudy({ topicId: existingTopicId, date: TODAY, units: 5 });
    const document = seedDocument();
    await repository.importPlans(document);

    const snapshot = await read(repository);
    expect(snapshot.plans.map((plan) => plan.name)).toEqual([
      "Existing",
      "Winter semester",
    ]);
    expect(snapshot.studyLog).toHaveLength(document.studyLog.length + 1);
    expect(snapshot.studyLog).toContainEqual(
      expect.objectContaining({ topicId: existingTopicId, units: 5 }),
    );
  });

  it("drops everything else on replaceAll", async () => {
    const { repository } = setup();
    await repository.createPlan({ name: "Existing" });
    await repository.replaceAll(seedDocument());

    expect((await read(repository)).plans.map((plan) => plan.name)).toEqual(["Winter semester"]);
  });

  it("re-attaches the study log to freshly created topic ids", async () => {
    const { repository } = setup();
    const document = seedDocument();
    await repository.replaceAll(document);

    const snapshot = await read(repository);
    const topicIds = new Set(
      snapshot.plans.flatMap((plan) =>
        plan.courses.flatMap((course) => course.topics.map((topic) => topic.id)),
      ),
    );

    expect(snapshot.studyLog).toHaveLength(document.studyLog.length);
    expect(snapshot.studyLog.every((entry) => topicIds.has(entry.topicId))).toBe(true);
  });

  it("rejects a log entry whose topic key is not in the document", async () => {
    const { repository } = setup();
    await repository.createPlan({ name: "Existing" });
    const before = await read(repository);
    const document = seedDocument();
    document.studyLog.push({
      topicKey: "missing",
      date: TODAY,
      units: 10,
    });

    await expect(repository.replaceAll(document)).rejects.toThrow("missing topic key");
    expect(await read(repository)).toBe(before);
  });

  it("keeps preferences across a replaceAll", async () => {
    const { repository } = setup();
    await repository.savePreferences({ ...DEFAULT_PREFERENCES, dailyCapacityUnits: 60 });
    await repository.replaceAll(seedDocument());

    expect((await read(repository)).preferences.dailyCapacityUnits).toBe(60);
  });
});

describe("immutability", () => {
  let repository: PlannerRepository;

  beforeEach(async () => {
    repository = setup().repository;
    const { planId } = await withCourse(repository);
    await repository.createCourse(planId, { name: "Physiology", color: "#0f0" });
  });

  it("reuses untouched siblings, so memoized rows do not re-render", async () => {
    const before = await read(repository);
    await repository.updateCourse(before.plans[0].courses[0].id, {
      name: "Biochemistry II",
      color: "#ff0000",
      notes: "",
    });
    const after = await read(repository);

    expect(after.plans[0]).not.toBe(before.plans[0]);
    expect(after.plans[0].courses[0]).not.toBe(before.plans[0].courses[0]);
    expect(after.plans[0].courses[1]).toBe(before.plans[0].courses[1]);
    expect(after.studyLog).toBe(before.studyLog);
  });
});
