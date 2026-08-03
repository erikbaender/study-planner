import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Badge, EmptyState, ProgressBar } from "./feedback";
import { CountdownBadge, Sidebar, SidebarItem, SidebarSection } from "./sidebar";

describe("ProgressBar", () => {
  it("reports a measured ratio as a percentage", () => {
    render(<ProgressBar ratio={0.42} label="Biochemistry progress" />);

    const bar = screen.getByRole("progressbar", { name: "Biochemistry progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuetext", "42%");
  });

  it("distinguishes an unsized topic from an untouched one", () => {
    // `ratio: null` means "no total set", which is not 0%. Reporting it as 0
    // would be the interface quietly inventing a fact.
    render(<ProgressBar ratio={null} label="Anatomy progress" />);

    const bar = screen.getByRole("progressbar", { name: "Anatomy progress" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuetext", "Size not set");
  });

  it("still reports zero as zero", () => {
    render(<ProgressBar ratio={0} label="Anatomy progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("clamps a ratio that overshoots", () => {
    // Over-logging units is allowed by the domain; a 130%-wide bar is not.
    render(<ProgressBar ratio={1.3} label="Physiology progress" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("Badge", () => {
  it("renders its content", () => {
    render(<Badge tone="red">3 behind</Badge>);
    expect(screen.getByText("3 behind")).toBeInTheDocument();
  });

  it("always uses a transparent fill and tone-colored border and text", () => {
    render(<Badge tone="green">On track</Badge>);
    expect(screen.getByText("On track")).toHaveClass(
      "bg-transparent",
      "border-current",
      "text-green",
    );
    expect(screen.getByText("On track")).not.toHaveClass("text-white");
  });
});

describe("EmptyState", () => {
  it("always carries the action that resolves it", async () => {
    // The audit found the app stuck on "Add a course" with no way to add one.
    // The action is a required prop precisely so that cannot recur.
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No courses yet"
        description="Add your first course to start planning."
        action={<button onClick={onClick}>Add course</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "No courses yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add course" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Sidebar", () => {
  function renderSidebar(selected = "biochem") {
    const onSelect = vi.fn();
    render(
      <Sidebar label="Courses">
        <SidebarSection title="Winter 2026">
          <SidebarItem
            label="Biochemistry"
            selected={selected === "biochem"}
            onSelect={onSelect}
            dotColor="#ff3b30"
            progress={0.5}
          />
          <SidebarItem
            label="Anatomy"
            selected={selected === "anatomy"}
            onSelect={onSelect}
            progress={null}
          />
        </SidebarSection>
      </Sidebar>,
    );
    return { onSelect };
  }

  it("is navigation, not a pile of buttons", () => {
    renderSidebar();
    expect(screen.getByRole("navigation", { name: "Courses" })).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("marks exactly one row as the current page", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /Biochemistry/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: /Anatomy/ })).not.toHaveAttribute("aria-current");
  });

  it("selects a row on click", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSidebar();

    await user.click(screen.getByRole("button", { name: /Anatomy/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("carries each row's progress with it", () => {
    renderSidebar();
    expect(screen.getByRole("progressbar", { name: "Biochemistry progress" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(
      screen.getByRole("progressbar", { name: "Anatomy progress" }),
    ).toHaveAttribute("aria-valuetext", "Size not set");
  });
});

describe("CountdownBadge", () => {
  it("spells the countdown out for screen readers", () => {
    // "12d" is fine to look at and useless to listen to.
    render(<CountdownBadge days={12} />);
    expect(screen.getByText("Exam in 12 days")).toBeInTheDocument();
    expect(screen.getByText("12d")).toHaveAttribute("aria-hidden", "true");
  });

  it("says a provisional date is provisional", () => {
    render(<CountdownBadge days={40} provisional />);
    expect(screen.getByText("Provisional exam, 40 days")).toBeInTheDocument();
  });
});
