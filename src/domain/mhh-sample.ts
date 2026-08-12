/**
 * A static sample captured from Erik's private GitHub Project "Lernplan"
 * (https://github.com/users/erikbaender/projects/7).
 *
 * The project contains 123 issues. Thirty-four undated `Teil …` issues are
 * progress subissues rather than standalone subjects, so this fixture follows
 * the importer's established rule and leaves them out. The remaining 89
 * topics, their Project status and 86 Project date ranges are preserved in the
 * source language. Keeping the capture local makes "Load sample data" work in
 * local mode and without granting the browser access to a private repository.
 */

import { addDays, weekdayOf } from "./dates";
import { coursePalette } from "./palette";
import type { SeedData } from "./seed";
import type {
  Course,
  IsoDate,
  Preferences,
  StudyLogEntry,
  Topic,
  Unit,
} from "./types";

type TopicBlueprint = readonly [
  issueNumber: number,
  name: string,
  completed: boolean,
  startDate?: IsoDate,
  endDate?: IsoDate,
];

type CourseBlueprint = {
  name: string;
  examDate: IsoDate;
  topics: readonly TopicBlueprint[];
};

const COURSES: readonly CourseBlueprint[] = [
  {
    name: "Physiologie 2",
    examDate: "2026-05-26",
    topics: [
      [11, "Atmung", true, "2026-03-16", "2026-03-22"],
      [12, "Blut", true, "2026-03-23", "2026-03-29"],
      [13, "Energieumsatz", true, "2026-03-23", "2026-03-29"],
      [14, "Herz", true, "2026-03-30", "2026-04-05"],
      [15, "Elektrokardiogramm", true, "2026-03-30", "2026-04-05"],
      [16, "Kreislauf", true, "2026-04-06", "2026-04-12"],
      [17, "Leistungsphysiologie", true, "2026-03-23", "2026-03-29"],
      [18, "Niere", true, "2026-04-06", "2026-04-12"],
      [19, "Säure-Basen-Haushalt", false, "2026-04-20", "2026-04-26"],
      [20, "Strömung", false, "2026-04-20", "2026-04-26"],
      [21, "Repetitorium", false, "2026-04-27", "2026-05-10"],
      [85, "Wiederholung", false, "2026-05-11", "2026-05-25"],
      [108, "Herz 1", true],
      [109, "Herz 2", true],
    ],
  },
  {
    name: "Biochemie",
    examDate: "2026-07-16",
    topics: [
      [30, "Einführung", true, "2026-03-16", "2026-03-22"],
      [31, "Aminosäuren & Peptide", true, "2026-03-16", "2026-03-22"],
      [32, "Proteine", true, "2026-03-23", "2026-03-29"],
      [33, "Enzyme", true, "2026-03-23", "2026-03-29"],
      [34, "Proteinabbau", true, "2026-03-30", "2026-04-05"],
      [35, "Aminosäurestoffwechsel", true, "2026-04-06", "2026-04-12"],
      [36, "Immunsystem", true, "2026-04-06", "2026-04-12"],
      [37, "Nukleinsäuren", false, "2026-04-13", "2026-04-19"],
      [38, "Krebs", false, "2026-05-05", "2026-05-11"],
      [39, "Lipide & Membranen", false, "2026-04-13", "2026-04-19"],
      [40, "Fettsäuremetabolismus", false, "2026-04-13", "2026-04-19"],
      [41, "Phospholipide & Vitamine", false, "2026-04-20", "2026-04-26"],
      [42, "Eicosanoide", false, "2026-04-20", "2026-04-26"],
      [43, "Biologische Oxidation", false, "2026-05-05", "2026-05-11"],
      [44, "Hormone", false, "2026-04-27", "2026-05-03"],
      [45, "Kohlenhydrate", false, "2026-04-27", "2026-05-03"],
      [46, "Glucosehomöostase", false, "2026-05-11", "2026-05-17"],
      [47, "Diabetes", false, "2026-05-11", "2026-05-17"],
      [48, "Vitamine", false, "2026-05-18", "2026-05-24"],
      [49, "Repetitorium", false, "2026-05-25", "2026-06-21"],
      [88, "Wiederholung", false, "2026-06-22", "2026-07-15"],
    ],
  },
  {
    name: "Physiologie 3",
    examDate: "2026-07-07",
    topics: [
      [22, "Zentrales Nervensystem", false, "2026-03-16", "2026-04-25"],
      [23, "Akustik", false, "2026-05-11", "2026-05-17"],
      [24, "Ohr", false, "2026-05-18", "2026-05-24"],
      [25, "Optik", false, "2026-05-25", "2026-05-31"],
      [26, "Auge", false, "2026-05-25", "2026-05-31"],
      [27, "Bildgebende Diagnostik", false, "2026-06-01", "2026-06-07"],
      [28, "Hormone", false, "2026-06-08", "2026-06-14"],
      [29, "Repetitorium", false, "2026-06-15", "2026-06-28"],
      [86, "Wiederholung", false, "2026-06-22", "2026-07-06"],
    ],
  },
  {
    name: "OSCE",
    examDate: "2026-07-14",
    topics: [
      [65, "Anamnese", true, "2026-03-16", "2026-03-22"],
      [66, "Bewegungsapparat", true, "2026-03-30", "2026-04-05"],
      [67, "Diagnosemitteilung", true, "2026-05-05", "2026-05-11"],
      [68, "Innere Medizin", true, "2026-05-05", "2026-05-11"],
      [69, "Medical Skills", false, "2026-05-05", "2026-05-11"],
      [70, "Neurologie", false, "2026-04-27", "2026-05-03"],
      [71, "Radiologie", false, "2026-05-18", "2026-05-24"],
      [91, "Wiederholung", false, "2026-06-01", "2026-07-13"],
    ],
  },
  {
    name: "Genetik",
    examDate: "2026-07-07",
    topics: [
      [72, "Chromosom-Fehlverteilungen", false, "2026-05-25", "2026-05-31"],
      [73, "Chromosom-Abberationen", false, "2026-05-25", "2026-05-31"],
      [74, "Hämatoonkogenetik", false, "2026-05-25", "2026-05-31"],
      [75, "Autosomale Dominanz", false, "2026-06-01", "2026-06-07"],
      [76, "Sondervererbung", false, "2026-06-01", "2026-06-07"],
      [77, "Molekulare Grundlagen", false, "2026-06-01", "2026-06-07"],
      [78, "Genanalyse", false, "2026-06-01", "2026-06-07"],
      [79, "Tumorrisikosyndrome", false, "2026-06-08", "2026-06-14"],
      [80, "Trinukleotiderkrankungen", false, "2026-06-08", "2026-06-14"],
      [81, "Epigenetik", false, "2026-06-08", "2026-06-14"],
      [82, "Fallbeispiel", false, "2026-06-15", "2026-06-21"],
      [90, "Wiederholung", false, "2026-06-22", "2026-07-06"],
    ],
  },
  {
    name: "Psychologie & Soziologie",
    examDate: "2026-07-06",
    topics: [
      [50, "Gesundheit & Krankheit", true, "2026-03-16", "2026-03-22"],
      [51, "Methoden", true, "2026-03-30", "2026-04-05"],
      [52, "Lernen", true, "2026-04-13", "2026-04-19"],
      [53, "Demographie", true, "2026-04-13", "2026-04-19"],
      [54, "Gedächtnis", false, "2026-04-27", "2026-05-03"],
      [55, "Soziale Ungleichheit", false, "2026-05-11", "2026-05-17"],
      [56, "Emotionen", false, "2026-05-25", "2026-05-31"],
      [57, "Motivation", false, "2026-05-25", "2026-05-31"],
      [58, "Sozialisation", false, "2026-06-01", "2026-06-07"],
      [59, "Stress", false, "2026-06-01", "2026-06-07"],
      [60, "Gesundheitssystem", false, "2026-06-08", "2026-06-14"],
      [61, "Entwicklungspsychologie", false, "2026-06-08", "2026-06-14"],
      [62, "Prävention", false, "2026-06-15", "2026-06-21"],
      [63, "Adhärenz", false, "2026-06-15", "2026-06-21"],
      [64, "Krankheitsbewältigung", false, "2026-06-22", "2026-06-28"],
      [89, "Wiederholung", false],
    ],
  },
  {
    name: "Physiologie Abschluss",
    examDate: "2026-08-14",
    topics: [
      [4, "Elektrizität", true, "2026-03-16", "2026-03-22"],
      [5, "Skelettmuskel", true, "2026-03-23", "2026-03-29"],
      [6, "Glatter Muskel", true, "2026-03-30", "2026-04-05"],
      [7, "Vegetatives Nervensystem", false, "2026-07-17", "2026-07-23"],
      [8, "Nerv", false, "2026-07-17", "2026-07-23"],
      [9, "Synapse", false, "2026-07-17", "2026-07-23"],
      [10, "Repetitorium", false, "2026-07-13", "2026-07-19"],
      [83, "Mechanik & Wärme", false, "2026-07-17", "2026-07-23"],
      [87, "Wiederholung", false, "2026-07-17", "2026-08-10"],
    ],
  },
];

export function generateMhhSampleData(): SeedData {
  const planId = "plan_sample_mhh";
  const courses: Course[] = COURSES.map((blueprint, courseIndex) => {
    const courseId = `course_sample_mhh_${courseIndex}`;
    const color = coursePalette[courseIndex % coursePalette.length].id;

    return {
      id: courseId,
      planId,
      name: blueprint.name,
      color,
      notes: "From erikbaender/mhh in GitHub Project ‘Lernplan’.",
      order: courseIndex,
      exams: [
        {
          id: `exam_sample_mhh_${courseIndex}`,
          courseId,
          name: blueprint.name,
          kind: "exam",
          startDate: blueprint.examDate,
          status: "confirmed",
          notes: "Milestone due date from erikbaender/mhh.",
          order: 0,
        },
      ],
      topics: blueprint.topics.map((topic, topicIndex) =>
        buildTopic(courseId, color, topic, topicIndex),
      ),
    };
  });

  return {
    plan: {
      id: planId,
      name: "Lernplan",
      notes: "Sample captured from GitHub Project ‘Lernplan’ (erikbaender/mhh).",
      courses,
    },
    studyLog: [],
  };
}

/**
 * Turns the same real course/topic outline into a date-relative product demo.
 * Unlike the faithful capture above, this deliberately invents workload and
 * progress because the source project tracks neither. The profiles are tuned
 * so two courses are behind at their recent pace while five remain on track.
 */
export function generateMhhShowcaseData(today: IsoDate): SeedData {
  const planId = "plan_sample_mhh_showcase";
  const profiles = [
    { examOffset: 18, completion: 0.46, velocity: 12, provisional: false },
    { examOffset: 42, completion: 0.58, velocity: 34, provisional: false },
    { examOffset: 29, completion: 0.34, velocity: 10, provisional: true },
    { examOffset: 36, completion: 0.68, velocity: 5, provisional: false },
    { examOffset: 55, completion: 0.52, velocity: 25, provisional: true },
    { examOffset: 24, completion: 0.74, velocity: 24, provisional: false },
    { examOffset: 72, completion: 0.43, velocity: 36, provisional: false },
  ] as const;

  const courses: Course[] = COURSES.map((blueprint, courseIndex) => {
    const profile = profiles[courseIndex];
    const courseId = `course_sample_mhh_showcase_${courseIndex}`;
    const color = coursePalette[courseIndex % coursePalette.length].id;
    const examDate = addDays(today, profile.examOffset);
    const completionPoint = blueprint.topics.length * profile.completion;

    const topics = blueprint.topics.map((blueprintTopic, topicIndex) => {
      const [issueNumber, name] = blueprintTopic;
      const topicId = `topic_sample_mhh_showcase_${issueNumber}`;
      const unit = showcaseUnit(courseIndex, topicIndex, name);
      const totalUnits = showcaseSize(unit, issueNumber);
      const completedUnits =
        topicIndex < Math.floor(completionPoint)
          ? totalUnits
          : topicIndex === Math.floor(completionPoint)
            ? Math.max(1, Math.round(totalUnits * (completionPoint % 1 || 0.45)))
            : 0;
      const status =
        completedUnits >= totalUnits ? "done" : completedUnits > 0 ? "active" : "planned";

      return {
        id: topicId,
        courseId,
        name,
        unit,
        totalUnits,
        completedUnits,
        status,
        priority:
          status === "active" || topicIndex % 5 === 0
            ? "high"
            : topicIndex % 6 === 0
              ? "low"
              : "normal",
        dependencyIds:
          topicIndex > 0 && topicIndex % 4 === 0
            ? [`topic_sample_mhh_showcase_${blueprint.topics[topicIndex - 1][0]}`]
            : [],
        color,
        notes: `Demo workload based on https://github.com/erikbaender/mhh/issues/${issueNumber}`,
        order: topicIndex,
        blocks: showcaseBlocks({
          topicId,
          topicIndex,
          completionPoint,
          status,
          totalUnits,
          completedUnits,
          today,
          examDate,
        }),
      } satisfies Topic;
    });

    return {
      id: courseId,
      planId,
      name: blueprint.name,
      color,
      notes: "Feature-showcase scenario based on the GitHub Project ‘Lernplan’.",
      order: courseIndex,
      exams: [
        {
          id: `exam_sample_mhh_showcase_${courseIndex}`,
          courseId,
          name: `${blueprint.name} Prüfung`,
          kind: courseIndex === 3 ? "presentation" : "exam",
          startDate: examDate,
          endDate: profile.provisional ? addDays(examDate, 5) : undefined,
          status: profile.provisional ? "provisional" : "confirmed",
          notes: profile.provisional
            ? "Prüfungszeitraum ist angekündigt; der genaue Termin steht noch nicht fest."
            : "Bestätigter Prüfungstermin.",
          order: 0,
        },
      ],
      topics,
    };
  });

  const preferences: Preferences = {
    dailyCapacityUnits: 60,
    studyDaysOfWeek: [1, 2, 3, 4, 5, 6],
    blackoutDates: [addDays(today, 12)],
    theme: "system",
    accentColor: "#1769e0",
  };

  return {
    plan: {
      id: planId,
      name: "Lernplan · Showcase",
      notes:
        "A date-relative demonstration scenario using the courses and topics from GitHub Project ‘Lernplan’.",
      courses,
    },
    studyLog: showcaseStudyLog(courses, profiles, today, preferences),
    preferences,
  };
}

function showcaseUnit(courseIndex: number, topicIndex: number, name: string): Unit {
  if (/Wiederholung|Repetitorium/.test(name)) return "cards";
  if (courseIndex === 3) return topicIndex === 6 ? "videos" : "hours";
  if (courseIndex === 4) return topicIndex % 4 === 3 ? "pages" : "cards";
  if (courseIndex === 5) return topicIndex % 5 === 0 ? "cards" : "pages";
  if (courseIndex === 2 && topicIndex % 3 === 1) return "videos";
  if (courseIndex === 1 && topicIndex % 6 === 4) return "pages";
  return "slides";
}

function showcaseSize(unit: Unit, issueNumber: number): number {
  switch (unit) {
    case "slides":
      return 45 + ((issueNumber * 17) % 76);
    case "pages":
      return 18 + ((issueNumber * 11) % 35);
    case "cards":
      return 60 + ((issueNumber * 23) % 101);
    case "videos":
      return 3 + (issueNumber % 7);
    case "hours":
      return 4 + (issueNumber % 9);
    default:
      return 1;
  }
}

function showcaseBlocks(options: {
  topicId: string;
  topicIndex: number;
  completionPoint: number;
  status: Topic["status"];
  totalUnits: number;
  completedUnits: number;
  today: IsoDate;
  examDate: IsoDate;
}): Topic["blocks"] {
  const { topicId, topicIndex, completionPoint, status, totalUnits, completedUnits, today, examDate } =
    options;

  if (status === "done") {
    if (topicIndex % 2 !== 0) return [];
    const endDate = addDays(today, -(Math.floor(completionPoint) - topicIndex) * 4 - 3);
    return [
      {
        id: `block_${topicId}`,
        topicId,
        startDate: addDays(endDate, -2),
        endDate,
        plannedUnits: totalUnits,
        source: "manual",
      },
    ];
  }

  if (status === "active") {
    return [
      {
        id: `block_${topicId}`,
        topicId,
        startDate: addDays(today, -1),
        endDate: addDays(today, 2),
        plannedUnits: Math.max(1, Math.min(totalUnits - completedUnits, Math.round(totalUnits * 0.3))),
        source: "manual",
      },
    ];
  }

  // Leave every fourth untouched topic unplanned so Reflow has useful work to do.
  if (topicIndex % 4 === 3) return [];
  const plannedIndex = Math.max(0, topicIndex - Math.floor(completionPoint));
  const idealStart = addDays(today, 4 + plannedIndex * 3);
  const latestStart = addDays(examDate, -3);
  const startDate = idealStart < latestStart ? idealStart : latestStart;

  return [
    {
      id: `block_${topicId}`,
      topicId,
      startDate,
      endDate: addDays(startDate, 2),
      plannedUnits: Math.max(1, Math.round(totalUnits * 0.35)),
      source: topicIndex % 3 === 0 ? "manual" : "auto",
    },
  ];
}

function showcaseStudyLog(
  courses: readonly Course[],
  profiles: readonly { velocity: number }[],
  today: IsoDate,
  preferences: Preferences,
): StudyLogEntry[] {
  const log: StudyLogEntry[] = [];

  for (let dayOffset = 6; dayOffset >= 0; dayOffset -= 1) {
    const date = addDays(today, -dayOffset);
    const weekday = weekdayOf(date);
    if (!preferences.studyDaysOfWeek.includes(weekday)) {
      continue;
    }

    courses.forEach((course, courseIndex) => {
      const worked = course.topics.filter(
        (topic) =>
          topic.completedUnits > 0 && topic.totalUnits >= profiles[courseIndex].velocity,
      );
      const topic = worked[dayOffset % worked.length];
      log.push({
        id: `log_sample_mhh_showcase_${courseIndex}_${date}`,
        topicId: topic.id,
        date,
        units: profiles[courseIndex].velocity,
        minutes:
          courseIndex === 3 ? profiles[courseIndex].velocity * 60 : 25 + courseIndex * 8,
        note: dayOffset === 0 ? "Focused review session" : undefined,
      });
    });
  }

  return log;
}

function buildTopic(
  courseId: string,
  color: string,
  [issueNumber, name, completed, startDate, endDate]: TopicBlueprint,
  order: number,
): Topic {
  const topicId = `topic_sample_mhh_${issueNumber}`;

  return {
    id: topicId,
    courseId,
    name,
    unit: "items",
    totalUnits: 1,
    completedUnits: completed ? 1 : 0,
    status: completed ? "done" : "planned",
    priority: "normal",
    dependencyIds: [],
    color,
    notes: `Source: https://github.com/erikbaender/mhh/issues/${issueNumber}`,
    order,
    blocks:
      startDate && endDate
        ? [
            {
              id: `block_sample_mhh_${issueNumber}`,
              topicId,
              startDate,
              endDate,
              source: "manual",
            },
          ]
        : [],
  };
}
