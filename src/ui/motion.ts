/**
 * The app's motion, in JavaScript.
 *
 * Scrolling is the one thing in the app that cannot be animated in CSS — a
 * scroll offset is not a style — and `behavior: "smooth"` is the browser's
 * curve over the browser's duration, neither of which is the app's. Everything
 * here reads `--topic-motion-duration` and `--topic-motion-curve` off the
 * element it is animating, so a jump to today, a jump to an off-screen block
 * and the day-width transition a zoom change runs in CSS are all one motion at
 * one speed — including when the animation-speed preference changes it.
 */

/** Matches the fallbacks in `globals.css`, for SSR and for jsdom. */
const DEFAULT_DURATION_MS = 240;
const DEFAULT_CURVE: Curve = [0.65, 0, 0.35, 1];

type Curve = [number, number, number, number];

function customProperty(element: Element, name: string): string {
  if (typeof getComputedStyle !== "function") return "";
  return getComputedStyle(element).getPropertyValue(name).trim();
}

export function motionDuration(element: Element, property = "--topic-motion-duration"): number {
  const value = customProperty(element, property);
  const milliseconds = value.endsWith("s") && !value.endsWith("ms")
    ? Number.parseFloat(value) * 1000
    : Number.parseFloat(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : DEFAULT_DURATION_MS;
}

/** The curve as CSS wrote it, for handing back to a CSS transition. */
export function motionCurveValue(element: Element): string {
  return customProperty(element, "--topic-motion-curve") || `cubic-bezier(${DEFAULT_CURVE.join(",")})`;
}

function motionCurve(element: Element): Curve {
  const value = customProperty(element, "--topic-motion-curve");
  const numbers = value
    .replace(/^cubic-bezier\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((part) => Number.parseFloat(part));
  return numbers.length === 4 && numbers.every(Number.isFinite)
    ? (numbers as Curve)
    : DEFAULT_CURVE;
}

/**
 * A cubic bézier as a function of progress.
 *
 * The x of a CSS timing function is time and its y is the eased value, so
 * evaluating one means solving x(t) = elapsed for t first. Newton's method
 * converges in a handful of steps on the curves anyone writes, and the fixed
 * iteration count keeps the worst case bounded.
 */
function easing([x1, y1, x2, y2]: Curve): (progress: number) => number {
  const axis = (a: number, b: number) => (t: number) =>
    (((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t + 3 * a) * t;
  const slope = (a: number, b: number) => (t: number) =>
    3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  const x = axis(x1, x2);
  const y = axis(y1, y2);
  const dx = slope(x1, x2);

  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let step = 0; step < 8; step += 1) {
      const error = x(t) - progress;
      if (Math.abs(error) < 1e-4) break;
      const gradient = dx(t);
      if (Math.abs(gradient) < 1e-6) break;
      t -= error / gradient;
    }
    return y(t);
  };
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One animation per scroller: a second target replaces the first rather than fighting it. */
const running = new WeakMap<Element, number>();

/**
 * Run `frame` from 0 to 1 on the app's curve.
 *
 * One loop rather than one per animated property, because a zoom moves the
 * scroll offset *and* the width of a day and the two have to agree exactly on
 * every frame — a CSS transition running alongside this drifts by however many
 * frames the layout it triggers happens to cost, and the date under the pointer
 * slides while the chart scales.
 */
export function animate(
  element: HTMLElement,
  frame: (progress: number) => void,
  done?: () => void,
): void {
  const previous = running.get(element);
  if (previous !== undefined) cancelAnimationFrame(previous);
  running.delete(element);

  const duration = motionDuration(element);
  if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
    frame(1);
    done?.();
    return;
  }

  const ease = easing(motionCurve(element));
  const started = performance.now();
  const step = (now: number) => {
    const elapsed = Math.min(1, (now - started) / duration);
    frame(ease(elapsed));
    if (elapsed < 1) {
      running.set(element, requestAnimationFrame(step));
    } else {
      running.delete(element);
      done?.();
    }
  };
  running.set(element, requestAnimationFrame(step));
}

/**
 * Scroll to `left`, on the app's curve.
 *
 * Deliberately not clamped to the current `scrollWidth`: during a zoom the
 * canvas is still growing, and the caller knows the width it is growing to.
 */
export function animateScrollLeft(element: HTMLElement, left: number, done?: () => void): void {
  const from = element.scrollLeft;
  const to = Math.max(0, left);
  if (Math.abs(to - from) < 1) {
    done?.();
    return;
  }
  animate(element, (progress) => {
    element.scrollLeft = from + (to - from) * progress;
  }, done);
}

/** True while an animation here owns this scroller's offset. */
export function isScrollAnimating(element: HTMLElement): boolean {
  return running.has(element);
}

/**
 * Give the offset back.
 *
 * A hand on the chart outranks anything the chart decided to do by itself: an
 * animation still running under a drag writes `scrollLeft` on every frame and
 * the drag appears simply not to work. Worse, a tab hidden mid-animation stops
 * receiving frames without ending the animation, so the chart could be left
 * owned by something that would only resume when the tab came back.
 */
export function stopScrollAnimation(element: HTMLElement): void {
  const frame = running.get(element);
  if (frame !== undefined) cancelAnimationFrame(frame);
  running.delete(element);
}
