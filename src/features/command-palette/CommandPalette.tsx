"use client";

import { clsx } from "clsx";
import { Search } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { Kbd, Separator } from "@/ui";

export type PaletteCommand = {
  id: string;
  label: string;
  detail?: string;
  category: string;
  shortcut?: string;
  keywords?: string[];
  icon?: ReactNode;
  disabled?: boolean;
  run: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  commands: readonly PaletteCommand[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      commands.filter((command) => {
        if (!normalizedQuery) return true;
        return [command.label, command.detail, command.category, ...(command.keywords ?? [])]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      }),
    [commands, normalizedQuery],
  );
  const selectedIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

  const run = (command: PaletteCommand) => {
    if (command.disabled) return;
    command.run();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={clsx(
            "fixed inset-0 z-40 bg-[var(--mac-material-scrim)]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <Dialog.Content
          className={clsx(
            "material-popover fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl",
            "-translate-x-1/2 overflow-hidden rounded-popover shadow-sheet",
            "inset-ring inset-ring-[var(--mac-separator-strong)]",
            "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
          )}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search courses, topics, views, and available actions.
          </Dialog.Description>

          <label className="flex h-12 items-center gap-2 px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-tertiary" />
            <span className="sr-only">Search commands</span>
            <input
              autoFocus
              role="combobox"
              aria-label="Search commands"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={
                filtered[selectedIndex] ? `command-${filtered[selectedIndex].id}` : undefined
              }
              value={query}
              placeholder="Search courses, topics and actions"
              onChange={(event) => {
                onQueryChange(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => (filtered.length ? (index + 1) % filtered.length : 0));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) =>
                    filtered.length ? (index - 1 + filtered.length) % filtered.length : 0,
                  );
                } else if (event.key === "Enter" && filtered[selectedIndex]) {
                  event.preventDefault();
                  run(filtered[selectedIndex]);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-tertiary"
            />
            <Kbd>esc</Kbd>
          </label>

          <Separator />

          <div
            id="command-palette-results"
            role="listbox"
            aria-label="Commands"
            className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5"
          >
            {filtered.length ? (
              filtered.map((command, index) => {
                const active = index === selectedIndex;
                return (
                  <button
                    key={command.id}
                    id={`command-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={command.disabled}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => run(command)}
                    className={clsx(
                      "flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left",
                      "disabled:pointer-events-none disabled:opacity-40",
                      active ? "bg-accent text-on-accent" : "hover:bg-fill",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "flex size-5 shrink-0 items-center justify-center [&_svg]:size-3.5",
                        active ? "opacity-90" : "text-secondary",
                      )}
                    >
                      {command.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{command.label}</span>
                      {command.detail ? (
                        <span
                          className={clsx(
                            "block truncate text-caption",
                            active ? "opacity-75" : "text-tertiary",
                          )}
                        >
                          {command.detail}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={clsx(
                        "text-caption",
                        active ? "opacity-70" : "text-quaternary",
                      )}
                    >
                      {command.category}
                    </span>
                    {command.shortcut ? <Kbd>{command.shortcut}</Kbd> : null}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-8 text-center text-body text-secondary">
                No commands match “{query}”.
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
