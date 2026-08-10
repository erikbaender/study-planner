import { describe, expect, it, vi } from "vitest";
import { course as makeCourse, plan as makePlan, topic as makeTopic } from "@/test/factories";
import {
  buildCommands,
  filterCommands,
  groupCommands,
  rankCommand,
  type Command,
  type CommandActions,
} from "./commands";

function noopActions(): CommandActions {
  return {
    setView: vi.fn(),
    focusAll: vi.fn(),
    focusAttention: vi.fn(),
    focusSoon: vi.fn(),
    revealCourse: vi.fn(),
    revealTopic: vi.fn(),
    toggleInspector: vi.fn(),
    newSemester: vi.fn(),
    newCourse: vi.fn(),
    loadSampleData: vi.fn(),
    exportJson: vi.fn(),
  };
}

const plan = makePlan({
  courses: [
    makeCourse({
      name: "Biochemistry",
      code: "BC-201",
      topics: [
        makeTopic({ name: "Glycolysis", section: "Block 1" }),
        makeTopic({ name: "Citric acid cycle" }),
      ],
    }),
    makeCourse({ name: "Anatomy", topics: [makeTopic({ name: "Glycoproteins" })] }),
  ],
});

function build(overrides: Partial<Parameters<typeof buildCommands>[0]> = {}) {
  return buildCommands({
    plan,
    hasData: true,
    actions: noopActions(),
    ...overrides,
  });
}

describe("buildCommands", () => {
  it("offers every course and every topic", () => {
    const commands = build();
    expect(commands.filter((command) => command.group === "Courses")).toHaveLength(2);
    expect(commands.filter((command) => command.group === "Topics")).toHaveLength(3);
  });

  it("names the course under each topic, so two identical titles are distinguishable", () => {
    const glycolysis = build().find((command) => command.title === "Glycolysis");
    expect(glycolysis?.subtitle).toBe("Biochemistry · Block 1");
  });

  it("runs the action it was built with", () => {
    const actions = noopActions();
    const commands = buildCommands({ plan, hasData: true, actions });
    commands.find((command) => command.id === "view:outline")!.run();
    expect(actions.setView).toHaveBeenCalledWith("outline");
  });

  it("leaves export out when there is nothing to export", () => {
    // A palette is a list of things you can do. A greyed-out row is a list of
    // things you cannot, which is a different and less useful list.
    expect(build({ hasData: false }).some((command) => command.id === "data:export")).toBe(false);
    expect(build({ hasData: true }).some((command) => command.id === "data:export")).toBe(true);
  });

  it("still offers the view and action commands with no plan at all", () => {
    const commands = build({ plan: undefined });
    expect(commands.some((command) => command.id === "new:semester")).toBe(true);
    expect(commands.some((command) => command.group === "Courses")).toBe(false);
  });
});

describe("rankCommand", () => {
  const of = (title: string, extra: Partial<Command> = {}): Command => ({
    id: title,
    group: "Topics",
    title,
    run: () => {},
    ...extra,
  });

  it("ranks a title prefix above a word prefix above a substring", () => {
    expect(rankCommand("gly", of("Glycolysis"))).toBe(0);
    expect(rankCommand("acid", of("Citric acid cycle"))).toBe(1);
    expect(rankCommand("cid", of("Citric acid cycle"))).toBe(2);
  });

  it("ranks a keyword or subtitle match last", () => {
    expect(rankCommand("biochem", of("Glycolysis", { subtitle: "Biochemistry" }))).toBe(3);
  });

  it("returns null for no match at all", () => {
    expect(rankCommand("zzz", of("Glycolysis"))).toBeNull();
  });

  it("does not match on a subsequence", () => {
    // With ~400 topics whose names repeat, subsequence matching returns most of
    // them for most queries and orders them by accident.
    expect(rankCommand("gls", of("Glycolysis"))).toBeNull();
  });

  it("treats an empty query as a match on everything", () => {
    expect(rankCommand("  ", of("Glycolysis"))).toBe(0);
  });
});

describe("filterCommands", () => {
  it("puts the best match first", () => {
    const matches = filterCommands(build(), "glyco");
    expect(matches[0].title).toBe("Glycolysis");
    expect(matches.map((command) => command.title)).toContain("Glycoproteins");
  });

  it("hides topics until something has been typed", () => {
    // On first open the palette shows the dozen things you might do, not the
    // four hundred that exist.
    const resting = filterCommands(build(), "");
    expect(resting.some((command) => command.group === "Topics")).toBe(false);
    expect(resting.some((command) => command.group === "Courses")).toBe(true);
  });

  it("caps the list", () => {
    const many = makePlan({
      courses: [
        makeCourse({
          name: "Big",
          topics: Array.from({ length: 200 }, (_, index) =>
            makeTopic({ name: `Topic ${index}` }),
          ),
        }),
      ],
    });
    expect(filterCommands(build({ plan: many }), "topic").length).toBe(40);
  });

  it("keeps the declared order within a rank", () => {
    const resting = filterCommands(build(), "");
    const ids = resting.map((command) => command.id);
    expect(ids.indexOf("view:today")).toBeLessThan(ids.indexOf("view:timeline"));
  });
});

describe("groupCommands", () => {
  it("groups in first-seen order and keeps every command", () => {
    const commands = filterCommands(build(), "");
    const groups = groupCommands(commands);
    expect(groups.map(([group]) => group)).toEqual(["View", "Go to", "Actions", "Courses"]);
    expect(groups.reduce((sum, [, items]) => sum + items.length, 0)).toBe(commands.length);
  });
});
