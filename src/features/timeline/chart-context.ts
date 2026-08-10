import { createContext, useContext } from "react";
import type { RefObject } from "react";
import type { PlannerRepository } from "@/data/repository";
import type { IsoDate } from "@/domain";
import type { MenuItem } from "@/ui";
import type { BarTarget } from "./selection";
import type { Span } from "./blocks";
import type { Zoom } from "./geometry";
import { GUTTER_MIN } from "./gutter";

/**
 * The selection, as Blender has it.
 *
 * Several bars can be selected; the inspector can describe one thing. So the
 * selection is ordered and the *last* thing added to it is primary — the one
 * the inspector follows, drawn with a full accent outline while the rest carry
 * a half-strength one. That is the same convention Blender's active-versus-
 * selected outline uses, and it answers the question a multi-selection
 * otherwise leaves open: which of these is the panel talking about?
 *
 * An external store rather than state on the chart: a selection change must
 * repaint the bars that changed and nothing else. Routed through React state
 * it would reconcile every lane in the plan on every click.
 */
export type BarSelection = "primary" | "secondary" | null;

export type SelectionStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly string[];
  /** What this bar is, for the one bar asking. A primitive, so an unchanged bar never re-renders. */
  stateOf: (id: string) => BarSelection;
  set: (ids: readonly string[]) => void;
};

export function createSelectionStore(): SelectionStore {
  let ids: readonly string[] = [];
  let selectedIds = new Set<string>();
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => ids,
    stateOf(id) {
      if (ids.length === 0) return null;
      if (ids[ids.length - 1] === id) return "primary";
      return selectedIds.has(id) ? "secondary" : null;
    },
    set(next) {
      if (next.length === ids.length && next.every((id, index) => id === ids[index])) return;
      ids = next;
      selectedIds = new Set(next);
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Where the bars are *while* a drag is in flight.
 *
 * Each bar used to hold its own draft span in state, which is exactly right for
 * a gesture that moves one bar and useless for one that moves forty — and worse,
 * a block drawn in two lanes at once (its course's, and the combined lane) is
 * two components that would have to agree. One store keyed by block id, written
 * each frame, read by every bar that draws that block.
 */
export type DraftStore = {
  subscribe: (listener: () => void) => () => void;
  spanOf: (id: string) => Span | null;
  set: (spans: ReadonlyMap<string, Span> | null) => void;
};

export function createDraftStore(): DraftStore {
  let spans: ReadonlyMap<string, Span> | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // `null` for every bar not in the drag, on every frame of it: an unchanged
    // snapshot is what keeps `useSyncExternalStore` from re-rendering them.
    spanOf: (id) => spans?.get(id) ?? null,
    // Every gesture clears the drafts as it ends, whether or not it ever set
    // any, so the already-empty case is the common one and is worth not
    // waking every bar on the canvas for.
    set(next) {
      if (spans === null && next === null) return;
      spans = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Scroll position is external to React's timeline tree.
 *
 * A top-level state update here used to reconcile the ruler, grid, 344 topic
 * lanes, and every bar whenever the viewport crossed a day. Marker consumers
 * subscribe directly instead, and their selector below keeps its snapshot
 * stable until one of that topic's blocks actually crosses an edge.
 */
export type Viewport = { from: IsoDate; to: IsoDate } | null;

export type ViewportStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Viewport;
  setSnapshot: (next: Exclude<Viewport, null>) => void;
};

export function createViewportStore(): ViewportStore {
  let snapshot: Viewport = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setSnapshot(next) {
      if (snapshot?.from === next.from && snapshot.to === next.to) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

export const EMPTY_VIEWPORT_STORE: ViewportStore = {
  subscribe: () => () => {},
  getSnapshot: () => null,
  setSnapshot: () => {},
};

export const EMPTY_SELECTION_STORE: SelectionStore = {
  subscribe: () => () => {},
  getSnapshot: () => [],
  stateOf: () => null,
  set: () => {},
};

export const EMPTY_DRAFT_STORE: DraftStore = {
  subscribe: () => () => {},
  spanOf: () => null,
  set: () => {},
};

export type Chart = {
  scroller: RefObject<HTMLDivElement | null>;
  /** Shared mutation services, resolved once for the whole chart. */
  repository: PlannerRepository | null;
  run: (action: Promise<unknown>) => void;
  /** The committed scale for pointer hit-testing without a row render. */
  zoomRef: RefObject<Zoom>;
  viewport: ViewportStore;
  /** Bring a span just inside the given edge of the scrollport, animated. */
  reveal: (span: Span, side: "left" | "right") => void;
  selection: SelectionStore;
  drafts: DraftStore;
  /**
   * Every drawn block, by id. A gesture on one bar has to move all of them, and
   * a bar knows only its own topic — the registry is how the drag reaches the
   * others. A ref rather than a value so writing it does not invalidate the
   * context every lane consumes.
   */
  registry: RefObject<ReadonlyMap<string, BarTarget>>;
  /** Select these bars, last one primary, and point the inspector at it. */
  select: (ids: readonly string[]) => void;
  /** Nothing is selected now, and the inspector has nothing to describe. */
  clearSelection: () => void;
  /** The right-button menu, at the pointer, with the items the caller decided on. */
  openMenu: (at: { clientX: number; clientY: number }, items: readonly MenuItem[]) => void;
  /** The shared label-column width; see `gutter.ts`. */
  gutter: number;
};

export const ChartContext = createContext<Chart>({
  scroller: { current: null },
  repository: null,
  run: () => {},
  zoomRef: { current: "week" },
  viewport: EMPTY_VIEWPORT_STORE,
  reveal: () => {},
  selection: EMPTY_SELECTION_STORE,
  drafts: EMPTY_DRAFT_STORE,
  registry: { current: new Map() },
  select: () => {},
  clearSelection: () => {},
  openMenu: () => {},
  gutter: GUTTER_MIN,
});

export function useChart(): Chart {
  return useContext(ChartContext);
}
