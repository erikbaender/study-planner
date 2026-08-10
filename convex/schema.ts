import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Mirrors `src/domain/types.ts`. The domain types are the source of truth for
 * shape and meaning; this file is how they are stored.
 *
 * Replaces the previous schema outright rather than migrating it — `milestones`
 * became `exams` and `topicRanges` became `studyBlocks`, and existing data was
 * explicitly disposable. `convex/seed.ts` repopulates a deployment.
 */

const unit = v.union(
  v.literal("slides"),
  v.literal("pages"),
  v.literal("cards"),
  v.literal("videos"),
  v.literal("hours"),
  v.literal("items"),
);

export default defineSchema({
  ...authTables,

  /** Surfaced in the UI as a "Semester". */
  plans: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    notes: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  courses: defineTable({
    planId: v.id("plans"),
    name: v.string(),
    code: v.optional(v.string()),
    notes: v.string(),
    /** Stable course-palette id. Kept as a string while legacy hex rows are read-migrated. */
    color: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_plan", ["planId"]),

  exams: defineTable({
    courseId: v.id("courses"),
    name: v.string(),
    kind: v.union(
      v.literal("exam"),
      v.literal("deadline"),
      v.literal("presentation"),
      v.literal("other"),
    ),
    startDate: v.string(),
    /** Set only on provisional exams, marking the far end of the announced window. */
    endDate: v.optional(v.string()),
    status: v.union(v.literal("confirmed"), v.literal("provisional")),
    notes: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_course", ["courseId"]),

  topics: defineTable({
    courseId: v.id("courses"),
    name: v.string(),
    unit,
    /** `0` means the size is untracked; such topics are excluded from pace maths. */
    totalUnits: v.number(),
    completedUnits: v.number(),
    dependencyIds: v.array(v.id("topics")),
    /** Stable course-palette id. Kept as a string while legacy hex rows are read-migrated. */
    color: v.string(),
    notes: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_course", ["courseId"]),

  studyBlocks: defineTable({
    topicId: v.id("topics"),
    startDate: v.string(),
    endDate: v.string(),
    plannedUnits: v.optional(v.number()),
    /** Reflow regenerates `auto` blocks and must never touch a `manual` one. */
    source: v.union(v.literal("auto"), v.literal("manual")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_topic", ["topicId"])
    .index("by_source", ["source"]),

  /** Logged sessions. The raw material for velocity, streaks and projections. */
  studyLog: defineTable({
    ownerId: v.id("users"),
    topicId: v.id("topics"),
    date: v.string(),
    units: v.number(),
    minutes: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_date", ["ownerId", "date"])
    .index("by_topic", ["topicId"]),

  preferences: defineTable({
    ownerId: v.id("users"),
    dailyCapacityUnits: v.optional(v.number()),
    /** 0 = Sunday, matching `Date.prototype.getDay`. */
    studyDaysOfWeek: v.array(v.number()),
    blackoutDates: v.array(v.string()),
    theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
    accentColor: v.string(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),
});
