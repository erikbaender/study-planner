"use client";

/**
 * Topic creation at both useful scales.
 *
 * Typing forty lecture titles one dialog at a time is the single worst thing
 * the old UI asked of anyone, and a "Paste outline" button sitting next to an
 * "Add topic" button asked the student to decide which kind of adding they were
 * doing before they had started. They are the same intent at two scales, so
 * they are one sheet with a switch at the top: a form for the topic you can
 * describe, a paste box for the list you already have.
 *
 * The form has two ways to confirm. **Add another** keeps the sheet open and
 * clears the fields, which is what you want on the third of five topics;
 * **Add topic** is the ordinary one that closes. The preview under the paste
 * box is the important part of the other mode: it shows what will be created
 * *before* it is created, so a mis-parsed line is caught here rather than found
 * later as forty topics named wrongly.
 */

import { useRef, useState } from "react";
import {
  formatOutline,
  parseOutline,
  UNITS,
  UNIT_LABELS,
  type Course,
  type Unit,
} from "@/domain";
import {
  Button,
  SegmentedControl,
  SelectField,
  Sheet,
  Stepper,
  TextArea,
  TextField,
} from "@/ui";

export type TopicCreationInput = {
  name: string;
  unit: Unit;
  totalUnits: number;
};

export function TopicCreationSheet({
  open,
  onOpenChange,
  course,
  onCreate,
  onCreateMany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  onCreate: (input: TopicCreationInput, focus: boolean) => void;
  onCreateMany: (topics: TopicCreationInput[]) => void;
}) {
  const defaultUnit = course.topics.at(-1)?.unit ?? "slides";
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [name, setName] = useState("");
  const [totalUnits, setTotalUnits] = useState(0);
  const [unit, setUnit] = useState<Unit>(defaultUnit);
  const [text, setText] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const parsed = parseOutline(text, { defaultUnit: unit });

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setMode("single");
    setName("");
    setTotalUnits(0);
    setUnit(defaultUnit);
    setText("");
  }

  const submitOne = (keepOpen: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, unit, totalUnits }, !keepOpen);
    if (!keepOpen) {
      onOpenChange(false);
      return;
    }
    // Cleared rather than kept: the next topic is a different topic, and a name
    // left in the field is the one thing that gets accidentally added twice.
    setName("");
    setTotalUnits(0);
    nameRef.current?.focus();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width={mode === "single" ? "md" : "lg"}
      title={`Add topics to ${course.name}`}
      description={
        mode === "single"
          ? "A topic is one thing to get through — a lecture, a chapter, a problem set."
          : "One topic per line. Add “— 42 slides” to a line to record how big it is."
      }
      footer={
        mode === "single" ? (
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={name.trim() === ""} onClick={() => submitOne(true)}>
              Add another
            </Button>
            <Button variant="accent" disabled={name.trim() === ""} onClick={() => submitOne(false)}>
              Add topic
            </Button>
          </>
        ) : (
          <>
            {course.topics.length > 0 ? (
              <Button className="mr-auto" onClick={() => setText(formatOutline(course.topics))}>
                Load existing topics
              </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="accent"
              disabled={parsed.topics.length === 0}
              onClick={() => {
                onCreateMany(
                  parsed.topics.map((topic) => ({
                    name: topic.name,
                    unit: topic.unit,
                    totalUnits: topic.totalUnits,
                  })),
                );
                onOpenChange(false);
              }}
            >
              Add {parsed.topics.length || ""} topic{parsed.topics.length === 1 ? "" : "s"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl
          label="How to add topics"
          value={mode}
          onValueChange={(next) => setMode(next as "single" | "bulk")}
          segments={[
            { value: "single", label: "One topic" },
            { value: "bulk", label: "Paste a list" },
          ]}
        />

        {mode === "single" ? (
          <>
            <TextField
              ref={nameRef}
              label="Name"
              autoFocus
              placeholder="Glycolysis"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submitOne(event.metaKey || event.ctrlKey);
              }}
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-callout font-medium text-secondary">Size</span>
                <Stepper
                  label="Total units in this topic"
                  min={0}
                  value={totalUnits}
                  onValueChange={setTotalUnits}
                />
              </div>
              <SelectField
                label="Unit"
                fieldClassName="max-w-48"
                value={unit}
                onValueChange={(value) => setUnit(value as Unit)}
                options={UNITS.map((candidate) => ({
                  value: candidate,
                  label: UNIT_LABELS[candidate].plural,
                }))}
              />
            </div>
            <p className="text-footnote text-secondary">
              A size is what lets the app work out whether this course will be finished in time. It
              can be left at zero and filled in later.
            </p>
          </>
        ) : (
          <>
            <TextArea
              label="Outline"
              hideLabel
              rows={10}
              autoFocus
              placeholder={"Glycolysis — 42 slides\nCitric acid cycle — 38\nLipid metabolism — 61"}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="font-mono"
            />

            <SelectField
              label="Unit for lines that do not name one"
              fieldClassName="max-w-64"
              value={unit}
              onValueChange={(value) => setUnit(value as Unit)}
              options={UNITS.map((candidate) => ({
                value: candidate,
                label: UNIT_LABELS[candidate].plural,
              }))}
            />

            {parsed.issues.length > 0 ? (
              <ul role="alert" className="flex flex-col gap-0.5 text-footnote text-negative">
                {parsed.issues.map((issue) => (
                  <li key={`${issue.line}-${issue.message}`}>
                    Line {issue.line}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {parsed.topics.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-caption font-semibold tracking-wide text-tertiary uppercase">
                  Preview
                </h3>
                <ul className="flex max-h-56 flex-col overflow-y-auto rounded-control bg-content-alt p-2">
                  {parsed.topics.map((topic, index) => (
                    <li
                      key={`${topic.name}-${index}`}
                      className="flex items-baseline gap-2 px-1 py-0.5 text-body"
                    >
                      <span className="min-w-0 flex-1 truncate">{topic.name}</span>
                      <span className="shrink-0 text-callout tabular-nums text-secondary">
                        {topic.totalUnits > 0
                          ? `${topic.totalUnits} ${UNIT_LABELS[topic.unit].plural}`
                          : // A size nobody stated stays unstated; the row still
                            // gets created, it just is not counted in any pace.
                            "no size"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
