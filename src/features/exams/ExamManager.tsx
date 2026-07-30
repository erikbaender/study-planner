"use client";

import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  EXAM_KINDS,
  EXAM_STATUSES,
  type Course,
  type Exam,
  type ExamKind,
  type ExamStatus,
} from "@/domain";
import type { ExamInput } from "@/data/repository";
import {
  Badge,
  Button,
  Card,
  IconButton,
  SelectField,
  Sheet,
  TextArea,
  TextField,
} from "@/ui";

type CompleteExamInput = Required<Omit<ExamInput, "endDate">> & {
  endDate?: string;
};

type ExamDraft = {
  id: string | null;
  name: string;
  kind: ExamKind;
  startDate: string;
  endDate: string;
  status: ExamStatus;
  notes: string;
};

export function ExamManager({
  course,
  today,
  onCreate,
  onUpdate,
  onDelete,
}: {
  course: Course;
  today: string;
  onCreate: (input: CompleteExamInput) => void;
  onUpdate: (examId: string, input: CompleteExamInput) => void;
  onDelete: (examId: string) => void;
}) {
  const [draft, setDraft] = useState<ExamDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Exam | null>(null);

  const openNew = () => {
    setDraft({
      id: null,
      name: "",
      kind: "exam",
      startDate: today,
      endDate: "",
      status: "confirmed",
      notes: "",
    });
  };

  const openExisting = (exam: Exam) => {
    setDraft({
      id: exam.id,
      name: exam.name,
      kind: exam.kind,
      startDate: exam.startDate,
      endDate: exam.endDate ?? "",
      status: exam.status,
      notes: exam.notes,
    });
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-title3 font-semibold">Exams and deadlines</h2>
          <p className="text-callout text-secondary">
            Provisional windows stay visibly uncertain and plan from their first day.
          </p>
        </div>
        <Button size="sm" leadingIcon={<Plus />} onClick={openNew}>
          Add exam
        </Button>
      </div>

      {course.exams.length === 0 ? (
        <div className="flex items-center gap-2 rounded-control bg-fill px-3 py-4 text-body text-secondary">
          <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
          No exam date yet. Add a confirmed date or a provisional window.
        </div>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {[...course.exams]
            .sort((left, right) => left.startDate.localeCompare(right.startDate))
            .map((exam) => (
              <li
                key={exam.id}
                className="flex min-w-0 items-start gap-3 rounded-control bg-fill px-3 py-2.5"
              >
                <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-secondary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-body font-semibold">{exam.name}</span>
                    <Badge>{sentenceCase(exam.kind)}</Badge>
                    <Badge
                      tone={exam.status === "provisional" ? "orange" : "neutral"}
                      variant={exam.status === "provisional" ? "outline" : "solid"}
                    >
                      {sentenceCase(exam.status)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-callout text-secondary tabular-nums">
                    {exam.status === "provisional" && exam.endDate
                      ? `${exam.startDate} – ${exam.endDate}`
                      : exam.startDate}
                  </p>
                  {exam.notes ? (
                    <p className="mt-1 line-clamp-2 text-callout whitespace-pre-wrap text-secondary">
                      {exam.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    size="sm"
                    label={`Edit ${exam.name}`}
                    icon={<Pencil />}
                    onClick={() => openExisting(exam)}
                  />
                  <IconButton
                    size="sm"
                    label={`Delete ${exam.name}`}
                    icon={<Trash2 />}
                    onClick={() => setPendingDelete(exam)}
                  />
                </div>
              </li>
            ))}
        </ul>
      )}

      {draft ? (
        <ExamSheet
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={(input) => {
            if (draft.id) onUpdate(draft.id, input);
            else onCreate(input);
            setDraft(null);
          }}
        />
      ) : null}
      {pendingDelete ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title="Delete exam or deadline?"
          description={`“${pendingDelete.name}” will be permanently removed.`}
          footer={
            <>
              <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-body text-secondary">This action cannot be undone.</p>
        </Sheet>
      ) : null}
    </Card>
  );
}

function ExamSheet({
  draft,
  onChange,
  onClose,
  onSave,
}: {
  draft: ExamDraft;
  onChange: (draft: ExamDraft) => void;
  onClose: () => void;
  onSave: (input: CompleteExamInput) => void;
}) {
  const nameError = draft.name.trim() ? undefined : "Enter a name.";
  const windowError =
    draft.status === "provisional" && draft.endDate && draft.endDate < draft.startDate
      ? "The window cannot end before it starts."
      : undefined;
  const disabled = Boolean(nameError || windowError || !draft.startDate);

  const save = () => {
    if (disabled) return;
    onSave({
      name: draft.name.trim(),
      kind: draft.kind,
      startDate: draft.startDate,
      endDate:
        draft.status === "provisional" && draft.endDate ? draft.endDate : undefined,
      status: draft.status,
      notes: draft.notes.trim(),
    });
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={draft.id ? "Edit exam or deadline" : "Add exam or deadline"}
      description="Confirmed dates are fixed. Provisional dates can include an uncertain window."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={disabled} onClick={save}>
            {draft.id ? "Save changes" : "Add exam"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <TextField
          autoFocus
          label="Name"
          value={draft.name}
          error={draft.name.length > 0 ? nameError : undefined}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Type"
            value={draft.kind}
            onChange={(event) =>
              onChange({ ...draft, kind: event.target.value as ExamKind })
            }
          >
            {EXAM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {sentenceCase(kind)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Certainty"
            value={draft.status}
            onChange={(event) => {
              const status = event.target.value as ExamStatus;
              onChange({
                ...draft,
                status,
                endDate: status === "confirmed" ? "" : draft.endDate,
              });
            }}
          >
            {EXAM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {sentenceCase(status)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className={draft.status === "provisional" ? "grid grid-cols-2 gap-3" : ""}>
          <TextField
            label={draft.status === "provisional" ? "Window starts" : "Date"}
            type="date"
            required
            value={draft.startDate}
            onChange={(event) => onChange({ ...draft, startDate: event.target.value })}
          />
          {draft.status === "provisional" ? (
            <TextField
              label="Window ends"
              type="date"
              min={draft.startDate}
              value={draft.endDate}
              error={windowError}
              hint="Optional when only one uncertain date is known."
              onChange={(event) => onChange({ ...draft, endDate: event.target.value })}
            />
          ) : null}
        </div>
        <TextArea
          label="Notes"
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        />
      </form>
    </Sheet>
  );
}

function sentenceCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
