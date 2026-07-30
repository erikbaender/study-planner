import { expect, test } from "@playwright/test";

test("navigates the workspace through the Phase 6 planning loop", async ({
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
