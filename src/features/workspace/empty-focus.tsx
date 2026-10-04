"use client";

/**
 * What every view says when it has no courses to show. An empty semester is an
 * onboarding state with a direct way to add the first course; a filtered-empty
 * state points back to the controls that narrowed the list.
 */

import { Ghost, Plus } from "lucide-react";
import { Button, EmptyState } from "@/ui";
import { useWorkspace } from "./store";

export function EmptyFocus({ emptyPlan = false }: { emptyPlan?: boolean }) {
  return (
    <EmptyState
      icon={<Ghost />}
      title={emptyPlan ? "Your semester is empty" : "Nothing in focus"}
      description={
        emptyPlan
          ? "Add your first course to start planning this semester."
          : "Every course is hidden or filtered out by focus or search. Widen a filter in the sidebar to bring them back."
      }
      action={
        emptyPlan ? (
          <Button leadingIcon={<Plus />} onClick={() => useWorkspace.getState().setCreating("course")}>
            New course
          </Button>
        ) : undefined
      }
    />
  );
}
