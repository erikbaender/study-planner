/**
 * Development and test seed data.
 *
 * Modelled on the guiding persona: a second-year medical student with ten
 * courses, hundreds of topics, and an exam period that is only half confirmed.
 * ~350 topics is deliberately the awkward size — it is both the fixture the
 * timeline's virtualization has to survive and the dataset the scheduling
 * engine is tuned against, so the worst case is present from the first phase
 * rather than discovered in the last.
 *
 * Fully deterministic: a seeded PRNG, and every date derived from an injected
 * `today`. Two runs with the same argument produce byte-identical output, which
 * is what lets tests assert on it.
 */

import { addDays, weekdayOf } from "./dates";
import { topicStatus } from "./metrics";
import { coursePalette } from "./palette";
import type {
  Course,
  Exam,
  IsoDate,
  Plan,
  Preferences,
  StudyBlock,
  StudyLogEntry,
  Topic,
  Unit,
} from "./types";

/**
 * Mulberry32. Small, fast, and stable across engines — `Math.random` would make
 * the fixture different on every run and useless for assertions.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type CourseBlueprint = {
  name: string;
  code: string;
  unit: Unit;
  topicGroups: number;
  topicsPerGroup: number;
  /** Days from `today` to the exam. Negative values are not used. */
  examOffset: number;
  examStatus: "confirmed" | "provisional";
  /** Roughly how far through the material the student is, `0`–`1`. */
  completion: number;
};

const COURSE_BLUEPRINTS: CourseBlueprint[] = [
  {
    name: "Biochemistry",
    code: "BIO-201",
    unit: "slides",
    topicGroups: 4,
    topicsPerGroup: 11,
    examOffset: 24,
    examStatus: "confirmed",
    completion: 0.42,
  },
  {
    name: "Physiology",
    code: "PHY-202",
    unit: "slides",
    topicGroups: 4,
    topicsPerGroup: 10,
    examOffset: 38,
    examStatus: "confirmed",
    completion: 0.31,
  },
  {
    name: "Anatomy",
    code: "ANA-203",
    unit: "pages",
    topicGroups: 5,
    topicsPerGroup: 9,
    examOffset: 17,
    examStatus: "confirmed",
    completion: 0.68,
  },
  {
    name: "Histology",
    code: "HIS-204",
    unit: "slides",
    topicGroups: 3,
    topicsPerGroup: 10,
    examOffset: 45,
    examStatus: "provisional",
    completion: 0.15,
  },
  {
    name: "Pharmacology",
    code: "PHA-301",
    unit: "cards",
    topicGroups: 4,
    topicsPerGroup: 12,
    examOffset: 52,
    examStatus: "provisional",
    completion: 0.08,
  },
  {
    name: "Pathology",
    code: "PAT-302",
    unit: "slides",
    topicGroups: 3,
    topicsPerGroup: 13,
    examOffset: 31,
    examStatus: "confirmed",
    completion: 0.22,
  },
  {
    name: "Microbiology",
    code: "MIC-303",
    unit: "cards",
    topicGroups: 3,
    topicsPerGroup: 12,
    examOffset: 59,
    examStatus: "provisional",
    completion: 0.05,
  },
  {
    name: "Immunology",
    code: "IMM-304",
    unit: "videos",
    topicGroups: 3,
    topicsPerGroup: 8,
    examOffset: 41,
    examStatus: "provisional",
    completion: 0.19,
  },
  {
    name: "Medical psychology",
    code: "PSY-105",
    unit: "pages",
    topicGroups: 2,
    topicsPerGroup: 9,
    examOffset: 12,
    examStatus: "confirmed",
    completion: 0.77,
  },
  {
    name: "Epidemiology",
    code: "EPI-106",
    unit: "slides",
    topicGroups: 2,
    topicsPerGroup: 10,
    examOffset: 8,
    examStatus: "confirmed",
    completion: 0.85,
  },
];

const TOPIC_NAMES = [
  "Overview and terminology",
  "Structure and classification",
  "Regulation and control",
  "Clinical correlations",
  "Transport mechanisms",
  "Energy metabolism",
  "Membrane dynamics",
  "Signalling cascades",
  "Developmental aspects",
  "Pathophysiology",
  "Diagnostic approach",
  "Therapeutic principles",
  "Case discussions",
];

export type SeedOptions = {
  /** Anchor for every generated date. */
  today: IsoDate;
  seed?: number;
  /** Trim the course list, e.g. for a smaller unit-test fixture. */
  courseLimit?: number;
};

export type SeedData = {
  plan: Plan;
  studyLog: StudyLogEntry[];
  /** Optional scenario settings. Omitted fixtures leave the user's settings alone. */
  preferences?: Preferences;
};

export function generateSeedData(options: SeedOptions): SeedData {
  const { today, seed = 20260729, courseLimit } = options;
  const random = createRandom(seed);
  const blueprints = courseLimit ? COURSE_BLUEPRINTS.slice(0, courseLimit) : COURSE_BLUEPRINTS;

  const planId = "plan_seed";
  const studyLog: StudyLogEntry[] = [];

  const courses: Course[] = blueprints.map((blueprint, courseIndex) => {
    const courseId = `course_${slug(blueprint.code)}`;
    const color = coursePalette[courseIndex % coursePalette.length].id;

    const exams: Exam[] = [
      {
        id: `exam_${slug(blueprint.code)}`,
        courseId,
        name: `${blueprint.name} exam`,
        kind: "exam",
        startDate: addDays(today, blueprint.examOffset),
        // A provisional exam is an announced window, not a day.
        endDate:
          blueprint.examStatus === "provisional"
            ? addDays(today, blueprint.examOffset + 6)
            : undefined,
        status: blueprint.examStatus,
        notes:
          blueprint.examStatus === "provisional"
            ? "Date not yet confirmed by the faculty."
            : "",
        order: 0,
      },
    ];

    const topics: Topic[] = [];
    let order = 0;

    // Group count shapes the pacing below: dependency chains reset and
    // completion tapers per group, even though grouping is not stored on topics.
    for (let groupIndex = 0; groupIndex < blueprint.topicGroups; groupIndex += 1) {
      let previousTopicId: string | undefined;

      for (let index = 0; index < blueprint.topicsPerGroup; index += 1) {
        const topicId = `topic_${slug(blueprint.code)}_${order}`;
        const name = `${TOPIC_NAMES[(order + courseIndex) % TOPIC_NAMES.length]}`;
        const totalUnits = sizeFor(blueprint.unit, random);

        // Completion tapers across the course so early groups look worked
        // through and later ones untouched, which is how revision actually
        // looks partway through a semester.
        const positionRatio = order / (blueprint.topicGroups * blueprint.topicsPerGroup);
        const localCompletion = clamp01(
          blueprint.completion * 2 - positionRatio * 1.4 + (random() - 0.5) * 0.2,
        );
        const completedUnits = Math.round(totalUnits * localCompletion);

        topics.push({
          id: topicId,
          courseId,
          name,
          unit: blueprint.unit,
          totalUnits,
          completedUnits,
          // A short chain every few topics, so dependency handling is exercised
          // without producing an unreadable graph.
          dependencyIds: previousTopicId && index % 4 === 3 ? [previousTopicId] : [],
          color,
          notes: "",
          order,
          blocks: [],
        });

        previousTopicId = topicId;
        order += 1;
      }
    }

    // A handful of hand-placed blocks per course, so reflow has `manual` blocks
    // to preserve from the very first run.
    for (const topic of topics) {
      if (topicStatus(topic) === "planned" && random() < 0.12) {
        const start = addDays(today, Math.floor(random() * Math.max(blueprint.examOffset - 2, 1)));
        topic.blocks.push({
          id: `block_${topic.id}`,
          topicId: topic.id,
          startDate: start,
          endDate: addDays(start, 1 + Math.floor(random() * 3)),
          plannedUnits: Math.max(1, Math.round(topic.totalUnits / 3)),
          source: "manual",
        } satisfies StudyBlock);
      }
    }

    return {
      id: courseId,
      planId,
      name: blueprint.name,
      code: blueprint.code,
      color,
      notes: "",
      order: courseIndex,
      exams,
      topics,
    };
  });

  // Two weeks of history, weekdays only, so velocity has something to read on
  // the first launch instead of reporting zero and declaring everything behind.
  for (let dayOffset = 14; dayOffset >= 1; dayOffset -= 1) {
    const date = addDays(today, -dayOffset);
    const weekday = weekdayOf(date);
    if (weekday === 0) continue;

    const sessionCount = 1 + Math.floor(random() * 3);
    for (let session = 0; session < sessionCount; session += 1) {
      const course = courses[Math.floor(random() * courses.length)];
      const topic = course.topics[Math.floor(random() * course.topics.length)];
      studyLog.push({
        id: `log_${date}_${session}`,
        topicId: topic.id,
        date,
        units: 10 + Math.floor(random() * 40),
        minutes: 30 + Math.floor(random() * 90),
      });
    }
  }

  return {
    plan: {
      id: planId,
      name: "Winter semester",
      notes: "Seeded development data.",
      courses,
    },
    studyLog,
  };
}

function sizeFor(unit: Unit, random: () => number): number {
  switch (unit) {
    case "slides":
      return 40 + Math.floor(random() * 120);
    case "pages":
      return 15 + Math.floor(random() * 60);
    case "cards":
      return 30 + Math.floor(random() * 90);
    case "videos":
      return 3 + Math.floor(random() * 10);
    case "hours":
      return 2 + Math.floor(random() * 8);
    default:
      return 10 + Math.floor(random() * 40);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
