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
 * - **Opening a course and selecting it are two gestures.** The card's header
 *   folds and unfolds it: that is a question about how much of the outline you
 *   want to see at once. The course's *name* is a control of its own — it puts
 *   the course in the inspector, and a second click lets it go, exactly as a
 *   topic row does. The two used to be one click, and the price was that you
 *   could not read a card's topics without taking the inspector off whatever
 *   you were working on, nor inspect a course without unfolding forty rows. A
 *   click on empty space still clears the selection, and the sidebar's course
 *   list is still a filter rather than a selection surface.
 *
 * The order the cards are stacked in is the user's, and this is the only view
 * that offers the choice: everywhere else a course list is scanned for a name
 * you already know, so alphabetical is the only order that helps. Here the
 * question is what to work on next, and the exam calendar answers it better
 * than the alphabet does — see `COURSE_SORTS`.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronsDown, ChevronsUp, Plus } from "lucide-react";
import {
  type Course,
  type CourseHealth,
  type PlannerSnapshot,
  type Exam,
  type Topic,
} from "@/domain";
import {
  Button,
  Collapse,
  EmptyState,
  IconButton,
  SegmentedControl,
  useKeyboardMode,
  useListPresence,
} from "@/ui";
import { useReorderMotion } from "@/ui/row-motion";
import { hintScope, useViewHints, type InputHint } from "@/features/workspace/hints";
import { sortCourses } from "@/features/workspace/scope";
import {
  COURSE_SORTS,
  COURSE_SORT_LABELS,
  useWorkspace,
  type CourseSort,
} from "@/features/workspace/store";
import { createSelectionStore } from "@/features/timeline/chart-context";
import { CourseCard } from "./course-card";

/** What the pointer does over a card, for the toolbar's hint bar. */
const OUTLINE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Fold course" },
  { button: "right", label: "Actions" },
];

/** The name is its own control, so it says its own verb while pointed at. */
const COURSE_LABEL_HINTS: readonly InputHint[] = [
  { button: "left", label: "Select course" },
  { button: "right", label: "Actions" },
];

function courseLabelSelectedHints(keyboardMode: "mac" | "windows"): readonly InputHint[] {
  return [
    COURSE_LABEL_HINTS[0],
    { button: "left", label: "Extend selection", modifier: "Shift" },
    {
      button: "left",
      label: "Subtract selection",
      modifier: keyboardMode === "mac" ? "⌘" : "Ctrl",
    },
    COURSE_LABEL_HINTS[1],
  ];
}

const courseKey = (course: Course) => course.id;
/** A card box, identified across a reorder by the course it holds. */
const courseCardKey = (box: HTMLElement) =>
  box.querySelector("section[data-course-id]")?.getAttribute("data-course-id") ?? undefined;
const EMPTY_COURSE_SELECTION: readonly string[] = [];

export function OutlineView({
  courses,
  health,
  today,
  query,
  snapshot,
  selectedId,
  onSelectTopic,
  onSelectExam,
  onDeleteExam,
  onSelectCourse,
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
  onDeleteExam: (course: Course, exam: Exam) => void;
  /** A course's name was clicked: `selected` says whether it is now the inspector's. */
  onSelectCourse: (course: Course, selected: boolean) => void;
  onSelectExam: (course: Course, exam: Exam) => void;
  onDeleteTopic: (course: Course, topic: Topic) => void;
  onDeleteCourse: (course: Course) => void;
  onEditCourse: (courseId: string) => void;
  onNewCourse: () => void;
}) {
  const [selection] = useState(createSelectionStore);
  const keyboardMode = useKeyboardMode();
  const workspaceSelection = useWorkspace((state) => state.selection);
  const courseSort = useWorkspace((state) => state.courseSort);
  const setCourseSort = useWorkspace((state) => state.setCourseSort);
  const collapsedCourseIds = useWorkspace((state) => state.collapsedCourseIds);
  const foldCourses = useWorkspace((state) => state.foldCourses);
  const unfoldCourses = useWorkspace((state) => state.unfoldCourses);
  const revealCourseId = useWorkspace((state) => state.revealCourseId);
  // The cards travel to their new places rather than appearing in them; the
  // positions they travel from can only be read before the click re-renders.
  const listRef = useRef<HTMLDivElement>(null);
  const captureOrder = useReorderMotion(listRef, courseSort, courseCardKey);
  // The shell hands every view the same alphabetical list; the order the cards
  // are actually stacked in is the outline's own question.
  const sortedCourses = useMemo(
    () => sortCourses(courses, courseSort, today),
    [courses, courseSort, today],
  );
  const selectedCourseIds = useSyncExternalStore(
    selection.subscribe,
    selection.getSnapshot,
    () => EMPTY_COURSE_SELECTION,
  );
  const visibleCourseIds = useMemo(() => courses.map((course) => course.id), [courses]);
  const everyCourseFolded = visibleCourseIds.every((id) => collapsedCourseIds.includes(id));
  const everyCourseUnfolded = visibleCourseIds.every((id) => !collapsedCourseIds.includes(id));

  // Sidebar navigation can request this before ViewFade mounts the outline.
  // Consume the request only once its card exists, so neither the unfold nor
  // the scroll is lost during the sequential view transition.
  useLayoutEffect(() => {
    if (!revealCourseId) return;
    const card = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("section[data-course-id]") ?? []),
    ].find((candidate) => candidate.dataset.courseId === revealCourseId);
    if (!card) return;
    card.scrollIntoView({ block: "nearest" });
    useWorkspace.getState().revealCourse(null);
  }, [revealCourseId, sortedCourses]);
  // Only the name offers the modifiers, so they are advertised on the name.
  const labelHints = useMemo(
    () =>
      selectedCourseIds.length > 0 ? courseLabelSelectedHints(keyboardMode) : COURSE_LABEL_HINTS,
    [keyboardMode, selectedCourseIds.length],
  );
  useViewHints(OUTLINE_HINTS);

  const selectSingleCourse = useCallback(
    (course: Course) => {
      selection.set([course.id]);
      onSelectCourse(course, true);
    },
    [onSelectCourse, selection],
  );

  /**
   * Commit a multi-selection and hand its primary to the inspector.
   *
   * The last course added is the one being described; an emptied selection
   * describes nothing, which is what the `false` says.
   */
  const commitSelection = useCallback(
    (next: readonly string[], fallback: Course) => {
      selection.set(next);
      const primaryId = next.at(-1);
      const primary = courses.find((candidate) => candidate.id === primaryId);
      if (primary) onSelectCourse(primary, true);
      else onSelectCourse(fallback, false);
    },
    [courses, onSelectCourse, selection],
  );

  /**
   * A click on a course's name, and nothing else.
   *
   * Folding is the header's job now, so this only ever moves the selection: it
   * cannot open or close a card, and a card's fold state cannot be read off
   * what the inspector is showing.
   */
  const selectCourse = useCallback(
    (course: Course, event: React.MouseEvent<HTMLButtonElement>) => {
      const current = selection.getSnapshot();
      // Shift only extends an existing selection. With no prior selection it
      // is the same as an ordinary click, so it cannot create a new multi-
      // selection out of nowhere.
      const extend = event.shiftKey && current.length > 0;
      const subtract = event.ctrlKey || event.metaKey;
      const selected = current.includes(course.id);

      if (subtract) {
        if (!selected) return;
        commitSelection(
          current.filter((id) => id !== course.id),
          course,
        );
      } else if (extend) {
        commitSelection(
          selected ? current.filter((id) => id !== course.id) : [...current, course.id],
          course,
        );
      } else if (selected && current.length === 1) {
        selection.set([]);
        onSelectCourse(course, false);
      } else {
        selectSingleCourse(course);
      }
    },
    [commitSelection, onSelectCourse, selectSingleCourse, selection],
  );

  // Keep a course selected when it was revealed by the sidebar or command
  // palette before this view mounted. Topic and exam clicks clear this local
  // course selection through the wrappers below, just as a timeline gutter
  // selection clears the chart's block selection.
  useEffect(() => {
    if (!selectedId || !courses.some((course) => course.id === selectedId)) return;
    if (!selection.getSnapshot().includes(selectedId)) selection.set([selectedId]);
  }, [courses, selectedId, selection]);

  useEffect(() => {
    if (workspaceSelection?.kind === "course") return;
    if (selection.getSnapshot().length > 0) selection.set([]);
  }, [selection, workspaceSelection]);

  useEffect(() => {
    const visible = new Set(courses.map((course) => course.id));
    const current = selection.getSnapshot();
    const next = current.filter((id) => visible.has(id));
    if (next.length !== current.length) selection.set(next);
  }, [courses, selection]);

  const selectTopic = useCallback(
    (course: Course, topic: Topic) => {
      if (selectedId === topic.id) {
        // A second click on a selected topic moves the primary selection up to
        // its course instead of leaving the workspace with nothing selected.
        selectSingleCourse(course);
        return;
      }
      selection.set([]);
      onSelectTopic(course, topic);
    },
    [onSelectTopic, selectSingleCourse, selectedId, selection],
  );
  const selectExam = useCallback(
    (course: Course, exam: Exam) => {
      selection.set([]);
      onSelectExam(course, exam);
    },
    [onSelectExam, selection],
  );
  // Courses filtered out by the sidebar or the search field stay mounted for
  // the duration of a simple opacity fade, rather than vanishing in a commit.
  const cards = useListPresence(sortedCourses, courseKey);

  return (
    <div className="flex h-full flex-col">
      {/* The view's own chrome, above its scroll and outside its hint scope,
          exactly as the timeline's zoom control sits above the chart. An
          outline with nothing in it has no order to choose, so the bar is not
          there to be chosen from. */}
      {courses.length > 0 ? (
        <div className="flex flex-none items-center gap-2 border-b border-separator px-4 py-2">
          <SegmentedControl<CourseSort>
            size="sm"
            label="Sort courses by"
            value={courseSort}
            onValueChange={(next) => {
              captureOrder();
              setCourseSort(next);
            }}
            segments={COURSE_SORTS.map((sort) => ({
              value: sort,
              label: COURSE_SORT_LABELS[sort],
            }))}
          />
          <span className="flex items-center gap-0.5">
            <IconButton
              size="sm"
              label="Fold all courses"
              icon={<ChevronsUp />}
              disabled={everyCourseFolded}
              onClick={() => foldCourses(visibleCourseIds)}
            />
            <IconButton
              size="sm"
              label="Unfold all courses"
              icon={<ChevronsDown />}
              disabled={everyCourseUnfolded}
              onClick={() => unfoldCourses(visibleCourseIds)}
            />
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto" {...hintScope}>
        {/* `min-h-full`, so the space below the last card is still the view and a
            click there clears the selection. */}
        <div ref={listRef} className="mx-auto flex min-h-full max-w-4xl flex-col gap-2 p-5">
          {cards.map(({ key, item, present, appear }) => (
            <Collapse key={key} present={present} appear={appear}>
              <CourseCard
                course={item}
                health={health.get(item.id)}
                today={today}
                query={query}
                snapshot={snapshot}
                selectedId={selectedId}
                courseSelection={selection.stateOf(item.id)}
                labelHints={labelHints}
                onSelectTopic={(topic) => selectTopic(item, topic)}
                onSelectExam={(exam) => selectExam(item, exam)}
                onDeleteExam={(exam) => onDeleteExam(item, exam)}
                onSelectCourse={(event) => selectCourse(item, event)}
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
    </div>
  );
}
