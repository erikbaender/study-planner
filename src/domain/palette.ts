/**
 * Course identity colours, plus selection helpers.
 *
 * UI state owns the near-primary anchors: red for negative feedback, yellow
 * for warnings, green for positive feedback and blue for selection/actions.
 * These ten colours sit between those anchors around the hue wheel. A
 * course can therefore stay colourful without borrowing a semantic colour.
 *
 * `onColor` is stated per colour rather than computed so a solid use always
 * has a known accessible foreground.
 */

export type PlannerColor = {
  /** Stable value persisted in plans and exports. */
  id: CourseColorId;
  name: string;
  /** Solid fill. */
  value: string;
  /** Tinted background for bars and chips in light mode. */
  soft: string;
  /** Accessible foreground on `value`. */
  onColor: "#ffffff" | "#000000";
};

const COURSE_COLOR_IDS = [
  "coral",
  "tangerine",
  "gold",
  "lime",
  "chartreuse",
  "jade",
  "turquoise",
  "violet",
  "orchid",
  "rose",
] as const;

export type CourseColorId = (typeof COURSE_COLOR_IDS)[number];

export function isCourseColorId(reference: string): reference is CourseColorId {
  return COURSE_COLOR_IDS.includes(reference as CourseColorId);
}

export const coursePalette = [
  { id: "coral", name: "Coral", value: "#e8684a", soft: "#fbe9e4", onColor: "#000000" },
  {
    id: "tangerine",
    name: "Tangerine",
    value: "#df853e",
    soft: "#faeddf",
    onColor: "#000000",
  },
  { id: "gold", name: "Gold", value: "#c69b32", soft: "#f7f0dc", onColor: "#000000" },
  { id: "lime", name: "Lime", value: "#a6b93d", soft: "#f1f4dd", onColor: "#000000" },
  {
    id: "chartreuse",
    name: "Chartreuse",
    value: "#7cb84a",
    soft: "#eaf4e1",
    onColor: "#000000",
  },
  { id: "jade", name: "Jade", value: "#2aa879", soft: "#dff2eb", onColor: "#000000" },
  {
    id: "turquoise",
    name: "Turquoise",
    value: "#2ca3a3",
    soft: "#e0f1f1",
    onColor: "#000000",
  },
  {
    id: "violet",
    name: "Violet",
    value: "#8169d1",
    soft: "#ebe8f8",
    onColor: "#000000",
  },
  {
    id: "orchid",
    name: "Orchid",
    value: "#b95dba",
    soft: "#f4e5f4",
    onColor: "#000000",
  },
  { id: "rose", name: "Rose", value: "#d65b8d", soft: "#f8e5ed", onColor: "#000000" },
] as const satisfies readonly PlannerColor[];

export const DEFAULT_COLOR_ID: CourseColorId = "violet";

const paletteById = new Map<CourseColorId, PlannerColor>(
  coursePalette.map((color) => [color.id, color]),
);

/**
 * Compatibility for plans saved before colours became palette references.
 * Removed near-signal greens/blues intentionally resolve to a neighbouring
 * identity colour rather than preserving their old semantic-looking hue.
 */
const legacyColorIds: Readonly<Record<string, CourseColorId>> = {
  "#e8684a": "coral",
  "#df853e": "tangerine",
  "#c69b32": "gold",
  "#a6b93d": "lime",
  "#7cb84a": "chartreuse",
  "#53ae55": "chartreuse",
  "#2aa879": "jade",
  "#2ca3a3": "turquoise",
  "#3d8fd1": "violet",
  "#8169d1": "violet",
  "#b95dba": "orchid",
  "#d65b8d": "rose",
  "#ff3b30": "coral",
  "#ff9500": "tangerine",
  "#ffcc00": "gold",
  "#34c759": "chartreuse",
  "#00c7be": "jade",
  "#30b0c7": "turquoise",
  "#32ade6": "turquoise",
  "#007aff": "violet",
  "#5856d6": "violet",
  "#af52de": "orchid",
  "#ff2d55": "rose",
  "#a2845e": "gold",
  "#8e8e93": "violet",
};

export function resolveCourseColorId(reference: string): CourseColorId {
  const normalized = reference.toLowerCase();
  return isCourseColorId(normalized)
    ? normalized
    : (legacyColorIds[normalized] ?? DEFAULT_COLOR_ID);
}

function getPaletteColor(reference: string): PlannerColor {
  return paletteById.get(resolveCourseColorId(reference)) ?? paletteById.get(DEFAULT_COLOR_ID)!;
}

export function courseColorValue(reference: string): string {
  return getPaletteColor(reference).value;
}

/**
 * The least-used colour, ties broken by palette order so the result is
 * deterministic — new courses get distinct colours in a predictable sequence
 * rather than a random one.
 */
export function leastUsedColor(usedColors: readonly string[]): CourseColorId {
  const usage = new Map(coursePalette.map((color) => [color.id, 0]));
  for (const reference of usedColors) {
    const colorId = resolveCourseColorId(reference);
    usage.set(colorId, usage.get(colorId)! + 1);
  }

  let best: PlannerColor = coursePalette[0];
  for (const color of coursePalette) {
    if (usage.get(color.id)! < usage.get(best.id)!) best = color;
  }
  return best.id;
}
