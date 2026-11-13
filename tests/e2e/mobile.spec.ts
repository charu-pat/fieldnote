import { expect, test } from "@playwright/test";
import { openWith, saved } from "./helpers";
import { savedData } from "../fixtures/cv";

test.describe("Narrow screens (section 4.1, A-2 tap alternative)", () => {
  test("shows Collection and CV tabs, one pane at a time", async ({ page }) => {
    await openWith(page, savedData());
    const tabs = page.getByRole("navigation", { name: "Workspace views" });
    await expect(tabs.getByRole("button", { name: /Collection/ })).toContainText("2");
    await expect(tabs.getByRole("button", { name: /Your CV/ })).toContainText("10");
    await expect(page.locator(".collection-pane")).toBeVisible();
    await expect(page.locator(".preview-pane")).toBeHidden();
    await tabs.getByRole("button", { name: /Your CV/ }).tap();
    await expect(page.locator(".preview-pane")).toBeVisible();
    await expect(page.locator(".collection-pane")).toBeHidden();
  });

  test("tapping + then a section adds the item and switches to the CV tab", async ({ page }) => {
    await openWith(page, savedData());
    await page.getByRole("button", { name: "Choose a section for NewSkill" }).tap();
    await page.getByLabel("Add copy to").selectOption({ label: "Education" });
    await expect(page.locator(".preview-pane")).toBeVisible();
    const education = (await saved(page)).cv.sections.find((section) => section.id === "education")!;
    expect(education.items.map((item) => item.text)).toEqual(["NewSkill"]);
  });
});
