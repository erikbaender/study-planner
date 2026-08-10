/**
 * A collapsed lane as a heatmap.
 *
 * A collapsed course used to draw one flat bar filled by the course's progress
 * ratio — which is the same fact the rows underneath already state, repeated at
 * a scale where it cannot be acted on. What a *collapsed* lane is uniquely
 * placed to answer is the shape of the plan in time: where the work piles up,
 * where the fortnight of nothing is, whether the fortnight of nothing is right
 * before an exam.
 *
 * Two questions, kept apart in each solid segment:
 *
 *   - *Who* is a stack. The bar's height at any point is divided among the
 *     courses scheduled there, each band as thick as that course's share of the
 *     work at that moment. A week that is three courses at once is three bands.
 *   - *How much* is opacity. Each date run gets an alpha based on its load,
 *     holding the stack back where the plan thins out.
 *
 * Blending was the first attempt and it was wrong in a way no amount of colour
 * science fixes: the average of coral and jade is a colour that names no course
 * on the chart. In OKLCH it was a *vivid* colour that named no course. Bands
 * keep every hue exactly the hue of the course it belongs to, and reading two
 * of them stacked is reading two courses — not decoding a mixture.
 *
 * Both channels are cut hard. The unit of the whole chart is a day, a day
 * either has four blocks on it or it has five, and the moment it changes is a
 * fact the bar should state rather than smooth over: every edge here lands on a
 * date, and the bar is a run of flat steps rather than a curve. That also
 * removes the last thing that scaled with the length of the span — a step has
 * no width to get wrong.
 *
 * Pure and expressed in *date* space, not pixels: the geometry is a 0–100 box
 * stretched to whatever width the bar currently has, so a zoom change scales
 * the same paths rather than asking for a recomputation per frame.
 */

import { addDays, differenceInDays, type IsoDate } from "@/domain";

/** One colour's worth of the load. Series sharing a colour are one band. */
export type DensitySeries = {
  /** Resolved CSS colour — `courseColorValue`. */
  color: string;
  blocks: readonly { startDate: IsoDate; endDate: IsoDate }[];
};

export type DensityBar = {
  /** Solid stacked segments, bottom of the stack first, over a 100 × 100 box. */
  bands: readonly { color: string; d: string; opacity: number }[];
  /** Where the plan is thickest, for the bar's label. Null when nothing is scheduled. */
  peak: { date: IsoDate; blocks: number } | null;
};

export const DENSITY_BOX = 100;

/**
 * The most steps a bar is drawn with.
 *
 * A run boundary is a day where a block starts or ends, so this only binds on a
 * plan with hundreds of blocks in one lane. Past it, the boundaries that change
 * the picture least are dissolved first, which keeps the bar's loud edges loud.
 */
const MAX_RUNS = 160;

/**
 * One block on a day — the bottom of the ramp, not the bottom of the range.
 *
 * A plan where no day ever has more than one block is a legitimate plan, and
 * its bar has to be readable rather than a uniform whisper, so a single block
 * is already solidly visible and the ramp above it is headroom for crowding.
 */
const MIN_ALPHA = 0.35;
const MAX_ALPHA = 1;

/**
 * How crowded a day has to be to be drawn at full strength.
 *
 * Not the peak. Normalising against the single busiest day meant one outlier —
 * the day twelve topics all happen to touch — flattened the whole rest of the
 * bar into the bottom of the ramp, where one block and five looked the same.
 * This is a high quantile of the days that have anything at all on them, so the
 * ramp spans the range the plan actually spends its time in and the genuine
 * outliers clamp at the top, which is what "as busy as it gets" should look
 * like anyway.
 */
const SATURATION_QUANTILE = 0.9;

const EMPTY: DensityBar = { bands: [], peak: null };

/** A stretch of days the bar draws identically: one step of the whole picture. */
type Run = {
  /** Day offsets from the start of the span, inclusive. */
  from: number;
  to: number;
  /** Blocks per day over the run — a whole number until two runs are merged. */
  total: number;
  /** Blocks per day per band, in `colors` order. */
  counts: Float64Array;
};

export function densityBar(
  series: readonly DensitySeries[],
  span: { start: IsoDate; end: IsoDate },
): DensityBar {
  const days = differenceInDays(span.start, span.end) + 1;
  if (days <= 0) return EMPTY;

  // One band per colour, in the order the colours first appear, so a band does
  // not swap places in the stack when a topic is added somewhere else.
  const colors: string[] = [];
  const bandOf = new Map<string, number>();
  for (const entry of series) {
    if (bandOf.has(entry.color)) continue;
    bandOf.set(entry.color, colors.length);
    colors.push(entry.color);
  }

  const counts = colors.map(() => new Float64Array(days));
  const totals = new Float64Array(days);
  for (const entry of series) {
    const count = counts[bandOf.get(entry.color)!];
    for (const block of entry.blocks) {
      const from = Math.max(0, differenceInDays(span.start, block.startDate));
      const to = Math.min(days - 1, differenceInDays(span.start, block.endDate));
      for (let day = from; day <= to; day += 1) {
        count[day] += 1;
        totals[day] += 1;
      }
    }
  }

  let peakDay = -1;
  for (let day = 0; day < days; day += 1) {
    if (peakDay === -1 || totals[day] > totals[peakDay]) peakDay = day;
  }
  const peakWeight = peakDay === -1 ? 0 : totals[peakDay];
  if (peakWeight === 0) return EMPTY;

  const full = saturationWeight(totals);
  const runs = mergeRuns(runsOf(counts, totals, days), full);

  return {
    bands: bandPaths(colors, runs, days, full),
    peak: { date: addDays(span.start, peakDay), blocks: peakWeight },
  };
}

/** Consecutive days the bar would draw identically, collapsed into one run each. */
function runsOf(counts: readonly Float64Array[], totals: Float64Array, days: number): Run[] {
  const runs: Run[] = [];

  for (let day = 0; day < days; day += 1) {
    const previous = runs[runs.length - 1];
    if (previous && sameDay(counts, previous.from, day)) {
      previous.to = day;
      continue;
    }
    runs.push({
      from: day,
      to: day,
      total: totals[day],
      counts: Float64Array.from(counts, (count) => count[day]),
    });
  }

  return runs;
}

function sameDay(counts: readonly Float64Array[], left: number, right: number): boolean {
  for (const count of counts) {
    if (count[left] !== count[right]) return false;
  }
  return true;
}

/**
 * Down to `MAX_RUNS`, quietest boundary first.
 *
 * The cost of losing a boundary is how much the bar changes across it — the
 * step in alpha, and how far the composition shifts — weighted by how little of
 * the span the smaller of the two runs occupies. A one-day blip between two
 * identical fortnights goes before a fortnight-long change of course.
 */
function mergeRuns(runs: Run[], full: number): Run[] {
  while (runs.length > MAX_RUNS) {
    let quietest = 0;
    let quietestCost = Infinity;
    for (let index = 0; index + 1 < runs.length; index += 1) {
      const cost = boundaryCost(runs[index], runs[index + 1], full);
      if (cost < quietestCost) {
        quietestCost = cost;
        quietest = index;
      }
    }

    const left = runs[quietest];
    const right = runs[quietest + 1];
    const leftDays = left.to - left.from + 1;
    const rightDays = right.to - right.from + 1;
    const merged = new Float64Array(left.counts.length);
    for (let band = 0; band < merged.length; band += 1) {
      merged[band] = (left.counts[band] * leftDays + right.counts[band] * rightDays) / (leftDays + rightDays);
    }
    runs.splice(quietest, 2, {
      from: left.from,
      to: right.to,
      total: (left.total * leftDays + right.total * rightDays) / (leftDays + rightDays),
      counts: merged,
    });
  }
  return runs;
}

function boundaryCost(left: Run, right: Run, full: number): number {
  let shift = Math.abs(alphaOf(left.total, full) - alphaOf(right.total, full));
  const leftTotal = left.total || 1;
  const rightTotal = right.total || 1;
  for (let band = 0; band < left.counts.length; band += 1) {
    shift += Math.abs(left.counts[band] / leftTotal - right.counts[band] / rightTotal) / 2;
  }
  const days = Math.min(left.to - left.from + 1, right.to - right.from + 1);
  return shift * days;
}

/** The blocks-per-day that reads as full strength: a high quantile of the busy days. */
function saturationWeight(totals: Float64Array): number {
  const busy: number[] = [];
  for (const total of totals) if (total > 0) busy.push(total);
  if (busy.length === 0) return 2;
  busy.sort((left, right) => left - right);
  const at = Math.min(busy.length - 1, Math.floor(busy.length * SATURATION_QUANTILE));
  // At least two, or a plan with one block per day everywhere would divide by
  // zero on the ramp; one step of headroom keeps the ramp meaningful.
  return Math.max(2, busy[at]);
}

/**
 * Linear in blocks-per-day, so each extra block on a day is the same step up the
 * ramp rather than a diminishing one — the point of the bar is to tell one block
 * from five.
 */
function alphaOf(total: number, full: number): number {
  if (total <= 0) return 0;
  if (total <= 1) return MIN_ALPHA * total;
  return MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * Math.min(1, (total - 1) / (full - 1));
}

/**
 * The stack, as solid rectangles.
 *
 * Each run is a column, split top to bottom among the courses scheduled in it.
 * A course that is absent from a run contributes no rectangle there. Opacity is
 * attached to each rectangle rather than applied through a CSS gradient, so
 * every workload change remains a solid, hard-edged segment.
 */
function bandPaths(
  colors: readonly string[],
  runs: readonly Run[],
  days: number,
  full: number,
): { color: string; d: string; opacity: number }[] {
  const bands: { color: string; d: string; opacity: number }[] = [];

  for (let band = 0; band < colors.length; band += 1) {
    for (const run of runs) {
      if (run.total <= 0 || run.counts[band] <= 0) continue;

      let above = 0;
      for (let under = 0; under < band; under += 1) above += run.counts[under];
      const top = (above / run.total) * DENSITY_BOX;
      const bottom = ((above + run.counts[band]) / run.total) * DENSITY_BOX;
      const left = (run.from / days) * DENSITY_BOX;
      const right = ((run.to + 1) / days) * DENSITY_BOX;

      bands.push({
        color: colors[band],
        d: `M${round(left)} ${round(top)}H${round(right)}V${round(bottom)}H${round(left)}Z`,
        opacity: alphaOf(run.total, full),
      });
    }
  }

  return bands;
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}
