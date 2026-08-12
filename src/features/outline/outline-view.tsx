"use client";

/**
 * Outline — where the material lives.
 *
 * One card per course, holding its topics, its exam dates and the two actions
 * that fill a course with material. This is the view you are in when you are
 * *managing* topics: adding them, removing them, moving their progress, and
 * picking one out to change in the inspector. It is deliberately not the view
 * for arranging time — the timeline does that far better than a list of dates
 * ever could, and trying to do both here is what turned the old outline into a
 * spreadsheet.
 *
 * Two rules the layout follows, both learned the hard way:
 *
 * - **Density is the design.** A semester is seven courses of forty topics. A
 *   card with four-pixel-heavier padding costs three hundred pixels of screen
 *   across a term's worth of material, and the outline stops being something
 *   you can see and becomes something you scroll. Every measurement here is the
 *   smallest one that still reads.
 * - **A control does one thing.** The course header opens and closes the
 *   course. Topic rows select topics, while course selection happens through
 *   the app's explicit selection surfaces so opening a course never doubles as
 *   inspecting it.
 */

import { clsx } from "clsx";
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, CalendarPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  courseProgress,
  courseColorValue,
  formatOutline,
  parseOutline,
  UNITS,
  UNIT_LABELS,
  type Course,
  type CourseHealth,
  type PlannerSnapshot,
  type Exam,
  type Topic,
  type Unit,
} from "@/domain";
import {
  Badge,
  Button,
  Collapse,
  ContextMenu,
  CountdownBadge,
  EmptyState,
  IconButton,
  ProgressBar,
  SegmentedControl,
  SelectField,
  Sheet,
  Stepper,
  TextArea,
  TextField,
  useStableCallback,
  useListPresence,
} from "@/ui";
import { motionDuration } from "@/ui/motion";
import { useDisclosure, useRowTransitions } from "@/ui/row-motion";
import { COLUMNS, LIST_ROW_CONTENT_HEIGHT, TOPIC_ROW_HEIGHT, TopicList } from "./topic-list";
import { AutoPlanButton } from "@/features/planning/planning-actions";
import {
  CourseCompletionCheckbox,
  triggerCourseCompletionAnimation,
} from "@/features/topics/progress-cell";
import { hintScope, useViewHints, type InputHint } from "@/features/workspace/hints";
import { overdueBlockCount, topicsForQuery } from "@/features/workspace/scope";
import { requestRename, revealSelection, useWorkspace } from "@/features/workspace/store";

/** What the pointer does here, for the toolbar's hint bar. */
const OUTLINE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Select topic" },
  { button: "left", label: "Set progress", drag: true },
  { button: "right", label: "Actions" },
];

const courseKey = (course: Course) => course.id;

export function OutlineView({
  courses,
  health,
  today,
  query,
  snapshot,
  selectedId,
  onSelectTopic,
  onSelectExam,
  onDeleteTopic,
  onDeleteCourse,
  onEditCourse,
  onNewCourse,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  today: string;
  snapshot: PlannerSnapshot;
  query: string;
  selectedId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
  onSelectExam: (course: Course, exam: Exam) => void;
  onDeleteTopic: (course: Course, topic: Topic) => void;
  onDeleteCourse: (course: Course) => void;
  onEditCourse: (courseId: string) => void;
  onNewCourse: () => void;
}) {
  useViewHints(OUTLINE_HINTS);
  // Courses filtered out by the sidebar or the search field leave the way rows
  // leave the chart — fading, then collapsing — rather than vanishing between
  // two frames. `useListPresence` keeps them mounted for exactly that long.
  const cards = useListPresence(courses, courseKey);

  return (
    <div className="h-full" {...hintScope}>
      {/* `min-h-full`, so the space below the last card is still the view and a
          click there clears the selection. */}
      <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-2 p-5">
        {cards.map(({ key, item, present, appear }) => (
          <Collapse key={key} present={present} appear={appear}>
            <CourseCard
              course={item}
              health={health.get(item.id)}
              today={today}
              query={query}
              snapshot={snapshot}
              selectedId={selectedId}
              onSelectTopic={(topic) => onSelectTopic(item, topic)}
              onSelectExam={(exam) => onSelectExam(item, exam)}
              onDeleteTopic={(topic) => onDeleteTopic(item, topic)}
              onDeleteCourse={() => onDeleteCourse(item)}
              onEditCourse={() => onEditCourse(item.id)}
            />
          </Collapse>
        ))}

        <Collapse present={courses.length === 0}>
          <EmptyState
            title="No courses in focus"
            description="Add a course, or widen the focus in the sidebar to see the ones you have."
            action={
              <Button variant="accent" leadingIcon={<Plus />} onClick={onNewCourse}>
                New course
              </Button>
            }
          />
        </Collapse>
      </div>
    </div>
  );
}

function CourseCard({
  course,
  health,
  today,
  query,
  snapshot,
  selectedId,
  onSelectTopic,
  onSelectExam,
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
  onSelectTopic: (topic: Topic) => void;
  onSelectExam: (exam: Exam) => void;
  onDeleteTopic: (topic: Topic) => void;
  onDeleteCourse: () => void;
  onEditCourse: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const [adding, setAdding] = useState<"topic" | "exam" | null>(null);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);
  const collapsed = useWorkspace((state) => state.collapsedCourseIds.includes(course.id));
  const toggleCollapsed = useWorkspace((state) => state.toggleCourseCollapsed);
  const progress = courseProgress(course);
  const selected = course.id === selectedId;
  const tint = courseColorValue(course.color);
  // Memoized because `TopicList` animates arrivals and departures, and that
  // merge is keyed on this array's identity — a fresh one per render would
  // never settle.
  const topics = useMemo(
    () => topicsForQuery(query, course).sort((left, right) => left.name.localeCompare(right.name, "de")),
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
  const behindDays = health?.pace && !health.pace.onTrack ? health.pace.daysLate : null;

  /**
   * Add a topic, select it, and put the caret in its name.
   *
   * A new row is never the thing you wanted — it is a placeholder for the thing
   * you were about to type. Creating it, opening the inspector on it and
   * selecting its name is one gesture from the student's side, so it is one
   * action here rather than three clicks in a row.
   */
  const createTopic = (input: { name: string; unit: Unit; totalUnits: number }, focus: boolean) =>
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
    triggerCourseCompletionAnimation(course.id, done);
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
        style={{ "--topic-completion-color": tint } as CSSProperties}
        className={clsx(
          "outline-card course-completion-row relative overflow-hidden rounded-card border bg-content",
          // Selection is a border, never a fill: a completed course already
          // owns its background, and a blue wash over it would say the two
          // states are one. See the topic rows, which do the same.
          selected ? "border-accent" : "border-separator",
        )}
      >
        <div className="relative" data-keeps-selection>
          {/* Laid out exactly like a topic row — name, readout, bar, done — so
              the course reads as the sum of the rows beneath it rather than as
              a different kind of thing. The horizontal inset matches a row's:
              the list's own padding plus the slot each row is inset by. */}
          <div
            className={clsx(
              "outline-card-header relative px-[11px] py-3",
              !completed && "hover:bg-fill/50",
            )}
          >
            <button
              type="button"
              onClick={() => toggleCollapsed(course.id)}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${course.name}`}
              className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2"
            />

            <div className={clsx(COLUMNS, "pointer-events-none relative px-2")}>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: tint }}
                />
                <h2 className="min-w-0 truncate text-title3 font-semibold">{course.name}</h2>

                {/* Everything that describes the course rather than measures it
                    sits with the name: counts first, then the warnings, then
                    the exam. Only the three measurement columns stay on the
                    right, where the same three sit on every topic row. */}
                <span className="hidden shrink-0 items-center gap-2 text-callout tabular-nums text-tertiary md:flex">
                  <span aria-hidden="true">·</span>
                  <span>
                    {course.topics.length} topic{course.topics.length === 1 ? "" : "s"}
                  </span>
                  {course.code ? <span aria-hidden="true">·</span> : null}
                  {course.code ? <span>{course.code}</span> : null}
                </span>

                {behindDays !== null ? (
                  <Badge tone="warning">
                    <AlertTriangle aria-hidden="true" className="size-3" strokeWidth={2} />
                    {behindDays} day{behindDays === 1 ? "" : "s"} behind
                  </Badge>
                ) : null}

                {overdueBlocks > 0 ? (
                  <Badge tone="negative">
                    <AlertTriangle aria-hidden="true" className="size-3" strokeWidth={2} />
                    {overdueBlocks} overdue
                  </Badge>
                ) : null}

                {health?.exam && health.daysUntilExam !== null ? (
                  <CountdownBadge
                    days={health.daysUntilExam}
                    provisional={health.exam.status === "provisional"}
                    atRisk={Boolean(health.pace && !health.pace.onTrack)}
                  />
                ) : null}
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
                    icon={<CalendarPlus />}
                    onClick={() => setAdding("exam")}
                  />
                }
              >
                <ExamList
                  exams={exams}
                  selectedId={selectedId}
                  onSelect={onSelectExam}
                  onDelete={(exam) => run(repository.deleteExam(exam.id))}
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
                    course={course}
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
                className="flex items-center gap-1.5 border-t border-separator p-2"
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

        <NewTopicSheet
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
  return (
    course.topics.length > 0 &&
    course.topics.every((topic) => topic.totalUnits > 0 && topic.completedUnits >= topic.totalUnits)
  );
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
    <div
      className={clsx(
        "group relative flex h-full items-center gap-2 rounded-control px-2",
        selected ? "inset-ring-2 inset-ring-accent" : "hover:bg-fill",
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

      <IconButton
        size="sm"
        label={`Delete ${exam.name}`}
        icon={<Trash2 />}
        onClick={() => onDelete(exam)}
        className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
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

/* ─── Adding topics ─────────────────────────────────────────────────────── */

/**
 * One sheet, two ways of filling a course.
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
function NewTopicSheet({
  open,
  onOpenChange,
  course,
  onCreate,
  onCreateMany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course;
  onCreate: (input: { name: string; unit: Unit; totalUnits: number }, focus: boolean) => void;
  onCreateMany: (topics: Array<{ name: string; unit: Unit; totalUnits: number }>) => void;
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
              options={UNITS.map((candidate) => ({ value: candidate, label: UNIT_LABELS[candidate].plural }))}
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
