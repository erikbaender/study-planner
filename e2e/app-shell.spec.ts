import { expect, test } from "@playwright/test";

test("navigates the Phase 3 workspace by mouse and keyboard", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "No semesters yet" })).toBeVisible();
  await page.getByRole("button", { name: "Sample", exact: true }).click();

  await expect(page.getByRole("navigation", { name: "Study Planner navigation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Study Planner navigation" })
    .getByRole("button", { name: /Biochemistry/ }).click();
  await expect(page.getByText("Course outline", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { name: "Biochemistry", exact: true })).toBeVisible();

  const topicRows = page.locator("[data-topic-row]");
  await expect(topicRows).toHaveCount(44);
  const rowHeights = await topicRows.evaluateAll((rows) =>
    rows.slice(0, 8).map((row) => row.getBoundingClientRect().height),
  );
  expect(new Set(rowHeights).size).toBe(1);

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search commands" }).fill("Physiology");
  await palette.locator('[id^="command-course-"]').filter({ hasText: "Physiology" }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Physiology", exact: true })).toBeVisible();

  await page.keyboard.press("Control+2");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("grid", { name: /timeline/ })).toBeVisible();

  await page.keyboard.press("Control+N");
  await expect(page.getByRole("dialog", { name: "New item" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  await page.keyboard.press("Control+Alt+I");
  await expect(page.getByRole("complementary", { name: "Inspector" })).not.toBeVisible();
});
