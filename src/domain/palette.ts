/**
 * The Apple system colour palette, plus selection helpers.
 *
 * `onColor` is the foreground to use on top of `value`. It is stated per colour
 * rather than computed, because a naive luminance threshold picks white on
 * Yellow and Mint, which fails WCAG AA badly.
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

export const applePalette: readonly PlannerColor[] = [
  { name: "Red", value: "#ff3b30", soft: "#ffebe9", onColor: "#ffffff" },
  { name: "Orange", value: "#ff9500", soft: "#fff1dc", onColor: "#000000" },
  { name: "Yellow", value: "#ffcc00", soft: "#fff7c7", onColor: "#000000" },
  { name: "Green", value: "#34c759", soft: "#e4f8e9", onColor: "#000000" },
  { name: "Mint", value: "#00c7be", soft: "#dcf7f5", onColor: "#000000" },
  { name: "Teal", value: "#30b0c7", soft: "#e0f4f8", onColor: "#000000" },
  { name: "Cyan", value: "#32ade6", soft: "#e3f5fc", onColor: "#000000" },
  { name: "Blue", value: "#007aff", soft: "#e2f0ff", onColor: "#ffffff" },
  { name: "Indigo", value: "#5856d6", soft: "#ecebff", onColor: "#ffffff" },
  { name: "Purple", value: "#af52de", soft: "#f5e8fb", onColor: "#ffffff" },
  { name: "Pink", value: "#ff2d55", soft: "#ffe6ec", onColor: "#ffffff" },
  { name: "Brown", value: "#a2845e", soft: "#f2ece4", onColor: "#ffffff" },
  { name: "Gray", value: "#8e8e93", soft: "#eeeeef", onColor: "#ffffff" },
];

export const DEFAULT_COLOR = "#007aff";

export function getPaletteColor(value: string): PlannerColor {
  return applePalette.find((color) => color.value === value) ?? applePalette[7];
}

/**
 * The least-used colour, ties broken by palette order so the result is
 * deterministic — new courses get distinct colours in a predictable sequence
 * rather than a random one.
 */
export function leastUsedColor(usedColors: readonly string[]): string {
  const usage = new Map(applePalette.map((color) => [color.value, 0]));
  for (const color of usedColors) {
    if (usage.has(color)) usage.set(color, usage.get(color)! + 1);
  }

  let best = applePalette[0];
  for (const color of applePalette) {
    if (usage.get(color.value)! < usage.get(best.value)!) best = color;
  }
  return best.value;
}
