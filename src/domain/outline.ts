/**
 * Bulk outline parser.
 *
 * The setup workhorse: a medical student entering ten courses of forty topics
 * each is not going to click "New topic" four hundred times. Paste an outline,
 * get topics.
 *
 * Format — one topic per line:
 *
 *     Cell biology — 120 slides
 *     Membrane transport — 85
 *     Glycolysis — 140 pages
 *
 * Sizes are optional. A bare number inherits the unit from the previous topic,
 * so a run of same-unit lines needs the word only once.
 */

import { UNITS, type Unit } from "./types";

export type ParsedTopic = {
  name: string;
  totalUnits: number;
  unit: Unit;
  /** 1-based, for pointing at the offending line in an error. */
  line: number;
};

export type OutlineParseIssue = {
  line: number;
  text: string;
  message: string;
};

export type OutlineParseResult = {
  topics: ParsedTopic[];
  issues: OutlineParseIssue[];
};

/** Em dash, en dash, hyphen, or colon, followed by a size. */
const SIZE_PATTERN = /\s*[—–\-:]\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]*)\s*$/;

const UNIT_ALIASES: Record<string, Unit> = {
  slide: "slides",
  slides: "slides",
  page: "pages",
  pages: "pages",
  pp: "pages",
  p: "pages",
  card: "cards",
  cards: "cards",
  flashcard: "cards",
  flashcards: "cards",
  video: "videos",
  videos: "videos",
  lecture: "videos",
  lectures: "videos",
  hour: "hours",
  hours: "hours",
  h: "hours",
  hr: "hours",
  hrs: "hours",
  item: "items",
  items: "items",
};

export function normalizeUnit(raw: string): Unit | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if ((UNITS as readonly string[]).includes(key)) return key as Unit;
  return UNIT_ALIASES[key] ?? null;
}

export function parseOutline(
  input: string,
  options: { defaultUnit?: Unit } = {},
): OutlineParseResult {
  const topics: ParsedTopic[] = [];
  const issues: OutlineParseIssue[] = [];

  const rawLines = input.replace(/\r\n?/g, "\n").split("\n");
  let inheritedUnit: Unit = options.defaultUnit ?? "slides";

  rawLines.forEach((line, index) => {
    const lineNumber = index + 1;
    const text = line.trim();
    if (!text) return;
    // Allow list markers so a pasted bulleted outline works unedited.
    const withoutBullet = text.replace(/^[-*•]\s+/, "");
    if (!withoutBullet) return;

    const match = withoutBullet.match(SIZE_PATTERN);
    const name = stripSizeSuffix(withoutBullet);

    if (!name) {
      issues.push({ line: lineNumber, text, message: "Topic has no name" });
      return;
    }

    let totalUnits = 0;
    let unit = inheritedUnit;

    if (match) {
      const amount = Number(match[1].replace(",", "."));
      if (!Number.isFinite(amount) || amount < 0) {
        issues.push({ line: lineNumber, text, message: "Size is not a valid number" });
      } else {
        totalUnits = amount;
      }

      if (match[2]) {
        const parsed = normalizeUnit(match[2]);
        if (parsed) {
          unit = parsed;
          inheritedUnit = parsed;
        } else {
          issues.push({
            line: lineNumber,
            text,
            message: `Unknown unit "${match[2]}" — using ${inheritedUnit}`,
          });
        }
      }
    }

    topics.push({ name, totalUnits, unit, line: lineNumber });
  });

  return { topics, issues };
}

function stripSizeSuffix(text: string): string {
  return text.replace(SIZE_PATTERN, "").trim();
}

/** Round-trips through `parseOutline`; used to seed the bulk editor from existing topics. */
export function formatOutline(
  topics: readonly { name: string; totalUnits: number; unit: Unit }[],
): string {
  return topics
    .map((topic) => {
      const size = topic.totalUnits > 0 ? ` — ${topic.totalUnits} ${topic.unit}` : "";
      return `${topic.name}${size}`;
    })
    .join("\n");
}
