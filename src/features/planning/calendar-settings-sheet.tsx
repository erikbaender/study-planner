"use client";

import { useState } from "react";
import { isValidIsoDate, type Preferences, type Weekday } from "@/domain";
import { Button, Checkbox, Sheet, TextField } from "@/ui";

const WEEKDAYS: { day: Weekday; label: string }[] = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function validTimezone(timezone: string) {
  if (!timezone || timezone !== timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function CalendarSettingsSheet({
  open,
  onOpenChange,
  preferences,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: Preferences;
  onSave: (preferences: Preferences) => void;
}) {
  const [weekdays, setWeekdays] = useState<Weekday[]>(preferences.studyDaysOfWeek);
  const [blackoutDates, setBlackoutDates] = useState<string[]>(preferences.blackoutDates);
  const [timezone, setTimezone] = useState(preferences.timezone ?? "");
  const [dateDraft, setDateDraft] = useState("");

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setWeekdays(preferences.studyDaysOfWeek);
      setBlackoutDates(preferences.blackoutDates);
      setTimezone(preferences.timezone ?? browserTimezone());
      setDateDraft("");
    }
  }

  const hasValidTimezone = validTimezone(timezone);
  const validDateDraft = isValidIsoDate(dateDraft) && !blackoutDates.includes(dateDraft);
  const weekdayNames = WEEKDAYS
    .filter(({ day }) => weekdays.includes(day))
    .map(({ label }) => label.slice(0, 3))
    .join(", ");

  const toggleWeekday = (day: Weekday, checked: boolean) => {
    setWeekdays((current) => {
      if (checked) return [...current, day];
      return current.filter((candidate) => candidate !== day);
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Calendar settings"
      description="These scheduling settings apply across all semesters in this account."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="accent"
            disabled={!hasValidTimezone}
            onClick={() => onSave({
              ...preferences,
              studyDaysOfWeek: WEEKDAYS
                .filter(({ day }) => weekdays.includes(day))
                .map(({ day }) => day),
              blackoutDates: [...blackoutDates].sort(),
              timezone,
            })}
          >
            Save settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-callout font-semibold">Study weekdays</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {WEEKDAYS.map(({ day, label }) => (
              <Checkbox
                key={day}
                checked={weekdays.includes(day)}
                onCheckedChange={(checked) => toggleWeekday(day, checked)}
                label={label}
              />
            ))}
          </div>
          <p className="text-footnote text-secondary">
            {weekdayNames ? `Study days: ${weekdayNames}.` : "No study weekdays selected."}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-callout font-semibold">Blackout dates</h3>
          <div className="flex items-end gap-2">
            <TextField
              label="Add a day off"
              type="date"
              value={dateDraft}
              onChange={(event) => setDateDraft(event.target.value)}
              fieldClassName="min-w-0 flex-1"
            />
            <Button
              disabled={!validDateDraft || blackoutDates.length >= 2_000}
              onClick={() => {
                if (!validDateDraft) return;
                setBlackoutDates((current) => [...current, dateDraft].sort());
                setDateDraft("");
              }}
            >
              Add date
            </Button>
          </div>
          {blackoutDates.length > 0 ? (
            <ul className="flex max-h-36 flex-col gap-1 overflow-y-auto">
              {blackoutDates.map((date) => (
                <li key={date} className="flex items-center justify-between rounded-control bg-fill px-2 py-1">
                  <time dateTime={date} className="text-body tabular-nums">{date}</time>
                  <Button
                    size="sm"
                    variant="plain"
                    aria-label={`Remove blackout date ${date}`}
                    onClick={() => setBlackoutDates((current) => current.filter((item) => item !== date))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-footnote text-secondary">No blackout dates.</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-callout font-semibold">Timezone</h3>
          <TextField
            label="IANA timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Europe/Berlin"
            hint="Used by account integrations. Example: Europe/Berlin."
            error={timezone && !hasValidTimezone ? "Enter a valid IANA timezone." : undefined}
          />
        </section>
      </div>
    </Sheet>
  );
}
