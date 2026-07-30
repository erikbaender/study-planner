"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { usePlannerErrors, usePlannerSnapshot, useRepository } from "@/data/use-repository";
import {
  TOPIC_STATUSES,
  UNITS,
  UNIT_LABELS,
  assessCourse,
  daysUntil,
  formatOutline,
  nextExam,
  parseOutline,
  topicProgress,
  type Course,
  type Plan,
  type Topic,
  type TopicStatus,
  type Unit,
} from "@/domain";
import type { TopicPatch } from "@/data/repository";
import type { WorkspaceSelection } from "@/features/shell/workspace-store";
import {
  Badge,
  Button,
  Card,
  ContextMenu,
  IconButton,
  ProgressBar,
  ProgressSlider,
  SelectField,
  TextArea,
  TextField,
  ToolbarSpacer,
} from "@/ui";

type NewTopicPosition = {
  afterId: string | null;
  section?: string;
};

export function OutlineView({
  plan,
  course,
  selection,
  today,
  onCreateCourse,
  onSelectCourse,
  onSelectTopic,
}: {
  plan: Plan;
  course: Course | null;
  selection: WorkspaceSelection;
  today: string;
  onCreateCourse: (name: string) => void;
  onSelectCourse: (courseId: string) => void;
  onSelectTopic: (topicId: string, courseId: string) => void;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4 p-6">
      <CourseStrip
        plan={plan}
        selectedCourseId={course?.id ?? null}
        onSelect={onSelectCourse}
        onCreate={onCreateCourse}
        onReorder={(courseIds) => run(repository.reorderCourses(plan.id, courseIds))}
      />

      {course ? (
        <>
          <CourseSummary key={`${course.id}:${course.name}`} course={course} today={today} />
          <TopicTable
            course={course}
            today={today}
            selection={selection}
            onSelectTopic={onSelectTopic}
          />
          <ExamSection course={course} today={today} />
          <BoundOutlineForm course={course} />
        </>
      ) : (
        <Card className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <div>
            <h2 className="text-title2 font-semibold">Add the first course</h2>
            <p className="mt-1 max-w-md text-body text-secondary">
              Courses are the top level of the outline. Each one holds optional sections, topics,
              and exams.
            </p>
          </div>
          <InlineCourseForm onSubmit={onCreateCourse} buttonLabel="Add course" />
        </Card>
      )}
    </div>
  );
}

function CourseStrip({
  plan,
  selectedCourseId,
  onSelect,
  onCreate,
  onReorder,
}: {
  plan: Plan;
  selectedCourseId: string | null;
  onSelect: (courseId: string) => void;
  onCreate: (name: string) => void;
  onReorder: (courseIds: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const ids = plan.courses.map((course) => course.id);

  const moveCourse = (courseId: string, offset: -1 | 1) => {
    const index = ids.indexOf(courseId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const reordered = [...ids];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onReorder(reordered);
  };

  const dropCourse = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    onReorder(moveBefore(ids, draggedId, targetId));
    setDraggedId(null);
  };

  return (
    <Card className="flex flex-wrap items-center gap-2 py-2">
      <span className="mr-1 text-caption font-semibold tracking-wide text-tertiary uppercase">
        Courses
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="list">
        {plan.courses.map((candidate, index) => (
          <div
            key={candidate.id}
            role="listitem"
            className="group flex items-center rounded-control bg-fill"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropCourse(candidate.id)}
          >
            <IconButton
              draggable
              tabIndex={-1}
              size="sm"
              label={`Drag ${candidate.name}`}
              icon={<GripVertical />}
              className="cursor-grab text-tertiary active:cursor-grabbing"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", candidate.id);
                setDraggedId(candidate.id);
              }}
              onDragEnd={() => setDraggedId(null)}
            />
            <ContextMenu
              items={[
                {
                  label: `Move ${candidate.name} left`,
                  icon: <ArrowLeft />,
                  disabled: index === 0,
                  onSelect: () => moveCourse(candidate.id, -1),
                },
                {
                  label: `Move ${candidate.name} right`,
                  icon: <ArrowRight />,
                  disabled: index === plan.courses.length - 1,
                  onSelect: () => moveCourse(candidate.id, 1),
                },
              ]}
            >
              <button
                type="button"
                aria-current={candidate.id === selectedCourseId ? "page" : undefined}
                onClick={() => onSelect(candidate.id)}
                className={`flex h-control items-center gap-1.5 rounded-control px-2.5 text-callout font-medium ${
                  candidate.id === selectedCourseId
                    ? "bg-accent text-on-accent"
                    : "hover:bg-fill-strong"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: candidate.color }}
                />
                {candidate.name}
              </button>
            </ContextMenu>
          </div>
        ))}
      </div>

      {adding ? (
        <InlineCourseForm
          onSubmit={(name) => {
            onCreate(name);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="sm" variant="plain" leadingIcon={<Plus />} onClick={() => setAdding(true)}>
          Add course
        </Button>
      )}
    </Card>
  );
}

function InlineCourseForm({
  onSubmit,
  onCancel,
  buttonLabel = "Add",
}: {
  onSubmit: (name: string) => void;
  onCancel?: () => void;
  buttonLabel?: string;
}) {
  const [name, setName] = useState("");

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setName("");
      }}
    >
      <TextField
        autoFocus
        hideLabel
        label="Course name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel?.();
        }}
        className="w-48"
      />
      <Button size="sm" type="submit" variant="accent" disabled={!name.trim()}>
        {buttonLabel}
      </Button>
      {onCancel ? (
        <Button size="sm" variant="plain" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </form>
  );
}

function CourseSummary({ course, today }: { course: Course; today: string }) {
  const repository = useRepository();
  const snapshot = usePlannerSnapshot();
  const { run } = usePlannerErrors();
  const [name, setName] = useState(course.name);
  const health = useMemo(
    () =>
      assessCourse({
        course,
        today,
        calendar: snapshot.preferences,
        log: snapshot.studyLog,
        dailyCapacityUnits: snapshot.preferences.dailyCapacityUnits,
      }),
    [course, snapshot.preferences, snapshot.studyLog, today],
  );

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(course.name);
      return;
    }
    if (trimmed === course.name) return;
    run(
      repository.updateCourse(course.id, {
        name: trimmed,
        code: course.code,
        notes: course.notes,
        color: course.color,
      }),
    );
  };

  return (
    <header className="flex flex-wrap items-start gap-3 px-1">
      <span
        aria-hidden="true"
        className="mt-2 size-3 shrink-0 rounded-full"
        style={{ background: course.color }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-callout text-secondary">Course outline</p>
        <input
          aria-label="Course name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(course.name);
              event.currentTarget.blur();
            }
          }}
          className="-ml-1 w-full rounded-control bg-transparent px-1 text-title1 font-semibold hover:bg-fill focus:bg-content focus:shadow-focus focus:outline-none"
        />
        <p className="mt-1 text-body text-secondary">
          {health.progress.totalUnits > 0
            ? `${health.progress.completedUnits} of ${health.progress.totalUnits} measured units complete`
            : "Topic sizes have not been recorded yet"}
        </p>
      </div>
      {health.pace ? (
        <Badge tone={health.pace.onTrack ? "green" : "red"}>
          {health.pace.onTrack
            ? "On track"
            : health.pace.daysLate > 0
              ? `${health.pace.daysLate} days late`
              : "Behind pace"}
        </Badge>
      ) : (
        <Badge>No upcoming exam</Badge>
      )}
    </header>
  );
}

function TopicTable({
  course,
  today,
  selection,
  onSelectTopic,
}: {
  course: Course;
  today: string;
  selection: WorkspaceSelection;
  onSelectTopic: (topicId: string, courseId: string) => void;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const [newTopic, setNewTopic] = useState<NewTopicPosition | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const exam = nextExam(course, today);
  const topicIds = course.topics.map((topic) => topic.id);
  const sectionCounts = useMemo(() => {
    const counts = new Map<string | undefined, number>();
    for (const topic of course.topics) {
      counts.set(topic.section, (counts.get(topic.section) ?? 0) + 1);
    }
    return counts;
  }, [course.topics]);

  const reorder = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const source = course.topics.find((topic) => topic.id === sourceId);
    const target = course.topics.find((topic) => topic.id === targetId);
    if (!source || !target) return;
    const reordered = moveBefore(topicIds, sourceId, targetId);
    const action =
      source.section === target.section
        ? repository.reorderTopics(course.id, reordered)
        : repository
            .updateTopic(source.id, { section: target.section ?? null })
            .then(() => repository.reorderTopics(course.id, reordered));
    run(action);
    setDraggedId(null);
  };

  const moveBy = (topicId: string, offset: -1 | 1) => {
    const index = topicIds.indexOf(topicId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= topicIds.length) return;
    const reordered = [...topicIds];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    run(repository.reorderTopics(course.id, reordered));
  };

  const createTopic = (
    input: { name: string; section?: string; unit: Unit; totalUnits: number },
    afterId: string | null,
  ) => {
    const action = repository
      .createTopic(course.id, { ...input, color: course.color })
      .then(async (topicId) => {
        if (afterId) {
          const withoutNew = course.topics.map((topic) => topic.id);
          const insertAt = withoutNew.indexOf(afterId) + 1;
          withoutNew.splice(insertAt, 0, topicId);
          await repository.reorderTopics(course.id, withoutNew);
        }
        onSelectTopic(topicId, course.id);
      });
    run(action);
    setNewTopic(null);
  };

  const renameSection = (section: string | undefined, nextSection: string | undefined) => {
    const members = course.topics.filter((topic) => topic.section === section);
    if (members.length === 0 || section === nextSection) return;
    run(
      Promise.all(
        members.map((topic) =>
          repository.updateTopic(topic.id, { section: nextSection ?? null }),
        ),
      ),
    );
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-separator px-4 py-3">
        <div>
          <h2 className="text-title3 font-semibold">Topics</h2>
          <p className="text-callout text-secondary">
            {course.topics.length} total · edit cells directly · Tab moves across the row
          </p>
        </div>
        <ToolbarSpacer />
        <Button
          size="sm"
          variant="accent"
          leadingIcon={<Plus />}
          onClick={() =>
            setNewTopic({
              afterId: course.topics.at(-1)?.id ?? null,
              section: course.topics.at(-1)?.section,
            })
          }
        >
          Add topic
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[68rem] table-fixed border-collapse text-body">
          <caption className="sr-only">
            Editable outline for {course.name}. Press Command or Control plus Enter in a topic
            row to insert another topic after it.
          </caption>
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[5%]" />
          </colgroup>
          <thead>
            <tr className="h-8 border-b border-separator bg-fill text-left text-caption font-semibold tracking-wide text-tertiary uppercase">
              <th scope="col" className="px-3">
                Name
              </th>
              <th scope="col" className="px-2">
                Unit
              </th>
              <th scope="col" className="px-2 text-right">
                Total
              </th>
              <th scope="col" className="px-2 text-right">
                Done
              </th>
              <th scope="col" className="px-2">
                Progress
              </th>
              <th scope="col" className="px-2">
                Status
              </th>
              <th scope="col" className="px-2">
                Exam
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {course.topics.map((topic, index) => {
              const startsSection =
                index === 0 || topic.section !== course.topics[index - 1]?.section;

              return (
                <Fragment key={topic.id}>
                  {startsSection ? (
                    <SectionRow
                      key={`section-${topic.id}-${topic.section ?? "ungrouped"}`}
                      section={topic.section}
                      count={sectionCounts.get(topic.section) ?? 0}
                      onRename={(next) => renameSection(topic.section, next)}
                    />
                  ) : null}
                  <EditableTopicRow
                    key={[
                      topic.id,
                      topic.name,
                      topic.unit,
                      topic.totalUnits,
                      topic.completedUnits,
                      topic.status,
                    ].join(":")}
                    topic={topic}
                    today={today}
                    exam={exam}
                    selected={selection?.kind === "topic" && selection.id === topic.id}
                    first={index === 0}
                    last={index === course.topics.length - 1}
                    onSelect={() => onSelectTopic(topic.id, course.id)}
                    onUpdate={(patch) => run(repository.updateTopic(topic.id, patch))}
                    onLog={(units) =>
                      run(repository.logStudy({ topicId: topic.id, date: today, units }))
                    }
                    onDelete={() => run(repository.deleteTopic(topic.id))}
                    onMoveUp={() => moveBy(topic.id, -1)}
                    onMoveDown={() => moveBy(topic.id, 1)}
                    onInsertAfter={() =>
                      setNewTopic({ afterId: topic.id, section: topic.section })
                    }
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", topic.id);
                      setDraggedId(topic.id);
                    }}
                    onDragEnd={() => setDraggedId(null)}
                    onDrop={() => {
                      if (draggedId) reorder(draggedId, topic.id);
                    }}
                  />
                  {newTopic?.afterId === topic.id ? (
                    <NewTopicRow
                      key={`new-after-${topic.id}`}
                      section={newTopic.section}
                      defaultUnit={topic.unit}
                      onCancel={() => setNewTopic(null)}
                      onSubmit={(input) => createTopic(input, topic.id)}
                    />
                  ) : null}
                </Fragment>
              );
            })}

            {course.topics.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-secondary">
                  No topics yet. Add one inline or paste a full lecture outline below.
                </td>
              </tr>
            ) : null}

            {newTopic && newTopic.afterId === null ? (
              <NewTopicRow
                section={newTopic.section}
                defaultUnit={course.topics.at(-1)?.unit ?? "slides"}
                onCancel={() => setNewTopic(null)}
                onSubmit={(input) => createTopic(input, null)}
              />
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectionRow({
  section,
  count,
  onRename,
}: {
  section: string | undefined;
  count: number;
  onRename: (section: string | undefined) => void;
}) {
  const [name, setName] = useState(section ?? "");

  return (
    <tr className="h-8 border-y border-separator bg-content">
      <th scope="rowgroup" colSpan={8} className="px-3 text-left">
        <div className="flex items-center gap-2">
          <input
            aria-label={section ? `Section ${section}` : "Ungrouped section"}
            value={name}
            placeholder="Ungrouped"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => onRename(name.trim() || undefined)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setName(section ?? "");
                event.currentTarget.blur();
              }
            }}
            className="-ml-1 min-w-0 rounded-control bg-transparent px-1 text-callout font-semibold text-secondary hover:bg-fill focus:bg-content focus:shadow-focus focus:outline-none"
          />
          <span className="text-caption font-normal text-tertiary">
            {count} topic{count === 1 ? "" : "s"}
          </span>
        </div>
      </th>
    </tr>
  );
}

function EditableTopicRow({
  topic,
  today,
  exam,
  selected,
  first,
  last,
  onSelect,
  onUpdate,
  onLog,
  onDelete,
  onMoveUp,
  onMoveDown,
  onInsertAfter,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  topic: Topic;
  today: string;
  exam: ReturnType<typeof nextExam>;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onUpdate: (patch: TopicPatch) => void;
  onLog: (units: number) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onInsertAfter: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [name, setName] = useState(topic.name);
  const [total, setTotal] = useState(String(topic.totalUnits));
  const [done, setDone] = useState(String(topic.completedUnits));
  const progress = topicProgress(topic);

  const shortcut = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onInsertAfter();
    }
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(topic.name);
    } else if (trimmed !== topic.name) {
      onUpdate({ name: trimmed });
    }
  };

  const saveTotal = () => {
    const value = Number(total);
    if (!Number.isFinite(value) || value < topic.completedUnits) {
      setTotal(String(topic.totalUnits));
    } else if (value !== topic.totalUnits) {
      onUpdate({ totalUnits: value });
    }
  };

  const saveDone = () => {
    const value = Number(done);
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > topic.totalUnits ||
      topic.totalUnits === 0
    ) {
      setDone(String(topic.completedUnits));
    } else if (value !== topic.completedUnits) {
      onLog(value - topic.completedUnits);
    }
  };

  return (
    <tr
      data-topic-row
      data-topic-id={topic.id}
      className={`group h-9 border-b border-separator ${
        selected ? "bg-accent-soft" : "hover:bg-fill/60"
      }`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <td className="px-2">
        <div className="flex items-center gap-1">
          <IconButton
            draggable
            tabIndex={-1}
            size="sm"
            label={`Drag ${topic.name}`}
            icon={<GripVertical />}
            className="cursor-grab opacity-0 text-tertiary group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <input
            aria-label={`${topic.name} name`}
            value={name}
            onFocus={onSelect}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={shortcut}
            className={cellControl("w-full px-1.5")}
          />
        </div>
      </td>
      <td className="px-2">
        <select
          aria-label={`${topic.name} unit`}
          value={topic.unit}
          onFocus={onSelect}
          onChange={(event) => onUpdate({ unit: event.target.value as Unit })}
          onKeyDown={shortcut}
          className={cellControl("w-full px-1")}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_LABELS[unit].plural}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2">
        <input
          aria-label={`${topic.name} total`}
          type="number"
          min={topic.completedUnits}
          step="any"
          value={total}
          onFocus={onSelect}
          onChange={(event) => setTotal(event.target.value)}
          onBlur={saveTotal}
          onKeyDown={shortcut}
          className={cellControl("w-full px-1.5 text-right tabular-nums")}
        />
      </td>
      <td className="px-2">
        <input
          aria-label={`${topic.name} done`}
          type="number"
          min={0}
          max={topic.totalUnits || undefined}
          step="any"
          disabled={topic.totalUnits === 0}
          value={topic.totalUnits === 0 ? "" : done}
          placeholder="—"
          onFocus={onSelect}
          onChange={(event) => setDone(event.target.value)}
          onBlur={saveDone}
          onKeyDown={shortcut}
          className={cellControl("w-full px-1.5 text-right tabular-nums")}
        />
      </td>
      <td className="px-2">
        {topic.totalUnits > 0 ? (
          <ProgressSlider
            value={topic.completedUnits}
            max={topic.totalUnits}
            label={`${topic.name} progress`}
            valueText={(value) =>
              `${value} of ${topic.totalUnits} ${UNIT_LABELS[topic.unit].plural}`
            }
            tint={topic.color || undefined}
            onCommit={(value) => onLog(value - topic.completedUnits)}
          />
        ) : (
          <ProgressBar
            ratio={progress.ratio}
            label={`${topic.name} progress`}
            size="sm"
          />
        )}
      </td>
      <td className="px-2">
        <select
          aria-label={`${topic.name} status`}
          value={topic.status}
          onFocus={onSelect}
          onChange={(event) => onUpdate({ status: event.target.value as TopicStatus })}
          onKeyDown={shortcut}
          className={cellControl("w-full px-1")}
        >
          {TOPIC_STATUSES.map((status) => (
            <option key={status} value={status}>
              {sentenceCase(status)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 text-callout text-secondary">
        {exam ? (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="tabular-nums">{exam.startDate}</span>
            {exam.status === "provisional" ? (
              <Badge tone="orange" variant="outline">
                Window
              </Badge>
            ) : null}
          </span>
        ) : (
          <span className="text-tertiary">Not set</span>
        )}
        <span className="sr-only">
          {exam
            ? `, ${daysUntil(today, exam.startDate)} days away${
                exam.status === "provisional" ? ", provisional" : ""
              }`
            : ""}
        </span>
      </td>
      <td className="px-1">
        <ContextMenu
          items={[
            {
              label: `Move ${topic.name} up`,
              icon: <ArrowUp />,
              disabled: first,
              onSelect: onMoveUp,
            },
            {
              label: `Move ${topic.name} down`,
              icon: <ArrowDown />,
              disabled: last,
              onSelect: onMoveDown,
            },
            {
              label: `Delete ${topic.name}`,
              icon: <Trash2 />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          <IconButton
            size="sm"
            label={`Actions for ${topic.name}`}
            icon={<MoreHorizontal />}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </ContextMenu>
      </td>
    </tr>
  );
}

function NewTopicRow({
  section,
  defaultUnit,
  onCancel,
  onSubmit,
}: {
  section?: string;
  defaultUnit: Unit;
  onCancel: () => void;
  onSubmit: (input: { name: string; section?: string; unit: Unit; totalUnits: number }) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState(defaultUnit);
  const [total, setTotal] = useState("0");
  useEffect(() => nameRef.current?.focus(), []);

  const submit = () => {
    const trimmed = name.trim();
    const amount = Number(total);
    if (!trimmed || !Number.isFinite(amount) || amount < 0) return;
    onSubmit({ name: trimmed, section, unit, totalUnits: amount });
  };

  return (
    <tr className="h-10 border-b border-separator bg-accent-soft">
      <td className="px-2">
        <div className="flex items-center gap-1">
          <span aria-hidden="true" className="w-control shrink-0" />
          <input
            ref={nameRef}
            aria-label="New topic name"
            placeholder="Topic name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
              if (event.key === "Enter" && !(event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            className={cellControl("w-full px-1.5")}
          />
        </div>
      </td>
      <td className="px-2">
        <select
          aria-label="New topic unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value as Unit)}
          className={cellControl("w-full px-1")}
        >
          {UNITS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {UNIT_LABELS[candidate].plural}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2">
        <input
          aria-label="New topic total"
          type="number"
          min={0}
          step="any"
          value={total}
          onChange={(event) => setTotal(event.target.value)}
          className={cellControl("w-full px-1.5 text-right tabular-nums")}
        />
      </td>
      <td colSpan={4} className="px-2 text-callout text-secondary">
        {section ? `In ${section}` : "Ungrouped"} · Enter to add, Escape to cancel
      </td>
      <td className="px-1">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="plain" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="accent" disabled={!name.trim()} onClick={submit}>
            Add
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ExamSection({ course, today }: { course: Course; today: string }) {
  const repository = useRepository();
  const { run } = usePlannerErrors();

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-title3 font-semibold">Exams</h2>

      {course.exams.length === 0 ? (
        <p className="text-body text-secondary">
          No exam date yet. A provisional window is fine and remains visibly provisional.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {course.exams.map((exam) => (
            <li key={exam.id} className="flex items-center gap-3 text-body">
              <span className="min-w-0 flex-1 truncate">{exam.name}</span>
              <span className="shrink-0 text-secondary tabular-nums">
                {exam.status === "provisional" && exam.endDate
                  ? `${exam.startDate} – ${exam.endDate}`
                  : exam.startDate}
              </span>
              {exam.status === "provisional" ? (
                <Badge tone="orange" variant="outline">
                  Provisional
                </Badge>
              ) : null}
              <IconButton
                size="sm"
                label={`Delete ${exam.name}`}
                icon={<Trash2 />}
                onClick={() => run(repository.deleteExam(exam.id))}
              />
            </li>
          ))}
        </ul>
      )}

      <ExamForm
        today={today}
        onSubmit={(input) => run(repository.createExam(course.id, input))}
      />
    </Card>
  );
}

function ExamForm({
  today,
  onSubmit,
}: {
  today: string;
  onSubmit: (input: { name: string; startDate: string; endDate?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-separator pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit({ name: trimmed, startDate, endDate: endDate || undefined });
        setName("");
        setEndDate("");
      }}
    >
      <TextField
        label="Exam"
        fieldClassName="min-w-40 flex-1"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label="Date"
        type="date"
        value={startDate}
        onChange={(event) => setStartDate(event.target.value)}
      />
      <TextField
        label="Window ends"
        type="date"
        hint="Optional — marks the date provisional"
        value={endDate}
        onChange={(event) => setEndDate(event.target.value)}
      />
      <Button type="submit" variant="accent">
        Add exam
      </Button>
    </form>
  );
}

function BoundOutlineForm({ course }: { course: Course }) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  return (
    <Card>
      <OutlineForm
        course={course}
        onSubmit={(topics) => run(repository.createTopics(course.id, topics, course.color))}
      />
    </Card>
  );
}

function OutlineForm({
  course,
  onSubmit,
}: {
  course: Course;
  onSubmit: (
    topics: Array<{ name: string; section?: string; unit: Unit; totalUnits: number }>,
  ) => void;
}) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<Unit>(course.topics[0]?.unit ?? "slides");
  const parsed = useMemo(() => parseOutline(text, { defaultUnit: unit }), [text, unit]);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.topics.length === 0) return;
        onSubmit(
          parsed.topics.map((topic) => ({
            name: topic.name,
            section: topic.section,
            unit: topic.unit,
            totalUnits: topic.totalUnits,
          })),
        );
        setText("");
      }}
    >
      <TextArea
        label="Bulk add topics"
        rows={4}
        placeholder={"Block 1\n  Glycolysis — 42 slides\n  Citric acid cycle — 38"}
        hint="One topic per line. Indent under a heading to group it; add “— 42 slides” to record size."
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="font-mono"
      />
      <div className="flex flex-wrap items-end gap-2">
        <SelectField
          label="Default unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value as Unit)}
        >
          {UNITS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {UNIT_LABELS[candidate].plural}
            </option>
          ))}
        </SelectField>
        <span className="pb-1.5 text-callout text-secondary">
          {parsed.topics.length} topic{parsed.topics.length === 1 ? "" : "s"}
          {parsed.issues.length > 0 ? ` · ${parsed.issues.length} to check` : ""}
        </span>
        <ToolbarSpacer />
        {course.topics.length > 0 ? (
          <Button onClick={() => setText(formatOutline(course.topics))}>
            Copy existing as outline
          </Button>
        ) : null}
        <Button type="submit" variant="accent" disabled={parsed.topics.length === 0}>
          Add topics
        </Button>
      </div>
      {parsed.issues.length > 0 ? (
        <ul className="text-footnote text-red">
          {parsed.issues.map((issue) => (
            <li key={`${issue.line}-${issue.message}`}>
              Line {issue.line}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

function cellControl(className: string) {
  return `h-control rounded-control bg-transparent text-body hover:bg-fill focus:bg-content focus:shadow-focus focus:outline-none disabled:opacity-40 ${className}`;
}

function moveBefore(ids: string[], sourceId: string, targetId: string) {
  const reordered = ids.filter((id) => id !== sourceId);
  const targetIndex = reordered.indexOf(targetId);
  reordered.splice(targetIndex < 0 ? reordered.length : targetIndex, 0, sourceId);
  return reordered;
}

function sentenceCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
