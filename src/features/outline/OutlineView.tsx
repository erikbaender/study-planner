"use client";

import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { usePlannerErrors, usePlannerSnapshot, useRepository } from "@/data/use-repository";
import {
  UNITS,
  UNIT_LABELS,
  assessCourse,
  formatOutline,
  parseOutline,
  topicProgress,
  type Course,
  type Plan,
  type Topic,
  type Unit,
} from "@/domain";
import {
  Badge,
  Button,
  Card,
  ContextMenu,
  EmptyState,
  IconButton,
  ProgressBar,
  ProgressSlider,
  SelectField,
  TextArea,
  TextField,
  ToolbarSpacer,
} from "@/ui";
import type { WorkspaceSelection } from "@/features/shell/workspace-store";

export function OutlineView({
  plan,
  course,
  selection,
  today,
  onCreate,
  onSelectTopic,
}: {
  plan: Plan;
  course: Course | null;
  selection: WorkspaceSelection;
  today: string;
  onCreate: () => void;
  onSelectTopic: (topicId: string, courseId: string) => void;
}) {
  if (!course) {
    return (
      <EmptyState
        title={`No courses in ${plan.name}`}
        description="Add a course to give this semester a subject, exam, and set of topics."
        action={
          <Button variant="accent" leadingIcon={<Plus />} onClick={onCreate}>
            Add course
          </Button>
        }
        className="h-full"
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <CourseSummary course={course} today={today} />
      <ExamSection course={course} today={today} />
      <TopicSection
        course={course}
        today={today}
        selection={selection}
        onSelectTopic={onSelectTopic}
      />
    </div>
  );
}

function CourseSummary({ course, today }: { course: Course; today: string }) {
  const snapshot = usePlannerSnapshot();
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

  return (
    <header className="flex flex-wrap items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-1 size-3 shrink-0 rounded-full"
        style={{ background: course.color }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-callout text-secondary">Course outline</p>
        <h2 className="text-title1 font-semibold">{course.name}</h2>
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

function ExamSection({ course, today }: { course: Course; today: string }) {
  const repository = useRepository();
  const { run } = usePlannerErrors();

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-title3 font-semibold">Exams</h3>

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

function TopicSection({
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
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-title3 font-semibold">Topics</h3>
        <span className="text-callout text-secondary">{course.topics.length} total</span>
      </div>

      {course.topics.length ? (
        <ul className="flex flex-col" aria-label={`${course.name} topics`}>
          {course.topics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              today={today}
              selected={selection?.kind === "topic" && selection.id === topic.id}
              onSelect={() => onSelectTopic(topic.id, course.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-body text-secondary">
          No topics yet. Paste a lecture outline below to add them in bulk.
        </p>
      )}

      <BoundOutlineForm course={course} />
    </Card>
  );
}

function TopicRow({
  topic,
  today,
  selected,
  onSelect,
}: {
  topic: Topic;
  today: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const progress = topicProgress(topic);
  const unit = UNIT_LABELS[topic.unit].plural;

  return (
    <li
      data-topic-row
      className={`group flex min-h-7 items-center gap-3 rounded-control px-2 py-1 ${
        selected ? "bg-accent-soft" : "hover:bg-fill"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="min-w-0 flex-1 truncate text-left text-body"
      >
        {topic.section ? <span className="text-tertiary">{topic.section} · </span> : null}
        {topic.name}
      </button>

      {topic.totalUnits > 0 ? (
        <>
          <ProgressSlider
            value={topic.completedUnits}
            max={topic.totalUnits}
            label={`${topic.name} progress`}
            valueText={(value) => `${value} of ${topic.totalUnits} ${unit}`}
            tint={topic.color || undefined}
            className="w-48 shrink-0"
            onCommit={(units) =>
              run(
                repository.logStudy({
                  topicId: topic.id,
                  date: today,
                  units: units - topic.completedUnits,
                }),
              )
            }
          />
          <span className="w-32 shrink-0 text-right text-callout tabular-nums whitespace-nowrap text-secondary">
            {topic.completedUnits} / {topic.totalUnits} {unit}
          </span>
        </>
      ) : (
        <>
          <ProgressBar
            ratio={progress.ratio}
            label={`${topic.name} progress`}
            size="sm"
            className="w-48 shrink-0"
          />
          <span className="w-32 shrink-0 text-right text-callout whitespace-nowrap text-tertiary">
            No size set
          </span>
        </>
      )}

      <ContextMenu
        items={[
          {
            label: `Delete ${topic.name}`,
            icon: <Trash2 />,
            danger: true,
            onSelect: () => run(repository.deleteTopic(topic.id)),
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
    </li>
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
    <OutlineForm
      course={course}
      onSubmit={(topics) => run(repository.createTopics(course.id, topics, course.color))}
    />
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
      className="flex flex-col gap-2 border-t border-separator pt-3"
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
        label="Add topics"
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
