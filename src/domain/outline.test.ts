import { describe, expect, it } from "vitest";
import { formatOutline, normalizeUnit, parseOutline } from "./outline";

describe("normalizeUnit", () => {
  it("accepts canonical names, aliases, and casing", () => {
    expect(normalizeUnit("slides")).toBe("slides");
    expect(normalizeUnit("Slide")).toBe("slides");
    expect(normalizeUnit("pp")).toBe("pages");
    expect(normalizeUnit("  Flashcards ")).toBe("cards");
    expect(normalizeUnit("lectures")).toBe("videos");
  });

  it("returns null for anything it does not know", () => {
    expect(normalizeUnit("chapters")).toBeNull();
    expect(normalizeUnit("")).toBeNull();
  });
});

describe("parseOutline", () => {
  it("reads one topic per line", () => {
    const result = parseOutline(
      ["Cell biology — 120 slides", "Membrane transport — 85", "Glycolysis — 140 pages"].join("\n"),
    );

    expect(result.issues).toEqual([]);
    expect(result.topics).toEqual([
      { name: "Cell biology", totalUnits: 120, unit: "slides", line: 1 },
      // A bare number inherits the unit from the line before, so a run of
      // same-unit topics needs the word only once.
      { name: "Membrane transport", totalUnits: 85, unit: "slides", line: 2 },
      { name: "Glycolysis", totalUnits: 140, unit: "pages", line: 3 },
    ]);
  });

  it("honours the default unit until a line names one", () => {
    const result = parseOutline(["Kinetics — 40", "Dynamics — 12 hours", "Statics — 8"].join("\n"), {
      defaultUnit: "cards",
    });
    expect(result.topics.map((topic) => topic.unit)).toEqual(["cards", "hours", "hours"]);
  });

  it("accepts any of the dash forms and a colon", () => {
    const result = parseOutline(["A — 1", "B – 2", "C - 3", "D: 4"].join("\n"));
    expect(result.topics.map((topic) => topic.totalUnits)).toEqual([1, 2, 3, 4]);
    expect(result.topics.map((topic) => topic.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("accepts a decimal comma", () => {
    const result = parseOutline("Seminar — 2,5 hours");
    expect(result.topics[0]).toMatchObject({ totalUnits: 2.5, unit: "hours" });
  });

  it("strips list markers", () => {
    const result = parseOutline(["- Glycolysis — 42", "* Krebs cycle — 38", "• Beta oxidation"].join("\n"));
    expect(result.topics.map((topic) => topic.name)).toEqual([
      "Glycolysis",
      "Krebs cycle",
      "Beta oxidation",
    ]);
  });

  it("normalises CRLF and skips blank lines", () => {
    const result = parseOutline("Glycolysis — 42\r\n\r\nKrebs cycle — 38\r\n");
    expect(result.topics).toHaveLength(2);
    expect(result.topics[0]).toMatchObject({ name: "Glycolysis", line: 1 });
    expect(result.topics[1]).toMatchObject({ name: "Krebs cycle", line: 3 });
  });

  it("leaves a topic sizeless when no number is given", () => {
    const result = parseOutline("Overview");
    expect(result.topics[0]).toMatchObject({ name: "Overview", totalUnits: 0 });
    expect(result.issues).toEqual([]);
  });

  it("reports an unknown unit and falls back rather than dropping the topic", () => {
    const result = parseOutline("Anatomy atlas — 30 chapters");
    expect(result.topics[0]).toMatchObject({ name: "Anatomy atlas", totalUnits: 30, unit: "slides" });
    expect(result.issues).toEqual([
      {
        line: 1,
        text: "Anatomy atlas — 30 chapters",
        message: 'Unknown unit "chapters" — using slides',
      },
    ]);
  });

  it("reports a line that is only a size", () => {
    const result = parseOutline("— 42 slides");
    expect(result.topics).toEqual([]);
    expect(result.issues[0]).toMatchObject({ line: 1, message: "Topic has no name" });
  });

  it("returns nothing for empty input", () => {
    expect(parseOutline("")).toEqual({ topics: [], issues: [] });
    expect(parseOutline("   \n\n  ")).toEqual({ topics: [], issues: [] });
  });
});

describe("formatOutline", () => {
  it("formats one topic per line, omitting the size when it is zero", () => {
    expect(
      formatOutline([
        { name: "Cardiac cycle", totalUnits: 30, unit: "slides" },
        { name: "Blood pressure", totalUnits: 0, unit: "slides" },
      ]),
    ).toBe("Cardiac cycle — 30 slides\nBlood pressure");
  });

  it("round-trips through parseOutline", () => {
    const topics = [
      { name: "Cell biology", totalUnits: 120, unit: "slides" as const },
      { name: "Membrane transport", totalUnits: 85, unit: "slides" as const },
      { name: "Glycolysis", totalUnits: 140, unit: "pages" as const },
      { name: "Unmeasured", totalUnits: 0, unit: "pages" as const },
    ];

    const reparsed = parseOutline(formatOutline(topics));
    expect(reparsed.issues).toEqual([]);
    expect(
      reparsed.topics.map(({ name, totalUnits, unit }) => ({
        name,
        totalUnits,
        unit,
      })),
    ).toEqual(topics);
  });
});
