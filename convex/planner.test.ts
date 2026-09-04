import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./_generated/*.js"),
};

describe("authenticated planner ownership", () => {
  it("fails closed without a signed-in account", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.planner.listPlanTrees, {})).rejects.toThrow(
      "Authentication required",
    );
    await expect(t.mutation(api.planner.createPlan, { name: "Private plan" })).rejects.toThrow(
      "Authentication required",
    );
  });

  it("keeps every plan tree, log, preference, and mutation scoped to its owner", async () => {
    const t = convexTest(schema, modules);
    const [aliceId, bobId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", { name: "Alice" }),
      await ctx.db.insert("users", { name: "Bob" }),
    ]);
    const alice = t.withIdentity({ subject: aliceId });
    const bob = t.withIdentity({ subject: bobId });

    const planId = await alice.mutation(api.planner.createPlan, { name: "Alice semester" });
    const courseId = await alice.mutation(api.planner.createCourse, {
      planId,
      name: "Biology",
      color: "violet",
    });
    const topicId = await alice.mutation(api.planner.createTopic, {
      courseId,
      name: "Metabolism",
      color: "violet",
    });
    const examId = await alice.mutation(api.planner.createExam, {
      courseId,
      name: "Final",
      startDate: "2026-12-10",
    });
    const blockId = await alice.mutation(api.planner.createStudyBlock, {
      topicId,
      startDate: "2026-09-05",
      endDate: "2026-09-05",
    });
    await alice.mutation(api.planner.logStudy, {
      topicId,
      date: "2026-09-05",
      units: 5,
    });
    await alice.mutation(api.planner.savePreferences, {
      dailyCapacityUnits: 40,
      studyDaysOfWeek: [1, 2, 3, 4, 5],
      blackoutDates: [],
      theme: "system",
      accentColor: "violet",
    });

    expect(await bob.query(api.planner.listPlanTrees, {})).toEqual([]);
    expect(await bob.query(api.planner.listStudyLog, {})).toEqual([]);
    expect(await bob.query(api.planner.getPreferences, {})).toBeNull();

    await expect(
      bob.mutation(api.planner.updatePlan, { planId, name: "Stolen", notes: "" }),
    ).rejects.toThrow("Plan not found");
    await expect(
      bob.mutation(api.planner.updateCourse, {
        courseId,
        name: "Stolen",
        notes: "",
        color: "violet",
      }),
    ).rejects.toThrow("Course not found");
    await expect(
      bob.mutation(api.planner.updateExam, {
        examId,
        name: "Stolen",
        kind: "exam",
        startDate: "2026-12-10",
        status: "confirmed",
        notes: "",
      }),
    ).rejects.toThrow("Exam not found");
    await expect(
      bob.mutation(api.planner.updateTopic, {
        topicId,
        name: "Stolen",
        unit: "items",
        totalUnits: 10,
        completedUnits: 0,
        status: "planned",
        priority: "normal",
        notes: "",
        color: "violet",
      }),
    ).rejects.toThrow("Topic not found");
    await expect(
      bob.mutation(api.planner.updateStudyBlock, {
        blockId,
        startDate: "2026-09-06",
        endDate: "2026-09-06",
      }),
    ).rejects.toThrow("Study block not found");
    await expect(
      bob.mutation(api.planner.applySchedule, {
        topicIds: [topicId],
        blocks: [],
        preferences: {
          dailyCapacityUnits: 40,
          studyDaysOfWeek: [1, 2, 3, 4, 5],
          blackoutDates: [],
          theme: "system",
          accentColor: "violet",
        },
      }),
    ).rejects.toThrow("Topic not found");

    const bobPlanId = await bob.mutation(api.planner.createPlan, { name: "Bob semester" });
    expect((await bob.query(api.planner.listPlanTrees, {})).map((plan) => plan._id)).toEqual([
      bobPlanId,
    ]);
    await bob.mutation(api.planner.replaceAllPlans, { plans: [], studyLog: [] });
    expect(await bob.query(api.planner.listPlanTrees, {})).toEqual([]);

    const aliceSecondSession = t.withIdentity({ subject: aliceId });
    const alicePlans = await aliceSecondSession.query(api.planner.listPlanTrees, {});
    expect(alicePlans.map((plan) => plan._id)).toEqual([planId]);
    expect(alicePlans[0].courses[0].topics[0]._id).toBe(topicId);
    expect(await aliceSecondSession.query(api.planner.listStudyLog, {})).toHaveLength(1);
    expect(await aliceSecondSession.query(api.planner.getPreferences, {})).toMatchObject({
      ownerId: aliceId,
      dailyCapacityUnits: 40,
    });
  });
});
