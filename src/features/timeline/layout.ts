import type { IsoDate } from "@/domain";

export const LANE_HEIGHT = 28;
export const ROW_HEIGHT = 24;
/** The `pb-1` breathing room below an open group's last row, on the canvas side and in `GutterCard`. */
export const GROUP_GAP = 4;
/** The two-tier header: a band of months or years over the ticks themselves. */
export const BAND_HEIGHT = 18;
export const TICK_HEIGHT = 18;
export const RULER_HEIGHT = BAND_HEIGHT + TICK_HEIGHT;
/** The height the "no topics yet" line occupies while a course opens onto it. */
export const EMPTY_COURSE_HEIGHT = 44;

export const ROW_TINT_PROPERTY = "--timeline-row-tint";

export type Range = { start: IsoDate; end: IsoDate; days: number };
