import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { course, plan } from "@/test/factories";
import { CreateItemSheet } from "./CreateItemSheet";

describe("CreateItemSheet", () => {
  it("honours a course-specific entry point even when a course is selected", () => {
    const selectedCourse = course({ id: "course_bio", name: "Biochemistry" });
    render(
      <CreateItemSheet
        open
        onOpenChange={vi.fn()}
        plan={plan({ courses: [selectedCourse] })}
        course={selectedCourse}
        initialKind="course"
        onCreatePlan={vi.fn()}
        onCreateCourse={vi.fn()}
        onCreateTopic={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Item" })).toHaveValue("course");
    expect(screen.getByRole("textbox", { name: "Course name" })).toBeInTheDocument();
  });
});
