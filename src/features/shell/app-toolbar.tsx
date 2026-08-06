"use client";

/**
 * The unified toolbar.
 *
 * Left of the spacer is *where you are* — the sidebar toggle and the view
 * switcher. Right of it is *what you can do* — create, inspect,
 * appearance, account. macOS toolbars are grouped this way and the grouping is
 * what makes them scannable at a glance rather than a strip of icons.
 *
 * The view switcher is a segmented control rather than tabs, per §7.4. It also
 * drives the three panels, so it carries `aria-controls` pointing at the one
 * content region they share.
 */

import { useRef } from "react";
import {
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  Settings2,
} from "lucide-react";
import {
  AnimationSpeedControl,
  AppearanceControl,
  Badge,
  Button,
  DropdownMenu,
  IconButton,
  Popover,
  SegmentedControl,
  Separator,
  Toolbar,
  ToolbarSpacer,
  Tooltip,
} from "@/ui";
import { VIEWS, VIEW_LABELS, type ViewId } from "@/features/workspace/store";

export function AppToolbar(props: {
    view: ViewId;
    onViewChange: (view: ViewId) => void;
    contentId: string;
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
    inspectorOpen: boolean;
    onToggleInspector: () => void;
    inspectorShortcut: string;
    onNewPlan: () => void;
    onNewCourse: () => void;
    newShortcut: string;
    onLoadSampleData: () => void;
    onExport: () => void;
    onImport: (file: File) => void;
    canExport: boolean;
    isAuthenticated: boolean;
    onSignIn: () => void;
    onSignOut: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Toolbar>
      <Tooltip content={props.sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
        <IconButton
          size="sm"
          label={props.sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={props.sidebarOpen}
          icon={<PanelLeft />}
          onClick={props.onToggleSidebar}
        />
      </Tooltip>

      <SegmentedControl<ViewId>
        label="View"
        aria-controls={props.contentId}
        value={props.view}
        onValueChange={props.onViewChange}
        segments={VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view] }))}
      />

      <ToolbarSpacer />

      <DropdownMenu
        label="New"
        align="end"
        items={[
          { label: "New course", icon: <Plus />, shortcut: props.newShortcut, onSelect: props.onNewCourse },
          { label: "New semester", onSelect: props.onNewPlan },
        ]}
        trigger={
          <span>
            <Tooltip content="New">
              <IconButton size="sm" label="New" icon={<Plus />} />
            </Tooltip>
          </span>
        }
      />

      <Tooltip content={`Inspector ${props.inspectorShortcut}`}>
        <IconButton
          size="sm"
          label="Inspector"
          aria-pressed={props.inspectorOpen}
          variant={props.inspectorOpen ? "push" : "plain"}
          icon={<PanelRight />}
          onClick={props.onToggleInspector}
        />
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-4" />

      <Popover
        side="bottom"
        align="end"
        trigger={
          <span>
            <Tooltip content="Appearance">
              <IconButton size="sm" label="Appearance" icon={<Settings2 />} />
            </Tooltip>
          </span>
        }
      >
        <div className="flex w-56 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-callout font-semibold text-secondary">Appearance</h2>
            <AppearanceControl />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-callout font-semibold text-secondary">Motion</h2>
            <AnimationSpeedControl />
          </div>
        </div>
      </Popover>

      <DropdownMenu
        label="More"
        align="end"
        items={[
          { label: "Load sample data", onSelect: props.onLoadSampleData },
          { type: "separator" },
          { label: "Export as JSON", onSelect: props.onExport, disabled: !props.canExport },
          // The file dialog can only be opened from a user gesture, and a menu
          // item is one — so a hidden input is clicked rather than a `<label>`
          // being smuggled into the menu.
          { label: "Import JSON…", onSelect: () => fileRef.current?.click() },
        ]}
        trigger={
          <span>
            <Tooltip content="More">
              <IconButton size="sm" label="More" icon={<MoreHorizontal />} />
            </Tooltip>
          </span>
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        // Hidden from both the tab order and the accessibility tree: the menu
        // item above is the control, and a second "Choose File" button
        // announced beside it is noise.
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) props.onImport(file);
          // Cleared so that importing the same file twice in a row still fires.
          event.target.value = "";
        }}
      />

      <Badge tone={props.isAuthenticated ? "positive" : "neutral"}>
        {props.isAuthenticated ? "Synced" : "This device"}
      </Badge>

      {props.isAuthenticated ? (
        <Button size="sm" onClick={props.onSignOut}>
          Sign out
        </Button>
      ) : (
        <Button size="sm" variant="accent" onClick={props.onSignIn}>
          Sign in
        </Button>
      )}
    </Toolbar>
  );
}
