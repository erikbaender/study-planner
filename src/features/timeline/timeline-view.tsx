"use client";

/**
 * Timeline — not built yet.
 *
 * Phase 5 is the rebuild: zoom levels, virtualization on both axes, a today
 * line, exam markers with provisional windows drawn as hatched bands rather
 * than hard rules, progress as an internal fill in each bar, a 4px drag
 * threshold so a click stops being a drag, and popovers anchored to the bar.
 *
 * Standing in for it is a placeholder that says so. The alternative — shipping
 * the old Gantt behind the new chrome — would leave the app quietly worse than
 * this reads, because the old one is the component the audit found unusable
 * (unfocusable bars, 15,000px canvases, a modal on every misfired drag), and
 * dressing it in the new design system would only make it harder to tell.
 */

import { CalendarRange } from "lucide-react";
import { Button, EmptyState } from "@/ui";

export function TimelineView({ onGoToOutline }: { onGoToOutline: () => void }) {
  return (
    <EmptyState
      icon={<CalendarRange />}
      title="The timeline is being rebuilt"
      description="Zoomable, virtualized, with a today line and exam markers. Until it lands, the outline is where topics and their sizes live."
      action={
        <Button variant="accent" onClick={onGoToOutline}>
          Open the outline
        </Button>
      }
    />
  );
}
