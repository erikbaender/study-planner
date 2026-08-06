"use client";

/**
 * The sheets: creating a semester, creating a course, and confirming a delete.
 *
 * Sheets, not popovers, because each is a multi-field commitment — §7.4's
 * grading puts popovers on quick edits and reserves the sheet for this. The
 * delete confirmation is here for a blunter reason: there is no undo yet, so
 * the macOS pattern of doing it and offering to take it back is not available,
 * and the only honest alternative is asking first.
 */

import { useState } from "react";
import {
  coursePalette,
  leastUsedColor,
  SAMPLE_DATASETS,
  type Course,
  type Plan,
  type SampleDatasetId,
} from "@/domain";
import { Button, Sheet, TextField } from "@/ui";
import type { ResolvedSelection } from "@/features/workspace/scope";

export function EditPlanSheet({
  plan,
  open,
  onOpenChange,
  onSave,
}: {
  plan: Plan | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { name: string; notes?: string }) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    name: plan?.name ?? "",
    notes: plan?.notes ?? "",
  }));
  const [identity, setIdentity] = useState(`${plan?.id ?? ""}:${open}`);
  const nextIdentity = `${plan?.id ?? ""}:${open}`;
  if (identity !== nextIdentity) {
    setIdentity(nextIdentity);
    setDraft({
      name: plan?.name ?? "",
      notes: plan?.notes ?? "",
    });
  }

  const invalid = draft.name.trim() === "";
  const submit = () => {
    if (invalid) return;
    onSave({
      name: draft.name.trim(),
      notes: draft.notes.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit semester"
      description="Change the semester name or notes."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="accent" disabled={invalid} onClick={submit}>Save</Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <TextField label="Name" autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <TextField label="Notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">Save</button>
      </form>
    </Sheet>
  );
}

export function ConfirmPlanDeleteSheet({
  plan,
  open,
  onOpenChange,
  onConfirm,
}: {
  plan: Plan | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const count = plan?.courses.length ?? 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="sm"
      title={plan ? `Delete “${plan.name}”?` : "Delete semester?"}
      description={count === 0 ? "This semester has no courses." : `Its ${count} course${count === 1 ? "" : "s"} and all their study data go with it.`}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" onClick={() => { onConfirm(); onOpenChange(false); }}>Delete</Button></>}
    >
      <p className="text-body text-secondary">This cannot be undone.</p>
    </Sheet>
  );
}

export function SampleDataSheet({
  open,
  onOpenChange,
  hasData,
  onLoad,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasData: boolean;
  onLoad: (datasetId: SampleDatasetId) => void;
}) {
  const [selectedId, setSelectedId] = useState<SampleDatasetId>(SAMPLE_DATASETS[0].id);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setSelectedId(SAMPLE_DATASETS[0].id);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Load sample data"
      description={
        hasData
          ? "Choose a dataset. Loading it replaces your current semesters and study history."
          : "Choose a dataset to explore the planner with a complete semester."
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={hasData ? "danger" : "accent"}
            onClick={() => {
              onLoad(selectedId);
              onOpenChange(false);
            }}
          >
            {hasData ? "Replace data" : "Load sample"}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Sample dataset" className="flex flex-col gap-2">
        {SAMPLE_DATASETS.map((dataset) => {
          const selected = dataset.id === selectedId;
          return (
            <button
              key={dataset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setSelectedId(dataset.id)}
              className={
                selected
                  ? "rounded-control bg-accent/12 p-3 text-left inset-ring-2 inset-ring-accent"
                  : "rounded-control bg-fill p-3 text-left inset-ring inset-ring-separator hover:bg-fill-strong"
              }
            >
              <span className="block text-body font-semibold">{dataset.name}</span>
              <span className="mt-0.5 block text-callout text-secondary">
                {dataset.description}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

export function NewPlanSheet({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string }) => void;
}) {
  const [name, setName] = useState("");
  // Cleared as the sheet opens, adjusted during render so the previous entry is
  // never briefly visible in it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setName("");
  }

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed });
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New semester"
      description="A semester holds the courses you are taking at the same time."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="accent" onClick={submit} disabled={name.trim() === ""}>
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Name"
          autoFocus
          placeholder="Winter semester"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {/* Submitting on Enter needs a real submit button inside the form; the
            footer's lives outside it, where Radix puts sheet actions. Hidden
            from the accessibility tree as well as from view, or the sheet
            announces two Create buttons — it is a mechanism, not a control. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
          Create
        </button>
      </form>
    </Sheet>
  );
}

export function NewCourseSheet({
  open,
  onOpenChange,
  existing,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: readonly Course[];
  onCreate: (input: { name: string; code?: string; color: string }) => void;
}) {
  const suggested = leastUsedColor(existing.map((course) => course.color));
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [color, setColor] = useState(suggested);

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setName("");
    setCode("");
    // Reseeded per opening, so adding three courses in a row gives three
    // different colours rather than three of whatever was least used first.
    setColor(suggested);
  }

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, code: code.trim() || undefined, color });
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New course"
      description="Topics, exams and progress all hang off a course."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="accent" onClick={submit} disabled={name.trim() === ""}>
            Create
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Name"
          autoFocus
          placeholder="Biochemistry"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Code"
          placeholder="Optional, e.g. BIO-201"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <div className="flex flex-col gap-1">
          <span className="text-callout font-medium text-secondary">Colour</span>
          <div role="radiogroup" aria-label="Course colour" className="flex flex-wrap gap-1.5">
            {coursePalette.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={candidate.id === color}
                aria-label={candidate.name}
                onClick={() => setColor(candidate.id)}
                className={
                  candidate.id === color
                    ? "size-6 scale-110 rounded-full inset-ring-2 inset-ring-[var(--mac-label)]"
                    : "size-6 rounded-full hover:scale-110"
                }
                style={{ background: candidate.value }}
              />
            ))}
          </div>
        </div>
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
          Create
        </button>
      </form>
    </Sheet>
  );
}

export function ConfirmDeleteSheet({
  target,
  onOpenChange,
  onConfirm,
}: {
  target: NonNullable<ResolvedSelection> | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const described = describe(target);

  return (
    <Sheet
      open={target !== null}
      onOpenChange={onOpenChange}
      width="sm"
      title={described.title}
      description={described.description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="accent"
            className="bg-negative hover:bg-negative"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <p className="text-body text-secondary">This cannot be undone.</p>
    </Sheet>
  );
}

function describe(target: NonNullable<ResolvedSelection> | null): {
  title: string;
  description: string;
} {
  if (!target) return { title: "Delete", description: "" };

  if (target.kind === "course") {
    const count = target.course.topics.length;
    return {
      title: `Delete “${target.course.name}”?`,
      // The topic count is the part that matters: deleting a course with forty
      // topics in it is a different decision from deleting an empty one.
      description:
        count === 0
          ? "The course has no topics."
          : `Its ${count} topic${count === 1 ? "" : "s"} and their logged progress go with it.`,
    };
  }

  if (target.kind === "topic") {
    return {
      title: `Delete “${target.topic.name}”?`,
      description: `In ${target.course.name}. Progress logged against it is removed too.`,
    };
  }

  return {
    title: `Delete “${target.exam.name}”?`,
    description: `In ${target.course.name}. Pace for the course stops being measurable without a deadline.`,
  };
}
