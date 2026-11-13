import { expect, test } from "@playwright/test";
import { cvItem, openWith, section } from "./helpers";
import { longCV, sampleCV, savedData } from "../fixtures/cv";

test.describe("Appearance (D-10, D-13, section 4.2)", () => {
  test("skills are centred pills; statements are bullets", async ({ page }) => {
    await openWith(page, savedData());
    const chip = cvItem(page, "SkillA");
    const style = await chip.evaluate((element) => {
      const css = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element.querySelector(".draft-text")!);
      const text = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return { radius: css.borderRadius, left: text.left - box.left, right: box.right - text.right, bullet: getComputedStyle(element, "::before").display };
    });
    expect(style.radius).toBe("999px");
    expect(Math.abs(style.left - style.right)).toBeLessThan(1);
    expect(style.bullet).toBe("none");

    const skillBoxes = await section(page, "Skills").locator("[data-cv-item-id]").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(new Set(skillBoxes.map(Math.round)).size).toBe(1);

    const statementBullet = await cvItem(page, "Stmt one").evaluate((element) => getComputedStyle(element, "::before").content);
    expect(statementBullet).toBe('"•"');
  });

  test("the drag handle on a pill does not take up space", async ({ page }) => {
    await openWith(page, savedData());
    const position = await cvItem(page, "SkillA").locator(".draft-grip").evaluate((element) => getComputedStyle(element).position);
    expect(position).toBe("absolute");
  });

  test("the preview is paper-sized, paginated and matches the editor content", async ({ page }) => {
    await openWith(page, savedData(longCV()));
    await page.getByRole("button", { name: "Preview document" }).click();
    const pages = page.locator(".cv-paper.output-preview");
    expect(await pages.count()).toBeGreaterThan(1);
    const ratio = await pages.first().evaluate((element) => element.getBoundingClientRect().height / element.getBoundingClientRect().width);
    expect(ratio).toBeCloseTo(297 / 210, 2);
    await expect(pages.first().locator(".output-section-heading").first()).toHaveText("PROFILE / SUMMARY");
    await expect(pages.first()).toContainText("SkillA  ·  SkillB  ·  SkillC");
    await page.getByRole("button", { name: "Edit CV" }).click();
    await expect(page.getByText("LIVE EDITOR")).toBeVisible();
  });

  test("dark mode changes the app chrome but the CV stays black on white", async ({ page }) => {
    await openWith(page, savedData(sampleCV()));
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveClass(/dark-theme/);
    const colours = await page.evaluate(() => ({
      shell: getComputedStyle(document.querySelector(".app-shell")!).backgroundColor,
      paper: getComputedStyle(document.querySelector(".cv-paper")!).backgroundColor,
    }));
    expect(colours.paper).toBe("rgb(255, 255, 255)");
    expect(colours.shell).not.toBe("rgb(255, 255, 255)");
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark-theme/);
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark-theme/);
  });

  test("controls have accessible names and visible keyboard focus (A-5)", async ({ page }) => {
    await openWith(page, savedData());
    const unnamed = await page.locator("button, input, select, textarea").evaluateAll((elements) =>
      elements.filter((element) => {
        const el = element as HTMLElement;
        if (el.hidden || el.getAttribute("type") === "file") return false;
        const label = el.getAttribute("aria-label") || el.textContent?.trim() || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || el.getAttribute("placeholder");
        return !label;
      }).map((element) => element.outerHTML.slice(0, 120)));
    expect(unnamed).toEqual([]);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
