/**
 * What the palette can do.
 *
 * The palette lists every action the app has in one searchable place, so this
 * list is the app's real command surface — if something is doable from a toolbar
 * or a menu and *not* from here, it can only be found by hunting for it.
 *
 * Pure: it takes data and callbacks and returns a list. The ranking below is
 * the interesting half, and it is the reason this is not inline in the
 * component.
 */

import type { Course, Plan, Topic } from "@/domain";

export type CommandGroup = "Go to" | "View" | "Courses" | "Topics" | "Actions";

export type Command = {
  id: string;
  group: CommandGroup;
  title: string;
  /** The line under the title — a course name for a topic, a date for an exam. */
  subtitle?: string;
  /** Extra text to match against, never displayed. */
  keywords?: string;
  run: () => void;
};

export type CommandActions = {
  setView: (view: "today" | "timeline" | "outline") => void;
  focusAll: () => void;
  focusAttention: () => void;
  focusSoon: () => void;
  revealCourse: (course: Course) => void;
  revealTopic: (topic: Topic) => void;
  newSemester: () => void;
  newCourse: () => void;
  loadSampleData: () => void;
  exportJson: () => void;
};

export function buildCommands(options: {
  plan: Plan | undefined;
  actions: CommandActions;
  /** True once there is something to export. Disabled commands are omitted rather than greyed: a palette is a list of things you can do. */
  hasData: boolean;
}): Command[] {
  const { plan, actions, hasData } = options;

  const commands: Command[] = [
    {
      id: "view:today",
      group: "View",
      title: "Today",
      keywords: "now agenda",
      run: () => actions.setView("today"),
    },
    {
      id: "view:timeline",
      group: "View",
      title: "Timeline",
      keywords: "gantt schedule calendar",
      run: () => actions.setView("timeline"),
    },
    {
      id: "view:outline",
      group: "View",
      title: "Outline",
      keywords: "topics table list",
      run: () => actions.setView("outline"),
    },
    {
      id: "focus:all",
      group: "Go to",
      title: "All courses",
      keywords: "everything clear filter",
      run: actions.focusAll,
    },
    {
      id: "focus:attention",
      group: "Go to",
      title: "Attention needed",
      subtitle: "Courses that are behind pace or have overdue work",
      keywords: "behind overdue late catch up",
      run: actions.focusAttention,
    },
    {
      id: "focus:soon",
      group: "Go to",
      title: "Exams soon",
      subtitle: "Courses with an exam in the next two weeks",
      keywords: "upcoming imminent",
      run: actions.focusSoon,
    },
    {
      id: "new:semester",
      group: "Actions",
      title: "New semester",
      keywords: "add create plan term",
      run: actions.newSemester,
    },
    {
      id: "new:course",
      group: "Actions",
      title: "New course",
      keywords: "add create subject",
      run: actions.newCourse,
    },
    {
      id: "data:sample",
      group: "Actions",
      title: "Load sample data",
      subtitle: "Choose from the available sample semesters",
      keywords: "demo seed example",
      run: actions.loadSampleData,
    },
  ];

  if (hasData) {
    commands.push({
      id: "data:export",
      group: "Actions",
      title: "Export as JSON",
      keywords: "download backup save",
      run: actions.exportJson,
    });
  }

  for (const course of plan?.courses ?? []) {
    commands.push({
      id: `course:${course.id}`,
      group: "Courses",
      title: course.name,
      subtitle: `${course.topics.length} topic${course.topics.length === 1 ? "" : "s"}`,
      keywords: course.code,
      run: () => actions.revealCourse(course),
    });

    for (const topic of course.topics) {
      commands.push({
        id: `topic:${topic.id}`,
        group: "Topics",
        title: topic.name,
        subtitle: course.name,
        keywords: course.name,
        run: () => actions.revealTopic(topic),
      });
    }
  }

  return commands;
}

/**
 * How well a command answers what was typed. Lower is better; `null` is no match.
 *
 * Not a fuzzy subsequence matcher. With ~400 topics whose names repeat across
 * courses ("Clinical correlations" appears ten times), subsequence matching
 * returns most of them for most queries and ranks them by accident. Ranking
 * prefix over word-prefix over substring means typing "gly" puts *Glycolysis*
 * first and everything merely containing those letters after it, which is what
 * someone reaching for a specific topic expects.
 */
export function rankCommand(query: string, command: Command): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const title = command.title.toLowerCase();
  if (title.startsWith(needle)) return 0;
  if (title.split(/\s+/).some((word) => word.startsWith(needle))) return 1;
  if (title.includes(needle)) return 2;

  const rest = `${command.subtitle ?? ""} ${command.keywords ?? ""}`.toLowerCase();
  if (rest.includes(needle)) return 3;

  return null;
}

/**
 * The list to show, ranked and capped.
 *
 * The cap is not a scrolling optimisation — it is what keeps the palette a
 * *choice*. An unfiltered list of 400 topics is a directory, and reading it is
 * slower than typing three more letters. With no query the topics are dropped
 * entirely for the same reason: on first open the palette shows the dozen
 * things you might do, not everything that exists.
 */
export function filterCommands(commands: readonly Command[], query: string, limit = 40): Command[] {
  const empty = query.trim() === "";

  return commands
    .filter((command) => !(empty && command.group === "Topics"))
    .map((command) => ({ command, rank: rankCommand(query, command) }))
    .filter((entry): entry is { command: Command; rank: number } => entry.rank !== null)
    // Stable within a rank, so the declaration order above survives — which is
    // what makes the resting list read as an ordered menu rather than a bag.
    .sort((left, right) => left.rank - right.rank)
    .slice(0, limit)
    .map((entry) => entry.command);
}

/** Groups in the order they were declared, for rendering headers. */
export function groupCommands(commands: readonly Command[]): Array<[CommandGroup, Command[]]> {
  const groups = new Map<CommandGroup, Command[]>();
  for (const command of commands) {
    const existing = groups.get(command.group);
    if (existing) existing.push(command);
    else groups.set(command.group, [command]);
  }
  return [...groups];
}
