/**
 * The storage boundary.
 *
 * Everything above this line works in domain types and calls these methods.
 * Nothing above it may import from `convex/` or touch IndexedDB directly —
 * that separation is the point. Previously each of ~20 operations was written
 * twice, once per backend, inside the component that called it, and the two
 * copies had already drifted (dependency-cycle validation existed only on the
 * server, so local mode could build cycles the server would reject).
 *
 * Mutation methods return `void` or a new id rather than an updated snapshot.
 * The Convex implementation is reactive — writes land through its subscription,
 * not through a return value — and having the local implementation return
 * something the Convex one cannot would put the difference right back into
 * every call site.
 */

import type {
  BlockSource,
  EntityId,
  ExamKind,
  ExamStatus,
  IsoDate,
  PlannerSnapshot,
  Preferences,
  Priority,
  TopicStatus,
  Unit,
} from "@/domain/types";
import type { PlannerExport } from "@/lib/import-export";

export type PlanInput = {
  name: string;
  notes?: string;
};

export type CourseInput = {
  name: string;
  code?: string;
  notes?: string;
  color: string;
};

export type ExamInput = {
  name: string;
  kind?: ExamKind;
  startDate: IsoDate;
  endDate?: IsoDate;
  status?: ExamStatus;
  notes?: string;
};

export type TopicInput = {
  name: string;
  unit?: Unit;
  totalUnits?: number;
  priority?: Priority;
  notes?: string;
  color: string;
};

export type TopicPatch = {
  name: string;
  unit: Unit;
  totalUnits: number;
  completedUnits: number;
  status: TopicStatus;
  priority: Priority;
  notes: string;
  color: string;
};

export type StudyBlockInput = {
  topicId: EntityId;
  startDate: IsoDate;
  endDate: IsoDate;
  plannedUnits?: number;
  source?: BlockSource;
};

export type StudyLogInput = {
  topicId: EntityId;
  date: IsoDate;
  units: number;
  minutes?: number;
  note?: string;
};

/** A generated block, before it has an id. */
export type GeneratedBlock = {
  topicId: EntityId;
  startDate: IsoDate;
  endDate: IsoDate;
  plannedUnits?: number;
};

/**
 * `loading` is a distinct state rather than an empty snapshot, because the two
 * render differently: an empty snapshot means "you have no plans yet, here is
 * how to make one", and showing that during startup was one of the audit's
 * findings.
 */
export type RepositoryState =
  | { status: "loading" }
  | { status: "ready"; snapshot: PlannerSnapshot }
  | { status: "error"; error: Error };

export interface PlannerRepository {
  /**
   * Subscribes to state. The listener is called immediately with the current
   * state, then on every change. Returns an unsubscribe function.
   *
   * Push rather than pull because Convex is reactive: another device's edit
   * must reach this one without being asked for.
   */
  subscribe(listener: (state: RepositoryState) => void): () => void;

  createPlan(input: PlanInput): Promise<EntityId>;
  updatePlan(planId: EntityId, input: Required<Pick<PlanInput, "name">> & PlanInput): Promise<void>;
  deletePlan(planId: EntityId): Promise<void>;

  createCourse(planId: EntityId, input: CourseInput): Promise<EntityId>;
  updateCourse(courseId: EntityId, input: CourseInput & { notes: string }): Promise<void>;
  deleteCourse(courseId: EntityId): Promise<void>;
  reorderCourses(planId: EntityId, courseIds: EntityId[]): Promise<void>;

  createExam(courseId: EntityId, input: ExamInput): Promise<EntityId>;
  updateExam(
    examId: EntityId,
    input: Required<Omit<ExamInput, "endDate">> & { endDate?: IsoDate },
  ): Promise<void>;
  deleteExam(examId: EntityId): Promise<void>;

  createTopic(courseId: EntityId, input: TopicInput): Promise<EntityId>;
  /** Bulk path for the outline paste flow. */
  createTopics(
    courseId: EntityId,
    topics: Array<{ name: string; unit: Unit; totalUnits: number }>,
    color: string,
  ): Promise<EntityId[]>;
  updateTopic(topicId: EntityId, patch: TopicPatch): Promise<void>;
  deleteTopic(topicId: EntityId): Promise<void>;
  setTopicDependencies(topicId: EntityId, dependencyIds: EntityId[]): Promise<void>;
  /** New order for every topic in the course. Partial lists are rejected, not merged. */
  reorderTopics(courseId: EntityId, topicIds: EntityId[]): Promise<void>;

  createStudyBlock(input: StudyBlockInput): Promise<EntityId>;
  updateStudyBlock(
    blockId: EntityId,
    input: { startDate: IsoDate; endDate: IsoDate; plannedUnits?: number },
  ): Promise<void>;
  deleteStudyBlock(blockId: EntityId): Promise<void>;
  /** Swaps generated blocks for `topicIds`, leaving `manual` ones untouched. */
  replaceAutoBlocks(topicIds: EntityId[], blocks: GeneratedBlock[]): Promise<void>;

  /** Records a session and advances the topic's completion together. */
  logStudy(input: StudyLogInput): Promise<void>;

  savePreferences(preferences: Preferences): Promise<void>;

  importPlans(document: PlannerExport): Promise<void>;
  /** Destructive: drops everything and writes the supplied document. */
  replaceAll(document: PlannerExport): Promise<void>;
}
