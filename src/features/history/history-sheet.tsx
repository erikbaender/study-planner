"use client";

import { useEffect, useState } from "react";
import { useRepository, usePlannerRun } from "@/data/use-repository";
import type { PlannerChange } from "@/data/repository";
import type { Plan } from "@/domain";
import { plannerError } from "@/domain/errors";
import { Button, Sheet } from "@/ui";

export function HistorySheet({ open, onOpenChange, plan }: {
  open: boolean; onOpenChange: (open: boolean) => void; plan: Plan;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const [changes, setChanges] = useState<PlannerChange[] | Error | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    return repository.subscribeHistory?.(plan.id, setChanges);
  }, [open, plan.id, repository]);
  return <Sheet open={open} onOpenChange={onOpenChange} title="Recent changes" footer={<Button onClick={() => onOpenChange(false)}>Close</Button>}
    description={`Changes to ${plan.name}. Only the latest eligible change can be undone, for up to 30 days.`}>
    {changes instanceof Error ? <p role="alert">{plannerError(changes).message}</p>
      : changes === null ? <p role="status">Loading changes…</p>
      : changes.length === 0 ? <p>No changes recorded yet.</p>
      : <ul aria-label="Recent changes" className="flex flex-col divide-y divide-separator">
        {changes.map(change => <li key={change.id} className="flex flex-col gap-2 py-3">
          <p className="text-body font-medium">{change.summary}</p>
          <p className="text-callout text-secondary">{change.actor} · {new Date(change.createdAt).toLocaleString()} · {plan.name}</p>
          {change.canUndo ? <Button size="sm" className="self-start" disabled={busy} onClick={async () => {
            if (!repository.undoChange) return;
            setBusy(true);
            try { await run(repository.undoChange(plan.id, change.id)); } finally { setBusy(false); }
          }}>Undo</Button> : <p className="text-callout text-tertiary">{change.undoReason}</p>}
        </li>)}
      </ul>}
  </Sheet>;
}
