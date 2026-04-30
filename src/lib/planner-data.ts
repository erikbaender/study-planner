export type PlannerColor = {
  name: string;
  value: string;
  soft: string;
};

export type DateRange = {
  id: string;
  start: string;
  end: string;
};

export type Topic = {
  id: string;
  courseId: string;
  name: string;
  notes: string;
  color: string;
  dependencies: string[];
  ranges: DateRange[];
};

export type Milestone = {
  id: string;
  courseId: string;
  name: string;
  notes: string;
  start: string;
  end?: string;
};

export type Course = {
  id: string;
  planId: string;
  name: string;
  notes: string;
  color: string;
  milestones: Milestone[];
  topics: Topic[];
};

export type Plan = {
  id: string;
  name: string;
  notes: string;
  courses: Course[];
};

export const applePalette: PlannerColor[] = [
  { name: "Red", value: "#ff3b30", soft: "#ffebe9" },
  { name: "Orange", value: "#ff9500", soft: "#fff1dc" },
  { name: "Yellow", value: "#ffcc00", soft: "#fff7c7" },
  { name: "Green", value: "#34c759", soft: "#e4f8e9" },
  { name: "Mint", value: "#00c7be", soft: "#dcf7f5" },
  { name: "Teal", value: "#30b0c7", soft: "#e0f4f8" },
  { name: "Cyan", value: "#32ade6", soft: "#e3f5fc" },
  { name: "Blue", value: "#007aff", soft: "#e2f0ff" },
  { name: "Indigo", value: "#5856d6", soft: "#ecebff" },
  { name: "Purple", value: "#af52de", soft: "#f5e8fb" },
  { name: "Pink", value: "#ff2d55", soft: "#ffe6ec" },
  { name: "Brown", value: "#a2845e", soft: "#f2ece4" },
  { name: "Gray", value: "#8e8e93", soft: "#eeeeef" },
];

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function leastUsedColor(plans: Plan[]) {
  const usage = new Map(applePalette.map((color) => [color.value, 0]));

  for (const plan of plans) {
    for (const course of plan.courses) {
      usage.set(course.color, (usage.get(course.color) ?? 0) + 1);
      for (const topic of course.topics) {
        usage.set(topic.color, (usage.get(topic.color) ?? 0) + 1);
      }
    }
  }

  return [...applePalette].sort((left, right) => {
    const usageDiff = (usage.get(left.value) ?? 0) - (usage.get(right.value) ?? 0);
    return usageDiff || left.name.localeCompare(right.name);
  })[0].value;
}

export const samplePlans: Plan[] = [
  {
    id: "plan_mcat",
    name: "Summer Exam Sprint",
    notes: "A focused study plan for upcoming course exams.",
    courses: [
      {
        id: "course_physio",
        planId: "plan_mcat",
        name: "Physiology 3",
        notes: "Systems review and final consolidation.",
        color: "#007aff",
        milestones: [
          {
            id: "milestone_physio_exam",
            courseId: "course_physio",
            name: "Physiology exam",
            notes: "Written assessment window.",
            start: "2026-07-07",
          },
        ],
        topics: [
          {
            id: "topic_mechanics",
            courseId: "course_physio",
            name: "Mechanics and heat",
            notes: "Problem sets plus repetition block.",
            color: "#007aff",
            dependencies: [],
            ranges: [
              { id: "range_mechanics_a", start: "2026-05-18", end: "2026-05-25" },
              { id: "range_mechanics_b", start: "2026-06-12", end: "2026-06-15" },
            ],
          },
          {
            id: "topic_repetition",
            courseId: "course_physio",
            name: "Repetition",
            notes: "Final spaced review before the milestone.",
            color: "#34c759",
            dependencies: ["topic_mechanics"],
            ranges: [{ id: "range_repetition", start: "2026-07-01", end: "2026-07-06" }],
          },
        ],
      },
      {
        id: "course_biochem",
        planId: "plan_mcat",
        name: "Biochemistry",
        notes: "Sections imported from issue-style planning.",
        color: "#ff9500",
        milestones: [
          {
            id: "milestone_biochem_exam",
            courseId: "course_biochem",
            name: "Biochemistry exam",
            notes: "Course deadline.",
            start: "2026-07-16",
          },
        ],
        topics: [
          {
            id: "topic_biochem_teil_2",
            courseId: "course_biochem",
            name: "Teil 2",
            notes: "Initial content block.",
            color: "#ff9500",
            dependencies: [],
            ranges: [{ id: "range_biochem_2", start: "2026-06-02", end: "2026-06-07" }],
          },
          {
            id: "topic_biochem_teil_7",
            courseId: "course_biochem",
            name: "Teil 7",
            notes: "Later content block.",
            color: "#af52de",
            dependencies: ["topic_biochem_teil_2"],
            ranges: [{ id: "range_biochem_7", start: "2026-07-09", end: "2026-07-15" }],
          },
        ],
      },
    ],
  },
];

export function getPaletteColor(value: string) {
  return applePalette.find((color) => color.value === value) ?? applePalette[7];
}