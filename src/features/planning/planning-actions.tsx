"use client";

/**
 * Planning actions: *Auto-plan*, *Reflow from today*, and the preview sheet
 * they share.
 *
 * The preview is the point. §6 says failure is an output rather than an
 * exception, and this is where that surfaces: before anything is written you
 * see how many blocks will be placed, and — when the work does not fit — the
 * capacity it would have taken, in units per day, with the shortfall. Writing
 * an impossible plan silently is the worst outcome for someone whose actual
 * problem is not knowing she is behind until it is too late.
 *
 * Both actions go through `replaceAutoBlocks`, which swaps only blocks the
 * scheduler owns. A hand-placed block is a commitment its owner made and is
 * never moved, never overwritten, and never regenerated.
 */

import { useState } from "react";
import { CalendarSync, Wand2 } from "lucide-react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
import {
  describeShortfall,
  FALLBACK_CAPACITY_UNITS,
  schedule,
  type Course,
  type IsoDate,
  type PlannerSnapshot,
} from "@/domain";
import { Badge, Button, Sheet, Stepper } from "@/ui";

export function PlanningActions({
  courses,
  snapshot,
  today,
  size = "md",
}: {
  /** The courses in focus. Planning respects the focus, so "Reflow" means "reflow what I am looking at". */
  courses: readonly Course[];
  snapshot: PlannerSnapshot;
  today: IsoDate;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} variant="accent" leadingIcon={<CalendarSync />} onClick={() => setOpen(true)}>
        Reflow
      </Button>
      <PlanSheet
        open={open}
        onOpenChange={setOpen}
        courses={courses}
        snapshot={snapshot}
        today={today}
      />
    </>
  );
}

export function AutoPlanButton({
  course,
  snapshot,
  today,
}: {
  course: Course;
  snapshot: PlannerSnapshot;
  today: IsoDate;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" leadingIcon={<Wand2 />} onClick={() => setOpen(true)}>
        Auto-plan
      </Button>
      <PlanSheet
        open={open}
        onOpenChange={setOpen}
        courses={[course]}
        snapshot={snapshot}
        today={today}
      />
    </>
  );
}

function PlanSheet({
  open,
  onOpenChange,
  courses,
  snapshot,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: readonly Course[];
  snapshot: PlannerSnapshot;
  today: IsoDate;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();

  const stored = snapshot.preferences.dailyCapacityUnits;
  const [capacity, setCapacity] = useState(stored ?? FALLBACK_CAPACITY_UNITS);

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setCapacity(stored ?? FALLBACK_CAPACITY_UNITS);
  }

  // The what-if: the plan is recomputed at whatever the stepper says, and
  // nothing is written until Apply. Trying a capacity is meant to be free.
  const result = schedule({
    courses,
    today,
    calendar: snapshot.preferences,
    dailyCapacityUnits: capacity,
  });

  const topicIds = courses.flatMap((course) => course.topics.map((topic) => topic.id));
  const days = new Set(result.blocks.flatMap((block) => [block.startDate, block.endDate])).size;

  const apply = () => {
    run(repository.replaceAutoBlocks(topicIds, result.blocks));
    // The capacity you planned at becomes the capacity you have. Leaving them
    // to disagree would make every later pace figure describe a plan nobody made.
    if (capacity !== stored) {
      run(repository.savePreferences({ ...snapshot.preferences, dailyCapacityUnits: capacity }));
    }
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={courses.length === 1 ? `Plan ${courses[0].name}` : "Reflow from today"}
      description="Blocks before today are left alone as a record of what actually happened. Anything you placed by hand stays exactly where it is."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="accent" onClick={apply} disabled={result.blocks.length === 0}>
            Apply plan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-callout font-medium text-secondary">Units per study day</span>
            <Stepper
              label="Units per study day"
              value={capacity}
              onValueChange={setCapacity}
              step={5}
              min={1}
            />
          </div>
          <p className="pb-1.5 text-callout text-tertiary">
            Try a number before committing to it — nothing is saved until you apply.
          </p>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="text-caption tracking-wide text-tertiary uppercase">Blocks</dt>
            <dd className="text-title3 tabular-nums">{result.blocks.length}</dd>
          </div>
          <div>
            <dt className="text-caption tracking-wide text-tertiary uppercase">Days touched</dt>
            <dd className="text-title3 tabular-nums">{days}</dd>
          </div>
          <div>
            <dt className="text-caption tracking-wide text-tertiary uppercase">Fits</dt>
            <dd>
              {result.shortfalls.length === 0 ? (
                <Badge tone="green">Everything fits</Badge>
              ) : (
                <Badge tone="red">
                  {result.shortfalls.length} course{result.shortfalls.length === 1 ? "" : "s"} short
                </Badge>
              )}
            </dd>
          </div>
        </dl>

        {result.shortfalls.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-control bg-red/10 p-3">
            <h3 className="text-body font-semibold text-red">This plan does not fit</h3>
            <ul className="flex flex-col gap-1 text-body">
              {result.shortfalls.map((shortfall) => (
                <li key={shortfall.courseId}>{describeShortfall(shortfall, capacity)}</li>
              ))}
            </ul>
            <p className="text-footnote text-secondary">
              Applying it anyway is still better than not planning: it schedules everything that
              does fit, in deadline order, so what gets dropped is the work with the most time left.
            </p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
