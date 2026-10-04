"use client";

import { useState } from "react";
import { useRepository } from "@/data/use-repository";
import type { PlannerRepository } from "@/data/repository";
import { isValidIsoDate, UNIT_LABELS, type StudyLogEntry, type Topic } from "@/domain";
import { plannerError } from "@/domain/errors";
import { Button, Sheet, TextArea, TextField } from "@/ui";

/** Mounted for one editing session so remote updates cannot erase the form. */
export function StudySessionSheet({ topic, today, entry, onClose }: {
  topic: Topic; today: string; entry?: StudyLogEntry; onClose: () => void;
}) {
  const repository = useRepository();
  const [baseRepository] = useState<PlannerRepository>(() => repository);
  const [date, setDate] = useState(entry?.date ?? today);
  const [units, setUnits] = useState(String(entry?.units ?? 0));
  const [minutes, setMinutes] = useState(entry?.minutes === undefined ? "" : String(entry.minutes));
  const [note, setNote] = useState(entry?.note ?? "");
  const [failure, setFailure] = useState<ReturnType<typeof plannerError> | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = isValidIsoDate(date) && units.trim() !== "" && Number.isFinite(Number(units)) && Math.abs(Number(units)) <= 1e9
    && (minutes === "" || Number.isFinite(Number(minutes)) && Number(minutes) >= 0 && Number(minutes) <= 10080) && note.length <= 2000;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const target = failure && reviewed ? repository : baseRepository;
    const input = { date, units: Number(units), minutes: minutes === "" ? undefined : Number(minutes), note: note || undefined };
    try {
      if (entry) {
        if (!target.updateStudyLog) throw new Error("Session editing is unavailable.");
        await target.updateStudyLog(entry.id, input);
      } else await target.logStudy({ topicId: topic.id, ...input });
      onClose();
    } catch (cause) { setFailure(plannerError(cause)); setReviewed(false); }
    finally { setBusy(false); }
  };
  return <Sheet open onOpenChange={open => { if (!open && !busy) onClose(); }} title={entry ? "Edit study session" : "Log study session"}
    description={`${topic.name}. Progress changes are bounded to the topic’s remaining or completed work.`}
    footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="accent" disabled={!valid || busy || Boolean(failure?.code === "REVISION_CONFLICT" && !reviewed)} onClick={() => { void save(); }}>{busy ? "Saving…" : failure ? "Retry save" : "Save session"}</Button></>}>
    <div className="flex flex-col gap-4">
      <TextField label="Study date" type="date" value={date} onChange={event => setDate(event.target.value)} />
      <TextField label={entry ? `Session ${UNIT_LABELS[topic.unit].plural}` : `${UNIT_LABELS[topic.unit].plural} studied`} type="number" step="any" value={units} onChange={event => setUnits(event.target.value)} hint="Use negative units to correct previously recorded progress. Only the effective change is recorded." />
      <TextField label="Minutes studied" type="number" min={0} max={10080} value={minutes} onChange={event => setMinutes(event.target.value)} hint="Optional actual duration, separate from the planning estimate." />
      <TextArea label="Session note" value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
      {failure ? <div role="alert" className="flex flex-col gap-2 text-body">
        <p>{failure.message} Your session draft is retained.</p>
        {failure.code === "REVISION_CONFLICT" ? <><p>Current topic progress: {topic.completedUnits} / {topic.totalUnits} {UNIT_LABELS[topic.unit].plural}.</p><Button onClick={() => setReviewed(true)}>Review latest progress</Button>{reviewed ? <p>Retry will apply this session to the latest progress.</p> : null}</> : null}
      </div> : null}
    </div>
  </Sheet>;
}
