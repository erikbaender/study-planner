"use client";

/**
 * The command palette.
 *
 * Spotlight's shape rather than a sheet's: a panel floating near the top of the
 * window, not hinged to its edge. The distinction is not decorative — a sheet
 * is modal to the *document* and asks you to finish something, while this is
 * modal to nothing and disappears the moment you have said where you want to
 * go. It opens from the ⌘-glyph button in the toolbar; the app has no keyboard
 * shortcuts.
 *
 * Markup is the ARIA combobox pattern: focus never leaves the text field, and
 * the highlighted row is named by `aria-activedescendant`. Moving real focus
 * into the list — the obvious implementation — would mean every arrow key stops
 * the user typing, and screen readers would announce a listbox the user cannot
 * type into.
 *
 * Built directly on Radix's Dialog rather than on `Sheet`, but it still gets
 * Radix's focus trap, restore-on-close, scroll lock and outside-click dismissal
 * for free.
 */

import { clsx } from "clsx";
import { Search } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterCommands, groupCommands, type Command } from "@/features/workspace/commands";

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => filterCommands(commands, query), [commands, query]);
  const groups = useMemo(() => groupCommands(matches), [matches]);

  // A narrowing query can leave the highlight past the end of the list; a
  // widening one should still start from the top. Clamped during render rather
  // than in an effect, so no frame is ever painted with the highlight on a row
  // that is not there.
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));
  const activeCommand = matches[activeIndex];
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Reset on either edge of `open`, adjusted during render rather than in an
  // effect: the palette must never be painted showing the last search, and an
  // effect runs after the frame that would show it.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setQuery("");
    setActive(0);
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(activeIndex))}`)
      ?.scrollIntoView({ block: "nearest" });
    // `optionId` is derived from `listId`, which is stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, matches.length]);

  const move = (delta: number) => {
    if (matches.length === 0) return;
    setActive((current) => {
      const from = Math.min(current, matches.length - 1);
      return (from + delta + matches.length) % matches.length;
    });
  };

  const run = (command: Command | undefined) => {
    if (!command) return;
    // Closed first: several commands open a sheet of their own, and a palette
    // still unmounting on top of it would steal the focus back.
    onOpenChange(false);
    command.run();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={clsx(
            "fixed inset-0 z-40 bg-[var(--mac-material-scrim)]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={clsx(
            "material-popover fixed top-[16vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2",
            "flex flex-col overflow-hidden rounded-popover shadow-sheet",
            "inset-ring inset-ring-[var(--mac-separator-strong)]",
            "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
          )}
          onOpenAutoFocus={(event) => {
            // Radix focuses the first tabbable node on open. Doing it directly
            // means the caret is ready for the first keystroke after the chord,
            // rather than a frame later.
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>

          <div className="flex items-center gap-2 border-b border-separator px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-tertiary" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-controls={listId}
              aria-activedescendant={activeCommand ? optionId(activeIndex) : undefined}
              aria-label="Search commands, courses and topics"
              autoComplete="off"
              placeholder="Jump to a course or topic, or run a command…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                // Arrow and Enter keys belong to the IME while text is being
                // composed. Running a command here would submit a half-finished
                // character instead of accepting it.
                if (event.nativeEvent.isComposing) return;

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  run(activeCommand);
                }
              }}
              className="h-11 min-w-0 flex-1 bg-transparent text-title3 outline-none placeholder:text-tertiary"
            />
          </div>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Results"
            className={clsx(
              "max-h-[min(24rem,50vh)] overflow-y-auto",
              matches.length > 0 && "p-1.5",
            )}
          >
            {groups.map(([group, items], groupIndex) => {
              const groupId = `${listId}-group-${groupIndex}`;
              return (
                <li key={group} role="group" aria-labelledby={groupId}>
                  <p
                    id={groupId}
                    className="px-2 pt-2 pb-1 text-caption font-semibold tracking-wide text-tertiary uppercase"
                  >
                    {group}
                  </p>
                  <ul role="presentation">
                    {items.map((command) => {
                      const index = matches.indexOf(command);
                      const isActive = index === activeIndex;
                      return (
                        <li
                          key={command.id}
                          id={optionId(index)}
                          role="option"
                          aria-selected={isActive}
                          aria-label={
                            command.subtitle
                              ? `${command.title}, ${command.subtitle}`
                              : command.title
                          }
                          // Selection follows the pointer, as it does in every
                          // macOS menu: the row under the cursor is the row
                          // Enter would run.
                          onPointerMove={() => setActive(index)}
                          onClick={() => run(command)}
                          className={clsx(
                            "flex h-8 cursor-default items-center gap-2 rounded-control px-2 select-none",
                            isActive ? "bg-accent text-on-accent" : "text-label",
                          )}
                        >
                          <span className="min-w-0 truncate text-body">{command.title}</span>
                          {command.subtitle ? (
                            <span
                              className={clsx(
                                "ml-auto min-w-0 truncate text-callout",
                                isActive ? "opacity-70" : "text-tertiary",
                              )}
                            >
                              {command.subtitle}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>

          {matches.length === 0 ? (
            <p role="status" className="px-3 py-6 text-center text-body text-secondary">
              Nothing matches “{query.trim()}”.
            </p>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
