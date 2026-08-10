/**
 * Core domain types.
 *
 * These are storage-agnostic: no Convex `Id`, no `_id`, no `_creationTime`.
 * Repositories translate to and from their own representations at the boundary
 * so that nothing above `src/data/` knows which backend is in use.
 */

/** An ISO calendar date, `YYYY-MM-DD`. Never a timestamp — the planner is day-granular. */
export type IsoDate = string;

export type EntityId = string;

/** How a topic's material is counted. Chosen per topic, so a course can mix them. */
export const UNITS = ["slides", "pages", "cards", "videos", "hours", "items"] as const;
export type Unit = (typeof UNITS)[number];

export const UNIT_LABELS: Record<Unit, { singular: string; plural: string }> = {
  slides: { singular: "slide", plural: "slides" },
  pages: { singular: "page", plural: "pages" },
  cards: { singular: "card", plural: "cards" },
  videos: { singular: "video", plural: "videos" },
  hours: { singular: "hour", plural: "hours" },
  items: { singular: "item", plural: "items" },
};

/** Derived from progress by `topicStatus`, never stored — see `src/domain/metrics.ts`. */
export const TOPIC_STATUSES = ["planned", "active", "done"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const EXAM_KINDS = ["exam", "deadline", "presentation", "other"] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

/**
 * `provisional` means the date is not yet fixed — typically an announced exam
 * window rather than a day. The UI must render the two differently; scheduling
 * treats a provisional window's *start* as the effective deadline, since
 * planning for the optimistic end of a window is how you miss the exam.
 */
export const EXAM_STATUSES = ["confirmed", "provisional"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

/**
 * Whether a study block was placed by the scheduler or by hand.
 *
 * Load-bearing: reflow regenerates `auto` blocks and must never move or delete
 * a `manual` one.
 */
export type BlockSource = "auto" | "manual";

/** Day of week, 0 = Sunday, matching `Date.prototype.getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type StudyBlock = {
  id: EntityId;
  topicId: EntityId;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Units the scheduler intends to cover here. Absent on hand-drawn blocks. */
  plannedUnits?: number;
  source: BlockSource;
};

export type Topic = {
  id: EntityId;
  courseId: EntityId;
  name: string;
  unit: Unit;
  /** `0` means the topic's size is untracked; it is then excluded from pace maths. */
  totalUnits: number;
  completedUnits: number;
  dependencyIds: EntityId[];
  color: string;
  notes: string;
  order: number;
  blocks: StudyBlock[];
};

export type Exam = {
  id: EntityId;
  courseId: EntityId;
  name: string;
  kind: ExamKind;
  startDate: IsoDate;
  /** Present only on provisional exams, marking the far end of the window. */
  endDate?: IsoDate;
  status: ExamStatus;
  notes: string;
  order: number;
};

export type Course = {
  id: EntityId;
  planId: EntityId;
  name: string;
  code?: string;
  color: string;
  notes: string;
  order: number;
  exams: Exam[];
  topics: Topic[];
};

/** Surfaced in the UI as a "Semester". */
export type Plan = {
  id: EntityId;
  name: string;
  notes: string;
  courses: Course[];
};

/** A logged study session. The raw material for velocity and streaks. */
export type StudyLogEntry = {
  id: EntityId;
  topicId: EntityId;
  date: IsoDate;
  units: number;
  minutes?: number;
  note?: string;
};

export type ThemePreference = "system" | "light" | "dark";

export type Preferences = {
  /** Units per study day. Absent means "not yet told us", not zero. */
  dailyCapacityUnits?: number;
  studyDaysOfWeek: Weekday[];
  /** Days off — holidays, travel. Excluded from scheduling. */
  blackoutDates: IsoDate[];
  theme: ThemePreference;
  accentColor: string;
};

export const DEFAULT_PREFERENCES: Preferences = {
  dailyCapacityUnits: undefined,
  studyDaysOfWeek: [1, 2, 3, 4, 5, 6],
  blackoutDates: [],
  theme: "system",
  accentColor: "#1769e0",
};

/** Everything the app needs to render, as returned by `PlannerRepository.snapshot`. */
export type PlannerSnapshot = {
  plans: Plan[];
  studyLog: StudyLogEntry[];
  preferences: Preferences;
};

export const EMPTY_SNAPSHOT: PlannerSnapshot = {
  plans: [],
  studyLog: [],
  preferences: DEFAULT_PREFERENCES,
};
