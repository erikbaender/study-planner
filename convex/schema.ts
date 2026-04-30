import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
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
    notes: v.string(),
    color: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_plan", ["planId"]),
  milestones: defineTable({
    courseId: v.id("courses"),
    name: v.string(),
    notes: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_course", ["courseId"]),
  topics: defineTable({
    courseId: v.id("courses"),
    name: v.string(),
    notes: v.string(),
    color: v.string(),
    dependencyIds: v.array(v.id("topics")),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_course", ["courseId"]),
  topicRanges: defineTable({
    topicId: v.id("topics"),
    startDate: v.string(),
    endDate: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_topic", ["topicId"]),
});