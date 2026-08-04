/**
 * Course identity colours, plus selection helpers.
 *
 * UI state owns the near-primary anchors: red for negative feedback, yellow
 * for warnings, green for positive feedback and blue for selection/actions.
 * These twelve colours sit between those anchors around the hue wheel. A
 * course can therefore stay colourful without borrowing a semantic colour.
 *
 * `onColor` is stated per colour rather than computed so a solid use always
 * has a known accessible foreground.
 */

export type PlannerColor = {
  name: string;
  /** Solid fill. */
  value: string;
  /** Tinted background for bars and chips in light mode. */
  soft: string;
  /** Accessible foreground on `value`. */
  onColor: "#ffffff" | "#000000";
};

export const coursePalette: readonly PlannerColor[] = [
  { name: "Coral", value: "#e8684a", soft: "#fbe9e4", onColor: "#000000" },
  { name: "Tangerine", value: "#df853e", soft: "#faeddf", onColor: "#000000" },
  { name: "Gold", value: "#c69b32", soft: "#f7f0dc", onColor: "#000000" },
  { name: "Lime", value: "#a6b93d", soft: "#f1f4dd", onColor: "#000000" },
  { name: "Chartreuse", value: "#7cb84a", soft: "#eaf4e1", onColor: "#000000" },
  { name: "Leaf", value: "#53ae55", soft: "#e5f3e5", onColor: "#000000" },
  { name: "Jade", value: "#2aa879", soft: "#dff2eb", onColor: "#000000" },
  { name: "Turquoise", value: "#2ca3a3", soft: "#e0f1f1", onColor: "#000000" },
  { name: "Sky", value: "#3d8fd1", soft: "#e3eef8", onColor: "#000000" },
  { name: "Violet", value: "#8169d1", soft: "#ebe8f8", onColor: "#000000" },
  { name: "Orchid", value: "#b95dba", soft: "#f4e5f4", onColor: "#000000" },
  { name: "Rose", value: "#d65b8d", soft: "#f8e5ed", onColor: "#000000" },
];

export const DEFAULT_COLOR = "#3d8fd1";

export function getPaletteColor(value: string): PlannerColor {
  return coursePalette.find((color) => color.value === value) ?? coursePalette[8];
}

/**
 * The least-used colour, ties broken by palette order so the result is
 * deterministic — new courses get distinct colours in a predictable sequence
 * rather than a random one.
 */
export function leastUsedColor(usedColors: readonly string[]): string {
  const usage = new Map(coursePalette.map((color) => [color.value, 0]));
  for (const color of usedColors) {
    if (usage.has(color)) usage.set(color, usage.get(color)! + 1);
  }

  let best = coursePalette[0];
  for (const color of coursePalette) {
    if (usage.get(color.value)! < usage.get(best.value)!) best = color;
  }
  return best.value;
}
