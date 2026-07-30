"use client";

import { type Plan } from "@/domain";
import { Button, Sheet } from "@/ui";
import type { WorkspaceSelection } from "./workspace-store";

export function DeleteSelectionSheet({
  open,
  onOpenChange,
  plan,
  selection,
  onDeleteCourse,
  onDeleteTopic,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan;
  selection: WorkspaceSelection;
  onDeleteCourse: (courseId: string) => void;
  onDeleteTopic: (topicId: string) => void;
}) {
  const resolved =
    selection?.kind === "course"
      ? plan.courses.find((course) => course.id === selection.id)
      : selection?.kind === "topic"
        ? plan.courses
            .flatMap((course) => course.topics)
            .find((topic) => topic.id === selection.id)
        : null;

  const remove = () => {
    if (!selection || !resolved) return;
    if (selection.kind === "course") onDeleteCourse(selection.id);
    else onDeleteTopic(selection.id);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open && Boolean(resolved)}
      onOpenChange={onOpenChange}
      title={`Delete ${selection?.kind ?? "selection"}?`}
      description={
        resolved
          ? `“${resolved.name}” and its contained data will be permanently removed.`
          : "Select a course or topic before deleting."
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        </>
      }
    >
      <p className="text-body text-secondary">This action cannot be undone.</p>
    </Sheet>
  );
}
