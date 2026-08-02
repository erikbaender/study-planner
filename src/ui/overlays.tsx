"use client";

/**
 * Overlays: popovers, sheets, menus, context menus, tooltips.
 *
 * These exist to end the pattern the audit found — *every* click opening a
 * full-screen modal, including a click that was meant to be a drag. macOS uses
 * a graded set instead, and the grading is the point:
 *
 * | Weight  | Control      | For                                              |
 * |---------|--------------|--------------------------------------------------|
 * | lowest  | Tooltip      | naming an icon                                    |
 * | low     | Popover      | inspecting or quickly editing one thing           |
 * | medium  | Menu         | choosing an action                                |
 * | highest | Sheet        | multi-field create/edit, and only then            |
 *
 * All of it is Radix underneath, which supplies the parts that are tedious and
 * easy to get subtly wrong: focus trapping and restoration, `aria-expanded` and
 * `aria-controls` wiring, dismiss-on-outside-click, Escape handling, typeahead
 * in menus, and collision-aware positioning.
 */

import { clsx } from "clsx";
import {
  ContextMenu as RadixContextMenu,
  Dialog as RadixDialog,
  DropdownMenu as RadixDropdownMenu,
  Popover as RadixPopover,
  Tooltip as RadixTooltip,
} from "radix-ui";
import { Check } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/* ─── Popover ───────────────────────────────────────────────────────────── */

const SURFACE = clsx(
  "material-popover z-50 rounded-popover shadow-popover",
  "inset-ring inset-ring-[var(--mac-separator-strong)]",
  "origin-(--radix-popover-content-transform-origin)",
  "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
);

export function Popover({
  trigger,
  children,
  side = "bottom",
  align = "center",
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={clsx(SURFACE, "p-3", className)}
        >
          {children}
          {/* The arrow is what ties the popover to the thing it describes —
              without it this is just a floating panel. */}
          <RadixPopover.Arrow
            width={12}
            height={6}
            className="fill-[var(--mac-material-popover)]"
          />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/* ─── Sheet ─────────────────────────────────────────────────────────────── */

/**
 * A macOS sheet: attached to the top of the window, sliding down, rather than a
 * box floating in the middle of the screen. Reserved for multi-field forms.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  trigger,
  width = "md",
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  /** Optional supporting line. Also becomes the dialog's accessible description. */
  description?: string;
  children: ReactNode;
  /**
   * Required. A sheet must offer a way out of itself, and since there is no
   * close button it has to be here — the same reason `EmptyState` takes its
   * action as a required prop.
   */
  footer: ReactNode;
  trigger?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" } as const;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={clsx(
            "fixed inset-0 z-40 bg-[var(--mac-material-scrim)]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <RadixDialog.Content
          className={clsx(
            "fixed top-0 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2",
            widths[width],
            "material-overlay mt-0 rounded-b-sheet shadow-sheet",
            "flex max-h-[85vh] flex-col overflow-hidden",
            "data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
          )}
        >
          {/*
            No close button. A sheet's footer already carries Cancel, and a ✕ in
            the corner is a second control for the same thing — which on macOS a
            sheet does not have, because it is attached to the document rather
            than being a window of its own. Escape and a click outside still
            dismiss it.
          */}
          <header className="flex flex-col gap-0.5 px-5 pt-4 pb-3">
            <RadixDialog.Title className="text-title3 font-semibold">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="text-callout text-secondary">
                {description}
              </RadixDialog.Description>
            ) : null}
          </header>
          <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {/* Buttons right-aligned, confirm last: the macOS order, and the
              reverse of the Windows one. */}
          <footer className="flex items-center justify-end gap-2 border-t border-separator px-5 py-3">
            {footer}
          </footer>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Escape hatch for a sheet whose close button must live elsewhere. */
export const SheetClose = RadixDialog.Close;

/* ─── Menus ─────────────────────────────────────────────────────────────── */

const MENU_SURFACE = clsx(
  "material-popover z-50 min-w-44 rounded-control p-1 shadow-popover",
  "inset-ring inset-ring-[var(--mac-separator-strong)]",
  "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
);

const MENU_ITEM = clsx(
  "flex h-6 cursor-default items-center gap-2 rounded-[4px] px-2 text-body select-none",
  "outline-none data-highlighted:bg-accent data-highlighted:text-on-accent",
  "data-disabled:pointer-events-none data-disabled:opacity-40",
  "[&_svg]:size-3.5",
);

export type MenuItem =
  | { type?: "item"; label: string; onSelect: () => void; icon?: ReactNode; shortcut?: string; disabled?: boolean; danger?: boolean }
  | { type: "checkbox"; label: string; checked: boolean; onSelect: () => void; disabled?: boolean }
  | { type: "separator" };

function renderItems(
  items: readonly MenuItem[],
  parts: {
    Item: typeof RadixDropdownMenu.Item;
    CheckboxItem: typeof RadixDropdownMenu.CheckboxItem;
    ItemIndicator: typeof RadixDropdownMenu.ItemIndicator;
    Separator: typeof RadixDropdownMenu.Separator;
  },
) {
  return items.map((item, index) => {
    if (item.type === "separator") {
      return <parts.Separator key={index} className="my-1 h-px bg-separator" />;
    }

    if (item.type === "checkbox") {
      return (
        <parts.CheckboxItem
          key={index}
          checked={item.checked}
          disabled={item.disabled}
          onSelect={item.onSelect}
          className={clsx(MENU_ITEM, "pl-6")}
        >
          <parts.ItemIndicator className="absolute left-2">
            <Check className="size-3" strokeWidth={3} />
          </parts.ItemIndicator>
          {item.label}
        </parts.CheckboxItem>
      );
    }

    return (
      <parts.Item
        key={index}
        disabled={item.disabled}
        onSelect={item.onSelect}
        className={clsx(MENU_ITEM, item.danger && "text-red data-highlighted:bg-red")}
      >
        {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
        {item.label}
        {item.shortcut ? (
          <span className="ml-auto pl-4 text-callout opacity-60">{item.shortcut}</span>
        ) : null}
      </parts.Item>
    );
  });
}

export function DropdownMenu({
  trigger,
  items,
  align = "start",
  label,
}: {
  trigger: ReactNode;
  items: readonly MenuItem[];
  align?: "start" | "center" | "end";
  /** Names the menu for screen readers when the trigger is an icon. */
  label?: string;
}) {
  return (
    <RadixDropdownMenu.Root>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          align={align}
          sideOffset={4}
          collisionPadding={12}
          aria-label={label}
          className={clsx(
            MENU_SURFACE,
            "origin-(--radix-dropdown-menu-content-transform-origin)",
          )}
        >
          {renderItems(items, RadixDropdownMenu)}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

/**
 * Right-click menu. Radix also opens it on long-press, which is what makes the
 * same markup work on the phone layout.
 */
export function ContextMenu({
  children,
  items,
}: {
  children: ReactNode;
  items: readonly MenuItem[];
}) {
  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>{children}</RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content
          collisionPadding={12}
          className={clsx(MENU_SURFACE, "origin-(--radix-context-menu-content-transform-origin)")}
        >
          {renderItems(items, RadixContextMenu)}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}

/* ─── Tooltip ───────────────────────────────────────────────────────────── */

/**
 * Wraps the app once. Radix shares open/close timing across every tooltip
 * inside a provider, which is what produces the platform behaviour where the
 * second tooltip in a toolbar appears instantly.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={600} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "bottom",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={clsx(
            "material-popover z-50 rounded-chip px-1.5 py-0.5 text-callout text-label shadow-popover",
            "inset-ring inset-ring-[var(--mac-separator-strong)]",
            "data-[state=delayed-open]:animate-fade-in",
          )}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/* ─── Toolbar ───────────────────────────────────────────────────────────── */

/** The unified translucent title bar the plan's §7.2 describes. */
export function Toolbar({ className, ...props }: ComponentPropsWithoutRef<"header">) {
  return (
    <header
      className={clsx(
        "material-header flex h-11 shrink-0 items-center gap-2 border-b border-separator px-3",
        className,
      )}
      {...props}
    />
  );
}

/** Pushes everything after it to the right of the toolbar. */
export function ToolbarSpacer() {
  return <span className="flex-1" />;
}
