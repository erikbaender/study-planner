import { describe, expect, it, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { Preferences } from "@/domain/types";
import { createConvexRepository } from "./convex-repository";
import type { RepositoryState } from "./repository";

type PlanTrees = FunctionReturnType<typeof api.planner.listPlanTrees>;
type PlanTree = PlanTrees[number];
type CourseTree = PlanTree["courses"][number];
type TopicTree = CourseTree["topics"][number];
type PreferencesRow = NonNullable<FunctionReturnType<typeof api.planner.getPreferences>>;
type FunctionReference = Parameters<typeof getFunctionName>[0];

class QueryWatch<Result> {
  private readonly listeners = new Set<() => void>();

  constructor(private result: Result) {}

  onUpdate(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  localQueryResult() {
    return this.result;
  }

  update(result: Result) {
    this.result = result;
    for (const listener of this.listeners) listener();
  }
}

function fixture() {
  const userId = "user_1" as Id<"users">;
  const planId = "plan_1" as Id<"plans">;
  const courseId = "course_1" as Id<"courses">;
  const firstTopicId = "topic_1" as Id<"topics">;
  const secondTopicId = "topic_2" as Id<"topics">;

  const firstBlock: Doc<"studyBlocks"> = {
    _id: "block_1" as Id<"studyBlocks">,
    _creationTime: 1,
    topicId: firstTopicId,
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    plannedUnits: 20,
    source: "manual",
    createdAt: 1,
    updatedAt: 1,
  };
  const firstTopic: TopicTree = {
    _id: firstTopicId,
    _creationTime: 1,
    courseId,
    name: "Glycolysis",
    unit: "slides",
    totalUnits: 100,
    completedUnits: 20,
    status: "active",
    priority: "high",
    dependencyIds: [],
    color: "violet",
    notes: "",
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    blocks: [firstBlock],
  };
  const secondTopic: TopicTree = {
    _id: secondTopicId,
    _creationTime: 2,
    courseId,
    name: "Citric acid cycle",
    unit: "slides",
    totalUnits: 80,
    completedUnits: 0,
    status: "planned",
    priority: "normal",
    dependencyIds: [firstTopicId],
    color: "violet",
    notes: "",
    order: 1,
    createdAt: 2,
    updatedAt: 2,
    blocks: [],
  };
  const course: CourseTree = {
    _id: courseId,
    _creationTime: 1,
    planId,
    name: "Biochemistry",
    code: "BIO-1",
    notes: "",
    color: "violet",
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    exams: [],
    topics: [firstTopic, secondTopic],
  };
  const plan: PlanTree = {
    _id: planId,
    _creationTime: 1,
    ownerId: userId,
    name: "Winter semester",
    notes: "",
    createdAt: 1,
    updatedAt: 1,
    courses: [course],
  };
  const studyLog: Doc<"studyLog"> = {
    _id: "log_1" as Id<"studyLog">,
    _creationTime: 1,
    ownerId: userId,
    topicId: firstTopicId,
    date: "2026-08-01",
    units: 20,
    minutes: 30,
    createdAt: 1,
  };
  const preferences: PreferencesRow = {
    _id: "preferences_1" as Id<"preferences">,
    _creationTime: 1,
    ownerId: userId,
    dailyCapacityUnits: 40,
    studyDaysOfWeek: [1, 2, 3, 4, 5],
    blackoutDates: [],
    theme: "system",
    accentColor: "violet",
    updatedAt: 1,
  };

  return {
    plans: [plan] satisfies PlanTrees,
    studyLog: [studyLog],
    preferences,
    plan,
    course,
    firstTopic,
    secondTopic,
  };
}

function setup(source: ReturnType<typeof fixture>) {
  const plans = new QueryWatch(source.plans);
  const studyLog = new QueryWatch(source.studyLog);
  const preferences = new QueryWatch<PreferencesRow | null>(source.preferences);
  const watches = { plans, studyLog, preferences };
  const mutation = vi.fn<
    (reference: FunctionReference, args: unknown) => Promise<void>
  >();
  mutation.mockResolvedValue(undefined);
  const client = {
    watchQuery(query: FunctionReference) {
      switch (getFunctionName(query)) {
        case "planner:listPlanTrees":
          return plans;
        case "planner:listStudyLog":
          return studyLog;
        case "planner:getPreferences":
          return preferences;
        default:
          throw new Error(`Unexpected query: ${getFunctionName(query)}`);
      }
    },
    mutation,
  } as unknown as ConvexReactClient;
  const states: RepositoryState[] = [];

  const repository = createConvexRepository(client);
  repository.subscribe((state) => states.push(state));

  const snapshot = () => {
    const ready = states.findLast(
      (state): state is Extract<RepositoryState, { status: "ready" }> => state.status === "ready",
    );
    if (!ready) throw new Error("Repository did not emit a ready snapshot");
    return ready.snapshot;
  };

  return { watches, snapshot, repository, mutation };
}

describe("Convex snapshot translation", () => {
  it("reuses the complete snapshot when unchanged results are reported again", () => {
    const source = fixture();
    const { watches, snapshot } = setup(source);
    const initial = snapshot();

    watches.plans.update(source.plans);
    expect(snapshot()).toBe(initial);

    // A new result container with the same immutable rows should be shared too.
    watches.plans.update([...source.plans]);
    expect(snapshot()).toBe(initial);
  });

  it("keeps unrelated plan and log identities when preferences change", () => {
    const source = fixture();
    const { watches, snapshot } = setup(source);
    const initial = snapshot();

    watches.preferences.update({
      ...source.preferences,
      accentColor: "rose",
      updatedAt: 2,
    });
    const changed = snapshot();

    expect(changed).not.toBe(initial);
    expect(changed.plans).toBe(initial.plans);
    expect(changed.plans[0]).toBe(initial.plans[0]);
    expect(changed.studyLog).toBe(initial.studyLog);
    expect(changed.preferences).not.toBe(initial.preferences);
    expect(changed.preferences.accentColor).toBe("rose");
  });

  it("invalidates a changed topic and its parents while sharing unchanged branches", () => {
    const source = fixture();
    const { watches, snapshot } = setup(source);
    const initial = snapshot();
    const changedTopic: TopicTree = {
      ...source.firstTopic,
      name: "Glycolysis and gluconeogenesis",
      updatedAt: 2,
    };
    const changedCourse: CourseTree = {
      ...source.course,
      topics: [changedTopic, source.secondTopic],
      updatedAt: 2,
    };
    const changedPlan: PlanTree = {
      ...source.plan,
      courses: [changedCourse],
      updatedAt: 2,
    };

    watches.plans.update([changedPlan]);
    const changed = snapshot();

    expect(changed).not.toBe(initial);
    expect(changed.plans).not.toBe(initial.plans);
    expect(changed.plans[0]).not.toBe(initial.plans[0]);
    expect(changed.plans[0].courses[0]).not.toBe(initial.plans[0].courses[0]);
    expect(changed.plans[0].courses[0].topics[0]).not.toBe(
      initial.plans[0].courses[0].topics[0],
    );
    expect(changed.plans[0].courses[0].topics[0].blocks).toBe(
      initial.plans[0].courses[0].topics[0].blocks,
    );
    expect(changed.plans[0].courses[0].topics[1]).toBe(
      initial.plans[0].courses[0].topics[1],
    );
    expect(changed.studyLog).toBe(initial.studyLog);
    expect(changed.preferences).toBe(initial.preferences);
  });

  it("sends schedule blocks and preferences through one mutation", async () => {
    const source = fixture();
    const { repository, mutation } = setup(source);
    const blocks = [
      {
        topicId: source.firstTopic._id,
        startDate: "2026-08-20",
        endDate: "2026-08-21",
        plannedUnits: 20,
      },
    ];
    const preferences: Preferences = {
      dailyCapacityUnits: 65,
      studyDaysOfWeek: [1, 2, 3, 4, 5],
      blackoutDates: ["2026-12-24"],
      theme: "system" as const,
      accentColor: "violet",
    };

    await repository.applySchedule([source.firstTopic._id], blocks, preferences);

    expect(mutation).toHaveBeenCalledOnce();
    expect(getFunctionName(mutation.mock.calls[0][0])).toBe("planner:applySchedule");
    expect(mutation.mock.calls[0][1]).toEqual({
      topicIds: [source.firstTopic._id],
      blocks,
      preferences: {
        ...preferences,
        studyDaysOfWeek: [...preferences.studyDaysOfWeek],
        blackoutDates: [...preferences.blackoutDates],
      },
    });
  });
});
