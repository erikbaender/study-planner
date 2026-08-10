/* ─── Label gutter ──────────────────────────────────────────────────────────
 *
 * One width for every label in the chart — course names, topic names, "All
 * topics" — instead of each row sizing to its own text. Independent widths
 * made the left edge of the canvas ragged and let a long name eat width no
 * neighbouring row needed; one shared column reads as a real gutter and costs
 * only as much space as the longest name actually on screen.
 * ────────────────────────────────────────────────────────────────────────── */

export const GUTTER_MIN = 140;
export const GUTTER_MAX = 320;

export type LabelKind = "allTopics" | "course" | "topicWithDot" | "topicPlain";

/** Everything around the text — chevrons, dots, padding — that the column also has to fit. */
export const LABEL_CHROME: Record<LabelKind, number> = {
  allTopics: 56, // chevron + layers icon + paddings
  course: 56, // chevron + colour dot + paddings
  topicWithDot: 30, // colour dot + paddings, no chevron
  topicPlain: 40, // the nested indent, no icon
};

export const LABEL_WEIGHT: Record<LabelKind, number> = {
  allTopics: 600,
  course: 500,
  topicWithDot: 400,
  topicPlain: 400,
};

/**
 * Text width via canvas, not a DOM measurement.
 *
 * A DOM measurement would be exact, but costs a layout pass per label on
 * every render. `measureText` uses the same font metrics the browser lays the
 * text out with and is cheap enough to run for every visible row every time.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;
export function textWidth(text: string, weight: number): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  // SSR, or a browser that refused a 2D context: a rough estimate beats a
  // 0-width flash on first paint.
  if (!measureCtx) return text.length * 7;
  measureCtx.font = `${weight} 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** The one width every label shares, sized to whichever visible name is longest. */
export function gutterWidth(labels: readonly { text: string; kind: LabelKind }[]): number {
  const widest = labels.reduce(
    (max, { text, kind }) => Math.max(max, LABEL_CHROME[kind] + textWidth(text, LABEL_WEIGHT[kind])),
    0,
  );
  return Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, Math.ceil(widest)));
}
