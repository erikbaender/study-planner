/**
 * The macOS-derived design system.
 *
 * Everything the app renders comes from here. The rule that keeps it honest:
 * nothing in `src/ui` may import from `src/features`, `src/data` or `src/domain`
 * except `palette`, which is shared vocabulary rather than application logic.
 * A primitive that needs to know about a topic is not a primitive.
 */

export { Button, ButtonRow, FileButton, IconButton, buttonClasses } from "./button";
export type { ButtonSize, ButtonVariant } from "./button";

export { Field, Select, SelectField, TextArea, TextField } from "./field";
export type { SelectOption } from "./field";

export { SegmentedControl } from "./segmented-control";
export type { Segment } from "./segmented-control";

export { Checkbox, Stepper, Switch } from "./toggles";

export { Badge, Card, EmptyState, ProgressBar, Separator, Spinner } from "./feedback";
export { Collapse, useListPresence } from "./collapse";
export type { Presence } from "./collapse";
export { useStableCallback } from "./stable-callback";
export type { BadgeTone } from "./feedback";

export { ProgressSlider } from "./progress-slider";

export {
  ContextMenu,
  ContextMenuAt,
  DropdownMenu,
  Popover,
  Sheet,
  SheetClose,
  Toolbar,
  ToolbarSpacer,
} from "./overlays";
export type { MenuItem } from "./overlays";

export { DragIcon, MouseButtonIcon } from "./input-icons";
export type { PointerButton } from "./input-icons";

export { CountdownBadge, Sidebar, SidebarItem, SidebarSection } from "./sidebar";

export { AnimationSpeedControl, AppearanceControl } from "./appearance";
export { KeyboardModeControl, useKeyboardMode } from "./keyboard-mode";
export type { KeyboardMode } from "./keyboard-mode";
export { ThemeProvider, ThemeScript, useTheme } from "./theme";
export type { Appearance, ResolvedAppearance } from "./theme";
