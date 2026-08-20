"use client";

/**
 * One outline course card and the interactions owned by it.
 *
 * The outline coordinates ordering and cross-card selection. This module owns
 * everything inside one card: disclosure motion, status and completion,
 * topic/exam sections, context menus, and the card's creation sheets.
 */

import { clsx } from "clsx";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CalendarPlus, ClockAlert, Gauge, Pencil, Plus, Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseColorValue,
  courseProgress,
  type Course,
  type CourseHealth,
  type Exam,
  type PlannerSnapshot,
  type Topic,
} from "@/domain";
import {
  Badge,
  Button,
  ContextMenu,
  IconButton,
  ProgressBar,
  Sheet,
  TextField,
  useStableCallback,
} from "@/ui";
import { motionDuration } from "@/ui/motion";
import { useDisclosure, useRowTransitions } from "@/ui/row-motion";
import { AutoPlanButton } from "@/features/planning/planning-actions";
import {
  CourseCompletionCheckbox,
  triggerCourseCompletionAnimation,
} from "@/features/topics/progress-cell";
import { hintTarget, type InputHint } from "@/features/workspace/hints";
import { overdueBlockCount, topicsForQuery } from "@/features/workspace/scope";
import { requestRename, revealSelection, useWorkspace } from "@/features/workspace/store";
import { type BarSelection } from "@/features/timeline/chart-context";
import { LIST_ROW_CONTENT_HEIGHT, TOPIC_ROW_HEIGHT, TopicList } from "./topic-list";
import { TopicCreationSheet, type TopicCreationInput } from "./topic-creation-sheet";

const COURSE_HEADER_COLUMNS = [
  "grid items-center gap-2",
  "grid-cols-[minmax(4rem,1fr)_minmax(4.5rem,8rem)_1.25rem]",
  "sm:gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(5rem,9rem)_1.25rem]",
].join(" ");

export function CourseCard({
  course,
  health,
  today,
  query,
  snapshot,
  selectedId,
  courseSelection,
  labelHints,
  onSelectTopic,
  onSelectExam,
  onDeleteExam,
  onSelectCourse,
  onDeleteTopic,
  onDeleteCourse,
  onEditCourse,
}: {
  course: Course;
  health: CourseHealth | undefined;
  today: string;
  query: string;
  snapshot: PlannerSnapshot;
  selectedId: string | null;
  courseSelection: BarSelection;
  /** What the name does, published to the hint bar while it is pointed at. */
  labelHints: readonly InputHint[];
  onSelectTopic: (topic: Topic) => void;
  onSelectExam: (exam: Exam) => void;
  onDeleteExam: (exam: Exam) => void;
  onSelectCourse: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDeleteTopic: (topic: Topic) => void;
  onDeleteCourse: () => void;
  onEditCourse: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const [adding, setAdding] = useState<"topic" | "exam" | null>(null);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);
  const collapsed = useWorkspace((state) => state.collapsedCourseIds.includes(course.id));
  const progress = courseProgress(course);
  const tint = courseColorValue(course.color);
  // Memoized because `TopicList` animates arrivals and departures, and that
  // merge is keyed on this array's identity — a fresh one per render would
  // never settle.
  const topics = useMemo(
    // Repository order is the paste/import order and is also what the timeline
    // gutter uses. Keeping it here makes the same course scan the same way in
    // both views.
    () => topicsForQuery(query, course),
    [query, course],
  );
  const exams = useMemo(
    () =>
      [...course.exams].sort(
        (left, right) =>
          left.startDate.localeCompare(right.startDate) || left.order - right.order,
      ),
    [course.exams],
  );
  const disclosure = useDisclosure(!collapsed);
  const percent = progress.ratio === null ? null : Math.round(progress.ratio * 100);
  const completed = isCourseComplete(course);
  const overdueBlocks = overdueBlockCount(course, today);
  const paceStatus =
    health?.pace && !health.pace.onTrack
      ? health.pace.daysLate > 0
        ? `${health.pace.daysLate} days behind`
        : health.pace.projectedFinish === null
          ? "Finish unknown"
          : "Capacity shortfall"
      : null;
  const hasStatus = paceStatus !== null || overdueBlocks > 0;

  /**
   * Add a topic, select it, and put the caret in its name.
   *
   * A new row is never the thing you wanted — it is a placeholder for the thing
   * you were about to type. Creating it, opening the inspector on it and
   * selecting its name is one gesture from the student's side, so it is one
   * action here rather than three clicks in a row.
   */
  const createTopic = (input: TopicCreationInput, focus: boolean) =>
    run(
      repository
        .createTopic(course.id, { ...input, color: course.color })
        .then((topicId) => {
          if (!focus) return;
          revealSelection({ kind: "topic", id: topicId });
          requestRename(topicId);
        }),
    );

  /**
   * Every topic to full, or every topic back to nothing.
   *
   * Progress is only ever written as a study-log delta, here as everywhere
   * else, so a course marked done leaves the same trail forty individual ticks
   * would have — velocity and the pace projection still have something behind
   * them. Unsized topics are skipped rather than invented a size for.
   */
  const setCourseCompletion = (done: boolean) => {
    for (const topic of course.topics) {
      if (topic.totalUnits <= 0) continue;
      const target = done ? topic.totalUnits : 0;
      if (target === topic.completedUnits) continue;
      run(
        repository.logStudy({
          topicId: topic.id,
          date: today,
          units: target - topic.completedUnits,
        }),
      );
    }
  };

  /**
   * The card flashes when the *course* finishes, and only then.
   *
   * It used to flash whenever any topic inside it was ticked off, which said
   * "done" about a course with thirty topics left in it. Completion is a
   * property of the course, so the pulse is fired by the property changing —
   * whichever of the many ways of moving progress caused it.
   */
  const wasCompleted = useRef(completed);
  useEffect(() => {
    if (wasCompleted.current === completed) return;
    wasCompleted.current = completed;
    triggerCourseCompletionAnimation(course.id, completed);
  }, [completed, course.id]);

  return (
    <ContextMenu
      items={[
        { label: "Add topic", icon: <Plus />, onSelect: () => setAdding("topic") },
        { label: "Add exam", icon: <CalendarPlus />, onSelect: () => setAdding("exam") },
        { type: "separator" },
        { label: "Edit", icon: <Pencil />, onSelect: onEditCourse },
        { label: "Delete", icon: <Trash2 />, danger: true, onSelect: onDeleteCourse },
      ]}
    >
      <section
        data-course-id={course.id}
        data-course-completed={completed ? "true" : undefined}
        className="outline-card course-completion-row relative overflow-hidden rounded-card border border-separator bg-content"
        style={{ "--topic-completion-color": tint } as CSSProperties}
      >
        <div className="relative" data-keeps-selection>
          {/* The course uses the topic row's name, readout, bar and done
              structure, but lets the compact percentage column size to its
              content so unused readout space stays available to a long name. */}
          <div
            className={clsx(
              "outline-card-header relative p-3",
              !completed && "hover:bg-fill/50",
            )}
          >
            {/* The header's whole surface folds the card, laid under the
                contents so the name and the completion box keep their own
                clicks. Its hover fill is the affordance; the name draws a
                second, stronger one over it. */}
            <button
              type="button"
              onClick={() => useWorkspace.getState().toggleCourseCollapsed(course.id)}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${course.name}`}
              className="absolute inset-0 focus-visible:outline-none"
            />

            <div className={clsx(COURSE_HEADER_COLUMNS, "pointer-events-none relative")}>
              <span className="flex min-w-0 items-center gap-2">
                {/* The name is the selection control. Its padding is pulled
                    back on the left and above, so the row starts where it
                    always did and keeps its height. On the right the padding
                    is left standing: the selection ring is drawn 4px outside
                    the name, and cancelling that margin too put the ring on
                    top of the dot separating the name from the topic count. */}
                <h2 className="flex min-w-0 text-title3 font-semibold">
                  <button
                    type="button"
                    onClick={onSelectCourse}
                    data-selection={courseSelection ?? undefined}
                    aria-pressed={courseSelection !== null}
                    aria-label={`Select ${course.name}`}
                    {...hintTarget(labelHints)}
                    className="outline-course-label pointer-events-auto -my-0.5 -ml-1.5 flex min-w-0 items-center gap-2 rounded-control px-1.5 py-0.5 hover:bg-fill-strong"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: tint }}
                    />
                    <span className="min-w-0 truncate">{course.name}</span>
                  </button>
                </h2>

                {/* Lightweight metadata can yield to the title. Attention
                    labels cannot: they live on their own wrapping line below
                    so a narrow card always preserves the course's identity. */}
                <span className="hidden shrink-0 items-center gap-2 text-callout tabular-nums text-tertiary md:flex">
                  <span aria-hidden="true">·</span>
                  <span>
                    {course.topics.length} topic{course.topics.length === 1 ? "" : "s"}
                  </span>
                  {health?.exam && health.daysUntilExam !== null ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{health.daysUntilExam} days</span>
                    </>
                  ) : null}
                  {course.code ? <span aria-hidden="true">·</span> : null}
                  {course.code ? <span>{course.code}</span> : null}
                </span>
              </span>

              <span className="hidden text-right text-callout tabular-nums whitespace-nowrap text-secondary sm:block">
                {percent === null ? "—" : `${percent}%`}
              </span>

              <ProgressBar
                ratio={progress.ratio}
                label={`${course.name} progress`}
                tint={tint}
                size="sm"
                className="w-full min-w-0"
              />

              <CourseCompletionCheckbox
                courseId={course.id}
                courseName={course.name}
                checked={completed}
                disabled={progress.totalUnits === 0}
                onChange={() => setConfirmingCompletion(true)}
              />
            </div>

            {hasStatus ? (
              <div
                aria-label={`${course.name} status`}
                className="pointer-events-none relative mt-2 flex flex-wrap items-center gap-1.5"
              >
                {paceStatus !== null ? (
                  <Badge tone="warning">
                    <Gauge aria-hidden="true" className="size-3" strokeWidth={2} />
                    {paceStatus}
                  </Badge>
                ) : null}

                {overdueBlocks > 0 ? (
                  <Badge tone="negative">
                    <ClockAlert aria-hidden="true" className="size-3" strokeWidth={2} />
                    {overdueBlocks} overdue
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {disclosure.mounted ? (
          <CardBody expanded={disclosure.expanded}>
            <div className="border-t border-separator">
              <CardSection
                title="Exams"
                action={
                  <IconButton
                    size="sm"
                    label={`Add an exam to ${course.name}`}
                    // A plain plus, the same one topics and study blocks get.
                    // "Add" is the action; what is being added is said by the
                    // section the button sits in.
                    icon={<Plus />}
                    onClick={() => setAdding("exam")}
                  />
                }
              >
                <ExamList
                  exams={exams}
                  selectedId={selectedId}
                  onSelect={onSelectExam}
                  onDelete={onDeleteExam}
                />
              </CardSection>

              <CardSection
                title="Topics"
                action={
                  <IconButton
                    size="sm"
                    label={`Add a topic to ${course.name}`}
                    icon={<Plus />}
                    onClick={() => setAdding("topic")}
                  />
                }
              >
                {topics.length > 0 || course.topics.length === 0 ? (
                  <TopicList
                    courseId={course.id}
                    tint={tint}
                    topics={topics}
                    today={today}
                    selectedId={selectedId}
                    onSelect={onSelectTopic}
                    onDelete={onDeleteTopic}
                  />
                ) : (
                  <p className="p-2 text-callout text-tertiary">
                    No topic matches “{query.trim()}”.
                  </p>
                )}
              </CardSection>

              <div
                className="flex items-center justify-end gap-1.5 border-t border-separator p-2"
                data-keeps-selection
              >
                {/* AutoPlanButton owns its trigger variant. These selectors keep
                    it looking like the view's primary action. */}
                <span className="[&>button]:!bg-accent [&>button]:!text-on-accent [&>button]:!shadow-raised [&>button:hover]:!bg-accent-hover [&>button:active]:!bg-accent-hover">
                  <AutoPlanButton course={course} snapshot={snapshot} today={today} />
                </span>
              </div>
            </div>
          </CardBody>
        ) : null}

        <TopicCreationSheet
          open={adding === "topic"}
          onOpenChange={(open) => setAdding(open ? "topic" : null)}
          course={course}
          onCreate={createTopic}
          onCreateMany={(newTopics) => run(repository.createTopics(course.id, newTopics, course.color))}
        />

        <ExamSheet
          open={adding === "exam"}
          onOpenChange={(open) => setAdding(open ? "exam" : null)}
          course={course}
          today={today}
          onSubmit={(input) => {
            run(repository.createExam(course.id, input));
            setAdding(null);
          }}
        />

        <ConfirmCourseCompletionSheet
          open={confirmingCompletion}
          onOpenChange={setConfirmingCompletion}
          course={course}
          done={!completed}
          onConfirm={() => {
            setCourseCompletion(!completed);
            setConfirmingCompletion(false);
          }}
        />
      </section>
    </ContextMenu>
  );
}

/** Whether every sized topic in the course is finished, and there is one to finish. */
function isCourseComplete(course: Course): boolean {
  const sized = course.topics.filter((topic) => topic.totalUnits > 0);
  return sized.length > 0 && sized.every((topic) => topic.completedUnits >= topic.totalUnits);
}

/**
 * A titled group inside a course card.
 *
 * The same shape as a sidebar section — an uppercase title with its actions on
 * the right of the same row, then the list — so the outline's exams and topics
 * are read the same way as the source list's courses. Padding is uniform on all
 * four sides, and the rows inside carry their own 3px slot, which is why the
 * body's inset lines up with the header above it.
 */
function CardSection({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-separator p-2 last:border-b-0" data-keeps-selection>
      {/* 11px, not 8: a row below is inset by its own 3px transition slot on
          top of this section's padding, and a title that does not start where
          the rows start reads as a second, narrower column. */}
      <header className="flex h-6 items-center gap-1 pr-2 pl-[11px]">
        <h3 className="text-caption font-semibold tracking-wide text-tertiary uppercase">{title}</h3>
        <span className="ml-auto">{action}</span>
      </header>
      {children}
    </section>
  );
}

/**
 * Marking a whole course done, or undoing it.
 *
 * One click here rewrites every topic's progress, which is the largest edit the
 * outline can make and the one with no undo. Asking first is the same bargain
 * the delete sheets strike.
 */
function ConfirmCourseCompletionSheet({
  open,
  onOpenChange,
  course,
  done,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  /** `true` when confirming completion, `false` when clearing it. */
  done: boolean;
  onConfirm: () => void;
}) {
  const sized = course.topics.filter((topic) => topic.totalUnits > 0).length;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="sm"
      title={done ? `Mark “${course.name}” as done?` : `Clear progress in “${course.name}”?`}
      description={
        done
          ? `All ${sized} sized topic${sized === 1 ? "" : "s"} will be set to full progress, logged as studied today.`
          : `All ${sized} sized topic${sized === 1 ? "" : "s"} will be set back to no progress.`
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={done ? "accent" : "danger"} onClick={onConfirm}>
            {done ? "Mark done" : "Clear progress"}
          </Button>
        </>
      }
    >
      <p className="text-callout text-secondary">
        {done
          ? "Topics with no size are left alone: there is nothing to count them against."
          : "This does not delete the study log; it records the difference, so your history stays honest."}
      </p>
    </Sheet>
  );
}

/**
 * A course opening and closing.
 *
 * The height is measured rather than computed: the card contents can change
 * while a disclosure is open, and a card that animates to a stale height either
 * clips its last row or leaves a strip of empty card under it.
 *
 * It is measured *only across the toggle itself*, and the card sits at `auto`
 * the rest of the time. Keeping a `ResizeObserver` on the contents was one
 * layout read per change of contents in theory and a re-render of the entire
 * course on every frame of any animation that changes the window's width in
 * practice — the inspector sliding in resized the content column, which resized
 * this, which set state, which laid the card out again. At `auto` a card
 * follows its contents for free, which is what the observer was there for.
 */
function CardBody({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  // Written to the element rather than held in state. The height only exists
  // for the length of the animation, nothing else in the card depends on it,
  // and rendering twice per frame to carry a number the browser is already
  // interpolating is the expensive way to say the same thing.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;

    if (!mounted.current) {
      mounted.current = true;
      // A card that is simply open on arrival is open. Committing zero and
      // correcting it afterwards is a transition, and a view that plays one for
      // every card the moment you switch to it is a splash screen.
      element.style.height = expanded ? "auto" : "0px";
      return;
    }

    const full = content.current?.offsetHeight ?? 0;
    // Both ends have to be real lengths: `auto` is not a value a transition can
    // start from, so a closing card is pinned to the height it currently has
    // before it is given zero.
    element.style.height = expanded ? "0px" : `${full}px`;
    void element.offsetHeight;
    element.style.height = expanded ? `${full}px` : "0px";

    if (!expanded) return;
    // Back to `auto` once it has arrived, so a card that later gains a row
    // follows its contents without anything having to measure them.
    const timer = window.setTimeout(() => {
      element.style.height = "auto";
    }, motionDuration(document.documentElement) / 2);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  return (
    <div ref={box} className="outline-disclosure">
      <div ref={content}>{children}</div>
    </div>
  );
}

/* ─── Exams ─────────────────────────────────────────────────────────────── */

/**
 * Exams use the same vertical rhythm as topics. Dates are important course
 * material, and a row of their own keeps the name, date window and provisional
 * status readable without competing with the course actions.
 */
function ExamList({
  exams,
  selectedId,
  onSelect,
  onDelete,
}: {
  /** Must be memoized so row transitions only reconcile when exam data changes. */
  exams: readonly Exam[];
  selectedId: string | null;
  onSelect: (exam: Exam) => void;
  onDelete: (exam: Exam) => void;
}) {
  const rows = useRowTransitions(exams, (exam) => exam.id, TOPIC_ROW_HEIGHT);
  const select = useStableCallback(onSelect);
  const remove = useStableCallback(onDelete);

  if (exams.length === 0) {
    return <p className="px-2 py-1 text-callout text-tertiary">No exams yet.</p>;
  }

  return (
    <ul className="flex flex-col">
      {rows.map(({ key, item: exam, motion }) => (
        <li
          key={key}
          aria-hidden={motion.visible ? undefined : "true"}
          inert={motion.visible ? undefined : true}
          // Settled rows draw outside their slot, exactly as topic rows do.
          data-settled={motion.visible ? "true" : undefined}
          className="row-motion shrink-0 p-[3px]"
          style={{ height: motion.height, opacity: motion.visible ? 1 : 0 }}
        >
          <MemoExamRow
            exam={exam}
            selected={exam.id === selectedId}
            onSelect={select}
            onDelete={remove}
          />
        </li>
      ))}
    </ul>
  );
}

function ExamRow({
  exam,
  selected,
  onSelect,
  onDelete,
}: {
  exam: Exam;
  selected: boolean;
  onSelect: (exam: Exam) => void;
  onDelete: (exam: Exam) => void;
}) {
  return (
    // Deleting is a row action, so it is where every other row action in the
    // app is: the context menu, and the inspector once the exam is selected. A
    // trash button on the row itself was a third place to say the same thing,
    // sitting one row away from the topics whose rows do not have one.
    <ContextMenu
      items={[{ label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => onDelete(exam) }]}
    >
      <div
        onContextMenu={(event) => {
          // The course card wraps this row in a menu of its own; stop here so an
          // exam action cannot open the course's menu.
          event.stopPropagation();
        }}
        className={clsx(
          "relative flex h-full items-center gap-2 rounded-control px-2",
          // Hovered whether or not it is selected, and ringed from outside,
          // exactly like a topic row: see `TopicRow`.
          "hover:bg-fill data-[state=open]:bg-fill",
          selected && "outline-2 outline-offset-2 outline-accent",
        )}
        style={{ height: LIST_ROW_CONTENT_HEIGHT }}
      >
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Select ${exam.name}`}
          onClick={() => onSelect(exam)}
          className="absolute inset-0 rounded-control focus-visible:outline-2 focus-visible:-outline-offset-2"
        />

        <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2 text-callout">
          <span className="min-w-0 truncate">{exam.name}</span>
          <span className="shrink-0 tabular-nums text-tertiary">
            {exam.status === "provisional" && exam.endDate
              ? `${exam.startDate} – ${exam.endDate}`
              : exam.startDate}
          </span>
          {exam.status === "provisional" ? <Badge tone="warning">Provisional</Badge> : null}
        </div>
      </div>
    </ContextMenu>
  );
}

const MemoExamRow = memo(ExamRow);

function ExamSheet({
  open,
  onOpenChange,
  course,
  today,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  today: string;
  onSubmit: (input: { name: string; startDate: string; endDate?: string }) => void;
}) {
  const [name, setName] = useState(`${course.name} exam`);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setName(`${course.name} exam`);
    setStartDate(today);
    setEndDate("");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Exam for ${course.name}`}
      description="Everything the app says about pace is counted backwards from this date."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="accent"
            disabled={name.trim() === ""}
            // An end date is what makes an exam provisional; the repository
            // derives the status rather than asking for it twice.
            onClick={() => onSubmit({ name: name.trim(), startDate, endDate: endDate || undefined })}
          >
            Add exam
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <TextField
          label="Date"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <TextField
          label="Window ends"
          type="date"
          hint="Optional. Filling it in marks the date provisional, and planning then counts backwards from the start of the window rather than the end."
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </div>
    </Sheet>
  );
}
