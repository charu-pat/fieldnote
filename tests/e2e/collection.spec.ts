import { expect, test, type Page } from "@playwright/test";
import { libraryCard, openFresh, openWith, saved, section, sectionItems, toast } from "./helpers";
import { demoCollection, sampleCV, savedData } from "../fixtures/cv";

const openDemo = (page: Page) => openWith(page, savedData(sampleCV(), demoCollection()));

test.describe("Collection", () => {
  test("first visit starts with an empty collection and a privacy note", async ({ page }) => {
    await openFresh(page);
    await expect(page.locator(".library-card")).toHaveCount(0);
    await expect(page.getByText("Your collection is clear")).toBeVisible();
    await expect(page.getByRole("tab", { name: /All/ })).toContainText("0");
    await expect(page.getByText("Your work stays on this device. Nothing is sent to a server.")).toBeVisible();
  });

  test("adds skills and statements with a live character counter and limits (C-1, C-2)", async ({ page }) => {
    await openFresh(page);
    const text = page.locator("#new-item-text");
    await expect(page.locator("#character-count")).toHaveText("0 / 80");
    await expect(text).toHaveAttribute("maxlength", "80");
    await text.fill("Negotiation");
    await expect(page.locator("#character-count")).toHaveText("11 / 80");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(libraryCard(page, "Negotiation")).toContainText("skill");

    await page.getByRole("group", { name: "Item type" }).getByRole("button", { name: "Statement" }).click();
    await expect(page.locator("#character-count")).toHaveText("0 / 500");
    await expect(text).toHaveAttribute("maxlength", "500");
    await text.fill("Grew revenue by 20% in a year.");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(libraryCard(page, "Grew revenue by 20% in a year.")).toContainText("statement");
    await expect(page.locator(".library-card").first()).toContainText("Grew revenue");
  });

  test("the Add button is disabled for blank text", async ({ page }) => {
    await openFresh(page);
    await expect(page.getByRole("button", { name: "Add item" })).toBeDisabled();
    await page.locator("#new-item-text").fill("   ");
    await expect(page.getByRole("button", { name: "Add item" })).toBeDisabled();
  });

  test("warns about duplicates of the same type, ignoring case (C-6)", async ({ page }) => {
    await openDemo(page);
    await page.locator("#new-item-text").fill("stakeholder MANAGEMENT");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(toast(page)).toContainText("That item is already in your collection.");
    await expect(page.locator(".library-card")).toHaveCount(9);
  });

  test("filters by type and searches by text (C-4, C-7)", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("tab", { name: /Skills/ }).click();
    await expect(page.locator(".library-card")).toHaveCount(5);
    await page.getByRole("tab", { name: /Statements/ }).click();
    await expect(page.locator(".library-card")).toHaveCount(4);
    await page.getByRole("tab", { name: /All/ }).click();
    await page.getByRole("searchbox", { name: "Search collection" }).fill("PLATFORM");
    await expect(page.locator(".library-card")).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search collection" }).fill("zzz");
    await expect(page.getByText("No matches found")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.locator(".library-card")).toHaveCount(9);
  });

  test("edits an item in place (C-3)", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "Edit Strategic planning" }).click();
    await expect(page.locator("#new-item-text")).toHaveValue("Strategic planning");
    await page.locator("#new-item-text").fill("Strategic portfolio planning");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(libraryCard(page, "Strategic portfolio planning")).toBeVisible();
    await expect(page.locator(".library-card")).toHaveCount(9);
  });

  test("deleting asks for confirmation; cancelling keeps the item (C-3)", async ({ page }) => {
    await openDemo(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Delete Strategic planning" }).click();
    await expect(libraryCard(page, "Strategic planning")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete Strategic planning" }).click();
    await expect(libraryCard(page, "Strategic planning")).toHaveCount(0);
  });

  test("5 skills and 5 statements survive a reload (C-5, acceptance)", async ({ page }) => {
    await openWith(page, savedData(sampleCV(), []));
    for (let index = 1; index <= 5; index++) {
      await page.locator("#new-item-text").fill(`Skill ${index}`);
      await page.getByRole("button", { name: "Add item" }).click();
    }
    await page.getByRole("group", { name: "Item type" }).getByRole("button", { name: "Statement" }).click();
    for (let index = 1; index <= 5; index++) {
      await page.locator("#new-item-text").fill(`Statement ${index}`);
      await page.getByRole("button", { name: "Add item" }).click();
    }
    await page.reload();
    await expect(page.locator(".library-card")).toHaveCount(10);
    const data = await saved(page);
    expect(data.collection.filter((item) => item.type === "skill")).toHaveLength(5);
    expect(data.collection.filter((item) => item.type === "statement")).toHaveLength(5);
  });

  test("a statement placement tag creates the CV headings and + adds it there", async ({ page }) => {
    await openFresh(page);
    await page.getByRole("group", { name: "Item type" }).getByRole("button", { name: "Statement" }).click();
    await page.locator("#new-item-text").fill("Shipped the mobile app.");
    await page.getByPlaceholder("e.g. Experience").fill("Projects");
    await page.getByPlaceholder("e.g. Acme · 2022–2025").fill("Side project");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(section(page, "Projects")).toBeVisible();
    await expect(section(page, "Projects").locator('input[value="Side project"]')).toBeVisible();
    await expect(libraryCard(page, "Shipped the mobile app.")).toContainText("Projects / Side project");

    await page.getByRole("button", { name: "Add Shipped the mobile app. to its tagged CV placement" }).click();
    expect(await sectionItems(page, "Projects")).toEqual(["Shipped the mobile app."]);
  });
});
