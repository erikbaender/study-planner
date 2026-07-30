"use client";

import { useState } from "react";
import { type Course, type Plan, UNITS, UNIT_LABELS, type Unit } from "@/domain";
import { Button, SelectField, Sheet, TextField } from "@/ui";

type ItemKind = "semester" | "course" | "topic";

export function CreateItemSheet({
  open,
  onOpenChange,
  plan,
  course,
  onCreatePlan,
  onCreateCourse,
  onCreateTopic,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
  course: Course | null;
  onCreatePlan: (name: string) => void;
  onCreateCourse: (name: string) => void;
  onCreateTopic: (input: { name: string; unit: Unit; totalUnits: number }) => void;
}) {
  const [kind, setKind] = useState<ItemKind>(plan ? (course ? "topic" : "course") : "semester");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>(course?.topics[0]?.unit ?? "slides");
  const [totalUnits, setTotalUnits] = useState("0");


  const disabled =
    !name.trim() ||
    (kind === "course" && !plan) ||
    (kind === "topic" && !course) ||
    (kind === "topic" && (!Number.isFinite(Number(totalUnits)) || Number(totalUnits) < 0));

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || disabled) return;
    if (kind === "semester") onCreatePlan(trimmed);
    if (kind === "course") onCreateCourse(trimmed);
    if (kind === "topic") {
      onCreateTopic({ name: trimmed, unit, totalUnits: Number(totalUnits) });
    }
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New item"
      description="Add a semester, course, or topic without leaving the current view."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="accent" disabled={disabled} onClick={submit}>
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
        <SelectField
          label="Item"
          value={kind}
          onChange={(event) => setKind(event.target.value as ItemKind)}
        >
          <option value="semester">Semester</option>
          <option value="course" disabled={!plan}>
            Course
          </option>
          <option value="topic" disabled={!course}>
            Topic
          </option>
        </SelectField>

        <TextField
          autoFocus
          label={kind === "semester" ? "Semester name" : kind === "course" ? "Course name" : "Topic name"}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        {kind === "topic" ? (
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value as Unit)}
            >
              {UNITS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {UNIT_LABELS[candidate].plural}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Total"
              type="number"
              min={0}
              step={1}
              value={totalUnits}
              onChange={(event) => setTotalUnits(event.target.value)}
            />
          </div>
        ) : null}

        <button type="submit" className="sr-only">
          Create
        </button>
      </form>
    </Sheet>
  );
}
