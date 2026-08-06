"use client";

import {
  CalendarDays,
  Command,
  GanttChart,
  ListTree,
  PanelRight,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import {
  AccentPicker,
  AppearanceControl,
  Badge,
  Button,
  FileButton,
  IconButton,
  Kbd,
  Popover,
  SegmentedControl,
  Separator,
  Toolbar,
  ToolbarSpacer,
  Tooltip,
} from "@/ui";
import type { WorkspaceView } from "./workspace-store";

const VIEW_SEGMENTS = [
  { value: "today", label: <CalendarDays />, ariaLabel: "Today" },
  { value: "timeline", label: <GanttChart />, ariaLabel: "Timeline" },
  { value: "outline", label: <ListTree />, ariaLabel: "Outline" },
] as const;

export function WorkspaceToolbar({
  planName,
  view,
  inspectorOpen,
  authenticated,
  canExport,
  onViewChange,
  onOpenCommand,
  onCreate,
  onToggleInspector,
  onLoadSample,
  onExport,
  onImport,
  onSignIn,
  onSignOut,
}: {
  planName: string;
  view: WorkspaceView;
  inspectorOpen: boolean;
  authenticated: boolean;
  canExport: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onOpenCommand: () => void;
  onCreate: () => void;
  onToggleInspector: () => void;
  onLoadSample: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <Toolbar aria-label="Workspace toolbar">
      <div className="flex min-w-0 items-center gap-2">
        <Command aria-hidden="true" className="size-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <h1 className="truncate text-body font-semibold">Study Planner</h1>
          <p className="truncate text-caption text-tertiary">{planName}</p>
        </div>
      </div>

      <ToolbarSpacer />

      <SegmentedControl
        value={view}
        onValueChange={onViewChange}
        segments={VIEW_SEGMENTS}
        size="sm"
        label="Workspace view"
      />

      <ToolbarSpacer />

      <Button
        size="sm"
        variant="plain"
        leadingIcon={<Search />}
        trailingIcon={<Kbd>⌘K</Kbd>}
        onClick={onOpenCommand}
      >
        Search
      </Button>

      <Tooltip content="New item">
        <IconButton size="sm" label="New item" icon={<Plus />} onClick={onCreate} />
      </Tooltip>

      <FileButton size="sm" label="Import" accept="application/json" onFile={onImport} />
      <Button size="sm" onClick={onExport} disabled={!canExport}>
        Export
      </Button>
      <Button size="sm" onClick={onLoadSample}>
        Sample
      </Button>

      <Separator orientation="vertical" className="mx-0.5 h-4" />

      <Tooltip content={inspectorOpen ? "Hide inspector" : "Show inspector"}>
        <IconButton
          size="sm"
          label={inspectorOpen ? "Hide inspector" : "Show inspector"}
          icon={<PanelRight />}
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
        />
      </Tooltip>

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
            <h2 className="text-callout font-semibold text-secondary">Accent colour</h2>
            <AccentPicker />
          </div>
        </div>
      </Popover>

      <Badge tone={authenticated ? "green" : "neutral"}>
        {authenticated ? "Synced" : "This device"}
      </Badge>
      <Button size="sm" variant="plain" onClick={authenticated ? onSignOut : onSignIn}>
        {authenticated ? "Sign out" : "Sign in"}
      </Button>
    </Toolbar>
  );
}
