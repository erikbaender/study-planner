import { expect, test } from "@playwright/test";

test("navigates the workspace through the Phase 7 planning and progress loop", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "No semesters yet" })).toBeVisible();
  await page.getByRole("button", { name: "Sample", exact: true }).click();

  await expect(page.getByRole("navigation", { name: "Study Planner navigation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  const capacity = page.getByRole("spinbutton", { name: "What-if daily capacity" });
  await capacity.fill("400");
  await expect(page.getByText("974 units do not fit before the exams.")).toBeVisible();
  await page.getByRole("button", { name: "Auto-plan semester" }).click();
  await expect(page.getByRole("button", { name: "Reflow from today" })).toBeVisible();
  await expect(page.getByText(/topics$/).first()).not.toHaveText("0 topics");
  await expect(page.getByRole("heading", { name: "Next up" })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /^Complete .+, .+, .+ target$/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reflow from today" }).click();
  await expect(page.getByRole("button", { name: "Reflow from today" })).toBeEnabled();
  expect(
    await page.evaluate(() => ({
      width: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      height: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
    })),
  ).toEqual({ width: [1280, 1280], height: [720, 720] });

  await page
    .getByRole("navigation", { name: "Study Planner navigation" })
    .getByRole("button", { name: /Biochemistry/ }).click();
  await expect(page.getByText("Course outline", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Course name" })).toHaveValue("Biochemistry");
  for (const name of ["Name", "Unit", "Total", "Done", "Progress", "Status", "Exam"]) {
    await expect(page.getByRole("columnheader", { name })).toBeVisible();
  }
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByRole("heading", { name: "Pace and projection" })).toBeVisible();
  for (const label of ["Observed pace", "Needed pace", "Projected finish", "Study days left"]) {
    await expect(inspector.getByText(label, { exact: true })).toBeVisible();
  }

  const topicRows = page.locator("[data-topic-row]");
  await expect(topicRows).toHaveCount(44);
  const rowHeights = await topicRows.evaluateAll((rows) =>
    rows.slice(0, 8).map((row) => row.getBoundingClientRect().height),
  );
  expect(new Set(rowHeights).size).toBe(1);

  const firstName = topicRows.first().locator('input[aria-label$=" name"]');
  await firstName.focus();
  await page.keyboard.press("Control+Enter");
  await page.getByRole("textbox", { name: "New topic name" }).fill("Review synthesis");
  await page.getByRole("textbox", { name: "New topic name" }).press("Enter");
  await expect(topicRows).toHaveCount(45);

  const reviewRow = topicRows.filter({
    has: page.getByRole("textbox", { name: "Review synthesis name" }),
  });
  const reviewTotal = reviewRow.getByRole("spinbutton", { name: "Review synthesis total" });
  await reviewTotal.fill("12");
  await reviewTotal.press("Tab");
  await expect(reviewTotal).toHaveValue("12");
  const reviewDone = reviewRow.getByRole("spinbutton", { name: "Review synthesis done" });
  await reviewDone.fill("3");
  await reviewDone.press("Tab");
  await expect(reviewDone).toHaveValue("3");
  const reviewStatus = reviewRow.getByRole("combobox", {
    name: "Review synthesis status",
  });
  const reviewProgress = reviewRow.getByRole("slider", {
    name: "Review synthesis progress",
  });
  await reviewStatus.selectOption("done");
  await expect(reviewDone).toHaveValue("12");
  await expect(reviewProgress).toHaveAttribute("aria-valuenow", "12");
  await reviewStatus.selectOption("planned");
  await expect(reviewDone).toHaveValue("0");
  await expect(reviewProgress).toHaveAttribute("aria-valuenow", "0");

  await expect(inspector.getByRole("heading", { name: "Study history" })).toBeVisible();
  await inspector.getByRole("button", { name: "Log progress" }).click();
  const logDialog = page.getByRole("dialog", { name: "Log progress for Review synthesis" });
  await logDialog.getByRole("spinbutton", { name: "Slides" }).fill("2");
  await logDialog.getByRole("spinbutton", { name: "Minutes" }).fill("15");
  await logDialog.getByRole("textbox", { name: "Note" }).fill("Practice recall");
  await logDialog.getByRole("button", { name: "Log progress" }).click();
  await expect(logDialog).not.toBeVisible();
  await expect(inspector.getByText(/\+2 slides/)).toBeVisible();
  await expect(inspector.getByText(/15 min · Practice recall/)).toBeVisible();

  await page.getByRole("button", { name: "Add exam" }).click();
  const examDialog = page.getByRole("dialog", { name: "Add exam or deadline" });
  await examDialog.getByRole("textbox", { name: "Name" }).fill("Phase 7 deadline");
  await examDialog.getByRole("combobox", { name: "Type" }).selectOption("deadline");
  await examDialog.getByRole("combobox", { name: "Certainty" }).selectOption("provisional");
  await examDialog.getByLabel("Window starts").fill("2026-09-10");
  await examDialog.getByLabel("Window ends").fill("2026-09-14");
  await examDialog.getByRole("textbox", { name: "Notes" }).fill("Review fixture");
  await examDialog.getByRole("button", { name: "Add exam" }).click();
  const addedExam = page.locator("li").filter({ hasText: "Phase 7 deadline" });
  await expect(addedExam.getByText("Provisional", { exact: true })).toBeVisible();
  await addedExam.getByRole("button", { name: "Edit Phase 7 deadline" }).click();
  const editExamDialog = page.getByRole("dialog", { name: "Edit exam or deadline" });
  await editExamDialog.getByRole("combobox", { name: "Certainty" }).selectOption("confirmed");
  await expect(editExamDialog.getByLabel("Window ends")).toHaveCount(0);
  await editExamDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(addedExam.getByText("Confirmed", { exact: true })).toBeVisible();
  await addedExam.getByRole("button", { name: "Delete Phase 7 deadline" }).click();
  await expect(page.getByText("Phase 7 deadline", { exact: true })).toHaveCount(0);

  expect(
    await page.evaluate(() => ({
      width: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      height: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
    })),
  ).toEqual({ width: [1280, 1280], height: [720, 720] });

  await reviewRow
    .getByRole("button", { name: "Drag Review synthesis" })
    .dragTo(topicRows.first());
  await expect(topicRows.first().getByRole("textbox", { name: "Review synthesis name" })).toBeVisible();

  await page.getByRole("button", { name: "Add course" }).click();
  const addCourse = page.getByRole("button", { name: "Add", exact: true });
  const courseForm = page.locator("form").filter({ has: addCourse });
  await courseForm.getByRole("textbox", { name: "Course name" }).fill("Clinical Skills");
  await addCourse.click();
  await expect(page.getByRole("textbox", { name: "Course name" })).toHaveValue("Clinical Skills");
  await page.getByRole("button", { name: "Biochemistry", exact: true }).click();

  await page
    .getByRole("textbox", { name: "Bulk add topics" })
    .fill("Review block\n  Retrieval practice — 5 pages\n  Mixed questions — 6");
  await expect(page.getByText("2 topics", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add topics" }).click();
  await expect(topicRows).toHaveCount(47);

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search commands" }).fill("Physiology");
  await palette.locator('[id^="command-course-"]').filter({ hasText: "Physiology" }).click();
  await expect(page.getByRole("textbox", { name: "Course name" })).toHaveValue("Physiology");

  await page.keyboard.press("Control+2");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  const timeline = page.getByRole("grid", { name: /timeline/ });
  await expect(timeline).toBeVisible();
  await expect(timeline.getByLabel(/^Today,/)).toBeVisible();
  const totalRows = Number(await timeline.getAttribute("aria-rowcount"));
  expect(totalRows).toBeGreaterThan(300);
  expect(await timeline.getByRole("row").count()).toBeLessThan(totalRows);

  const collapse = timeline.getByRole("button", { name: "Collapse Biochemistry" });
  const biochemistryCount = Number(
    (await timeline.getByRole("rowheader", { name: /Biochemistry/ }).textContent())
      ?.match(/\d+$/)?.[0],
  );
  await collapse.click();
  await expect(
    timeline.getByRole("button", { name: "Expand Biochemistry" }),
  ).toBeVisible();
  expect(Number(await timeline.getAttribute("aria-rowcount"))).toBe(
    totalRows - biochemistryCount,
  );

  expect(
    await page.evaluate(() => ({
      width: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      height: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
    })),
  ).toEqual({ width: [1280, 1280], height: [720, 720] });

  await page.keyboard.press("Control+N");
  await expect(page.getByRole("dialog", { name: "New item" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  await page.keyboard.press("Control+Alt+I");
  await expect(page.getByRole("complementary", { name: "Inspector" })).not.toBeVisible();
});
