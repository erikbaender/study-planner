import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializePlans, type PlannerExport } from "@/lib/import-export";
import { sequentialIdFactory } from "./ids";
import {
  createLocalRepository,
  memoryStorage,
  type SnapshotStorage,
} from "./local-repository";
import type { PlannerRepository, RepositoryState } from "./repository";
import { generateSeedData } from "@/domain/seed";
import { DEFAULT_PREFERENCES, type PlannerSnapshot } from "@/domain/types";

const TODAY = "2026-07-29";

function setup(storage: SnapshotStorage = memoryStorage()) {
  const repository = createLocalRepository({ storage, createId: sequentialIdFactory() });
  return { repository, storage };
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

  it("keeps the UI ahead of the write, and the write faithful to the UI", async () => {
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
});

describe("plans", () => {
  it("rejects a plan whose range runs backwards", async () => {
    const { repository } = setup();
    await expect(
      repository.createPlan({ name: "Broken", startDate: "2026-09-01", endDate: "2026-08-01" }),
    ).rejects.toThrow("End date cannot be before start date");
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
      "Reorder must list every course in the plan exactly once",
    );
  });
});

describe("exams", () => {
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

  it("updates the type, certainty, date, window, and notes together", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const examId = await repository.createExam(courseId, {
      name: "Final",
      startDate: "2026-12-10",
    });

    await repository.updateExam(examId, {
      name: "Oral defense",
      kind: "presentation",
      startDate: "2026-12-12",
      endDate: "2026-12-16",
      status: "provisional",
      notes: "Panel pending",
    });

    expect((await read(repository)).plans[0].courses[0].exams[0]).toMatchObject({
      id: examId,
      name: "Oral defense",
      kind: "presentation",
      startDate: "2026-12-12",
      endDate: "2026-12-16",
      status: "provisional",
      notes: "Panel pending",
    });
  });
});

describe("topics", () => {
  it("creates a batch in outline order", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const ids = await repository.createTopics(
      courseId,
      [
        { name: "Glycolysis", section: "Metabolism", unit: "slides", totalUnits: 42 },
        { name: "Krebs cycle", section: "Metabolism", unit: "slides", totalUnits: 38 },
      ],
      "#ff0000",
    );

    const topics = (await read(repository)).plans[0].courses[0].topics;
    expect(ids).toHaveLength(2);
    expect(topics.map((topic) => topic.order)).toEqual([0, 1]);
    expect(topics.map((topic) => topic.color)).toEqual(["#ff0000", "#ff0000"]);
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

  it("rejects shrinking a topic below work already logged", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const topicId = await repository.createTopic(courseId, {
      name: "Glycolysis",
      totalUnits: 100,
      color: "#f00",
    });
    await repository.logStudy({ topicId, date: TODAY, units: 80 });

    await expect(repository.updateTopic(topicId, { totalUnits: 60 })).rejects.toThrow(
      "Completed units cannot exceed the total",
    );
  });

  it("reorders topics by an explicit complete list", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const a = await repository.createTopic(courseId, { name: "A", color: "#f00" });
    const b = await repository.createTopic(courseId, { name: "B", color: "#f00" });
    const c = await repository.createTopic(courseId, { name: "C", color: "#f00" });

    await repository.reorderTopics(courseId, [c, a, b]);

    expect(
      (await read(repository)).plans[0].courses[0].topics.map((topic) => topic.name),
    ).toEqual(["C", "A", "B"]);
  });

  it("rejects a partial topic reorder", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const a = await repository.createTopic(courseId, { name: "A", color: "#f00" });
    await repository.createTopic(courseId, { name: "B", color: "#f00" });

    await expect(repository.reorderTopics(courseId, [a])).rejects.toThrow(
      "Reorder must list every topic in the course exactly once",
    );
  });

  it("clears a section without overwriting unrelated topic fields", async () => {
    const { repository } = setup();
    const { courseId } = await withCourse(repository);
    const topicId = await repository.createTopic(courseId, {
      name: "Glycolysis",
      section: "Metabolism",
      totalUnits: 100,
      color: "#f00",
    });

    await repository.updateTopic(topicId, { section: null });

    const updated = (await read(repository)).plans[0].courses[0].topics[0];
    expect(updated).toMatchObject({ name: "Glycolysis", totalUnits: 100 });
    expect(updated.section).toBeUndefined();
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

  it("reflows from a date without rewriting generated history or manual work", async () => {
    const { repository } = setup();
    const { topicId } = await withTopic(repository);
    await repository.createStudyBlock({
      topicId,
      startDate: "2026-07-31",
      endDate: "2026-07-31",
      plannedUnits: 10,
      source: "manual",
    });
    await repository.replaceAutoBlocks(
      [topicId],
      [
        { topicId, startDate: "2026-07-28", endDate: "2026-07-28", plannedUnits: 20 },
        { topicId, startDate: "2026-08-01", endDate: "2026-08-01", plannedUnits: 30 },
      ],
    );
    const before = (await read(repository)).plans[0].courses[0].topics[0].blocks;
    const historicalId = before.find((block) => block.startDate === "2026-07-28")?.id;
    const manualId = before.find((block) => block.source === "manual")?.id;

    await repository.replaceAutoBlocks(
      [topicId],
      [{ topicId, startDate: "2026-08-04", endDate: "2026-08-04", plannedUnits: 40 }],
      { fromDate: "2026-07-30" },
    );

    const blocks = (await read(repository)).plans[0].courses[0].topics[0].blocks;
    expect(blocks.map(({ id, source, startDate }) => ({ id, source, startDate }))).toEqual([
      { id: manualId, source: "manual", startDate: "2026-07-31" },
      { id: historicalId, source: "auto", startDate: "2026-07-28" },
      { id: expect.any(String), source: "auto", startDate: "2026-08-04" },
    ]);
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
    await repository.logStudy({
      topicId,
      date: TODAY,
      units: 30,
      minutes: 45,
      note: "Practice questions",
    });

    expect(await topicOf(repository)).toMatchObject({ completedUnits: 30, status: "active" });
    expect((await read(repository)).studyLog[0]).toMatchObject({
      topicId,
      date: TODAY,
      units: 30,
      minutes: 45,
      note: "Practice questions",
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
    ).rejects.toThrow("Units must be a number");
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
});

describe("import and replaceAll", () => {
  const seedDocument = (): PlannerExport => {
    const seed = generateSeedData({ today: TODAY, courseLimit: 2 });
    return serializePlans(
      { plans: [seed.plan], studyLog: seed.studyLog, preferences: DEFAULT_PREFERENCES },
      `${TODAY}T00:00:00.000Z`,
    );
  };

  it("adds imported plans alongside what is already there", async () => {
    const { repository } = setup();
    await repository.createPlan({ name: "Existing" });
    await repository.importPlans(seedDocument());

    const snapshot = await read(repository);
    expect(snapshot.plans.map((plan) => plan.name)).toEqual([
      "Existing",
      "Winter semester",
    ]);
    expect(snapshot.studyLog).toHaveLength(seedDocument().studyLog.length);
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

  it("skips a log entry whose topic is not in the document", async () => {
    // Stale data in a hand-edited file is not a reason to refuse the whole import.
    const { repository } = setup();
    const document = seedDocument();
    document.studyLog.push({
      courseName: "Nonexistent",
      topicName: "Nowhere",
      date: TODAY,
      units: 10,
    });

    await repository.replaceAll(document);
    expect((await read(repository)).studyLog).toHaveLength(document.studyLog.length - 1);
  });

  it("restores exported preferences on replaceAll", async () => {
    const { repository } = setup();
    await repository.savePreferences({ ...DEFAULT_PREFERENCES, dailyCapacityUnits: 60 });
    await repository.replaceAll(seedDocument());

    expect((await read(repository)).preferences).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps repeated topic names distinct when restoring study history", async () => {
    const source = setup().repository;
    const { courseId } = await withCourse(source);
    const first = await source.createTopic(courseId, {
      name: "Review",
      totalUnits: 20,
      color: "#f00",
    });
    const second = await source.createTopic(courseId, {
      name: "Review",
      totalUnits: 20,
      color: "#f00",
    });
    await source.logStudy({ topicId: first, date: "2026-07-28", units: 3 });
    await source.logStudy({ topicId: second, date: "2026-07-29", units: 7 });
    const document = serializePlans(await read(source), `${TODAY}T00:00:00.000Z`);

    const target = setup().repository;
    await target.replaceAll(document);
    const restored = await read(target);
    const [restoredFirst, restoredSecond] = restored.plans[0].courses[0].topics;

    expect(restoredFirst.name).toBe(restoredSecond.name);
    expect(restored.studyLog).toEqual([
      expect.objectContaining({ topicId: restoredFirst.id, units: 3 }),
      expect.objectContaining({ topicId: restoredSecond.id, units: 7 }),
    ]);
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
