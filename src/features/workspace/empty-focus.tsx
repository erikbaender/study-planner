"use client";

/**
 * What every view says when the focus holds nothing.
 *
 * One component rather than three messages, because the three views empty for
 * exactly one reason — the sidebar's focus, its hidden courses, or the search
 * field has narrowed the plan to nothing — and three phrasings of that would
 * read as three different problems.
 *
 * There is no button. The earlier version offered "New course" or "Open the
 * outline", which answered a question nobody had asked: nothing is missing, the
 * courses are all still there, and the control that hid them is on screen a few
 * hundred pixels to the left. A filter that has caught everything is a state to
 * be *told* about, not a dead end to be rescued from, so the view says so and
 * gets out of the way.
 */

import { Ghost } from "lucide-react";
import { EmptyState } from "@/ui";

export function EmptyFocus() {
  return (
    <EmptyState
      icon={<Ghost />}
      title="Nothing in focus"
      description="Every course is hidden by the focus, the search, or both. Widen either one in the sidebar to bring them back."
    />
  );
}
