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

const topicStatus = v.union(v.literal("planned"), v.literal("active"), v.literal("done"));
const topicPriority = v.union(v.literal("low"), v.literal("normal"), v.literal("high"));
const examKind = v.union(
  v.literal("exam"),
  v.literal("deadline"),
  v.literal("presentation"),
  v.literal("other"),
);
const examStatus = v.union(v.literal("confirmed"), v.literal("provisional"));
const theme = v.union(v.literal("system"), v.literal("light"), v.literal("dark"));
const blockSource = v.union(v.literal("auto"), v.literal("manual"));

const inverseCommand = v.union(
  v.object({
    type: v.literal("plan.update"),
    patch: v.object({ name: v.optional(v.string()), notes: v.optional(v.string()) }),
  }),
  v.object({ type: v.literal("course.delete"), courseId: v.id("courses") }),
  v.object({
    type: v.literal("course.update"),
    courseId: v.id("courses"),
    patch: v.object({
      name: v.optional(v.string()),
      code: v.optional(v.union(v.string(), v.null())),
      notes: v.optional(v.string()),
      color: v.optional(v.string()),
    }),
  }),
  v.object({ type: v.literal("exam.delete"), examId: v.id("exams") }),
  v.object({
    type: v.literal("exam.update"),
    examId: v.id("exams"),
    patch: v.object({
      name: v.optional(v.string()),
      kind: v.optional(examKind),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.union(v.string(), v.null())),
      status: v.optional(examStatus),
      notes: v.optional(v.string()),
    }),
  }),
  v.object({ type: v.literal("topic.delete"), topicId: v.id("topics") }),
  v.object({
    type: v.literal("topic.update"),
    topicId: v.id("topics"),
    patch: v.object({
      name: v.optional(v.string()),
      unit: v.optional(unit),
      totalUnits: v.optional(v.number()),
      completedUnits: v.optional(v.number()),
      status: v.optional(topicStatus),
      priority: v.optional(topicPriority),
      notes: v.optional(v.string()),
      color: v.optional(v.string()),
    }),
  }),
  v.object({
    type: v.literal("topic.reorder"),
    courseId: v.id("courses"),
    topicIds: v.array(v.id("topics")),
  }),
  v.object({
    type: v.literal("topic.dependencies.set"),
    topicId: v.id("topics"),
    dependencyIds: v.array(v.id("topics")),
  }),
  v.object({ type: v.literal("block.delete"), blockId: v.id("studyBlocks") }),
  v.object({
    type: v.literal("block.restore"),
    blockId: v.id("studyBlocks"),
    value: v.object({
      startDate: v.string(),
      endDate: v.string(),
      plannedUnits: v.optional(v.number()),
      source: blockSource,
    }),
  }),
  v.object({
    type: v.literal("schedule.restore"),
    topicIds: v.array(v.id("topics")),
    blocks: v.array(v.object({
      topicId: v.id("topics"),
      startDate: v.string(),
      endDate: v.string(),
      plannedUnits: v.optional(v.number()),
      source: blockSource,
      createdAt: v.number(),
      updatedAt: v.number(),
    })),
  }),
  v.object({
    type: v.literal("preferences.restore"),
    value: v.union(
      v.null(),
      v.object({
        dailyCapacityUnits: v.optional(v.number()),
        studyDaysOfWeek: v.array(v.number()),
        blackoutDates: v.array(v.string()),
        theme,
        accentColor: v.string(),
        timezone: v.optional(v.string()),
      }),
    ),
  }),
  v.object({
    type: v.literal("progress.restore"),
    topicId: v.id("topics"),
    logId: v.id("studyLog"),
    completedUnits: v.number(),
    status: topicStatus,
  }),
);

const baseMutationResult = {
  revision: v.number(),
  auditId: v.id("plannerAudit"),
  summary: v.string(),
};
const idempotentResult = v.union(
  v.object({
    ...baseMutationResult,
    planId: v.id("plans"),
    createdIds: v.record(v.string(), v.string()),
    warnings: v.array(v.string()),
    affectedEntityIds: v.array(v.string()),
  }),
  v.object({
    ...baseMutationResult,
    createdIds: v.record(v.string(), v.string()),
    warnings: v.array(v.string()),
    affectedEntityIds: v.array(v.string()),
  }),
  v.object({
    ...baseMutationResult,
    logId: v.id("studyLog"),
    topicId: v.id("topics"),
    completedUnits: v.number(),
    status: topicStatus,
  }),
  v.object(baseMutationResult),
);

export default defineSchema({
  ...authTables,

  /** Surfaced in the UI as a "Semester". */
  plans: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    notes: v.string(),
    /** Added as optional for existing deployments; all new writes set it. */
    revision: v.optional(v.number()),
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
    kind: examKind,
    startDate: v.string(),
    /** Set only on provisional exams, marking the far end of the announced window. */
    endDate: v.optional(v.string()),
    status: examStatus,
    notes: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_course", ["courseId"]),

  topics: defineTable({
    courseId: v.id("courses"),
    name: v.string(),
    /** Legacy field retained temporarily so deployments can remove it without blocking schema push. */
    section: v.optional(v.string()),
    unit,
    /** `0` means the size is untracked; such topics are excluded from pace maths. */
    totalUnits: v.number(),
    completedUnits: v.number(),
    status: topicStatus,
    priority: topicPriority,
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
    source: blockSource,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_topic", ["topicId"])
    .index("by_topic_and_source", ["topicId", "source"])
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
    revision: v.optional(v.number()),
    ownerId: v.id("users"),
    dailyCapacityUnits: v.optional(v.number()),
    /** 0 = Sunday, matching `Date.prototype.getDay`. */
    studyDaysOfWeek: v.array(v.number()),
    blackoutDates: v.array(v.string()),
    theme,
    accentColor: v.string(),
    /** IANA timezone captured during an authenticated browser consent flow. */
    timezone: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  /** Public OAuth clients registered through RFC 7591 dynamic registration. */
  oauthClients: defineTable({
    clientId: v.string(),
    name: v.string(),
    redirectUris: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_client_id", ["clientId"]),

  /** A user's durable authorization of an external MCP client. */
  mcpGrants: defineTable({
    ownerId: v.id("users"),
    clientId: v.id("oauthClients"),
    scopes: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_client", ["ownerId", "clientId"]),

  /** One-use, short-lived Authorization Code + PKCE records. */
  oauthAuthorizationCodes: defineTable({
    codeDigest: v.string(),
    grantId: v.id("mcpGrants"),
    clientId: v.id("oauthClients"),
    redirectUri: v.string(),
    resource: v.string(),
    issuer: v.string(),
    scopes: v.array(v.string()),
    codeChallenge: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_code_digest", ["codeDigest"])
    .index("by_expires_at", ["expiresAt"]),

  /** Opaque OAuth access and refresh tokens. Only SHA-256 digests are stored. */
  oauthTokens: defineTable({
    tokenDigest: v.string(),
    grantId: v.id("mcpGrants"),
    kind: v.union(v.literal("access"), v.literal("refresh")),
    issuer: v.string(),
    audience: v.string(),
    scopes: v.array(v.string()),
    issuedAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    replacedAt: v.optional(v.number()),
  })
    .index("by_token_digest", ["tokenDigest"])
    .index("by_grant_and_kind", ["grantId", "kind"])
    .index("by_expires_at", ["expiresAt"]),

  /** Bounded, payload-free transaction summaries for attribution and history. */
  plannerAudit: defineTable({
    ownerId: v.id("users"),
    planId: v.id("plans"),
    actorType: v.union(v.literal("user"), v.literal("mcp")),
    grantId: v.optional(v.id("mcpGrants")),
    createdAt: v.number(),
    baseRevision: v.number(),
    resultRevision: v.number(),
    summary: v.string(),
    affectedEntityIds: v.array(v.string()),
    undoable: v.boolean(),
  })
    .index("by_plan_and_created_at", ["planId", "createdAt"])
    .index("by_owner_and_created_at", ["ownerId", "createdAt"])
    .index("by_created_at", ["createdAt"]),

  /** Recovery payloads are kept separate from audit logs and expire after 30 days. */
  plannerUndo: defineTable({
    auditId: v.id("plannerAudit"),
    ownerId: v.id("users"),
    planId: v.id("plans"),
    inverseCommands: v.array(inverseCommand),
    preferencesRevision: v.optional(v.number()),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_audit", ["auditId"])
    .index("by_expires_at", ["expiresAt"]),

  /** Original results for safe retry of MCP mutations. */
  mcpIdempotency: defineTable({
    grantId: v.id("mcpGrants"),
    key: v.string(),
    operation: v.string(),
    result: idempotentResult,
    createdAt: v.number(),
  })
    .index("by_grant_and_key", ["grantId", "key"])
    .index("by_created_at", ["createdAt"]),

  /** Fixed-window request accounting. Rows are naturally bounded by minute buckets. */
  mcpRateLimits: defineTable({
    grantId: v.id("mcpGrants"),
    window: v.number(),
    count: v.number(),
  })
    .index("by_grant_and_window", ["grantId", "window"])
    .index("by_window", ["window"]),
});
