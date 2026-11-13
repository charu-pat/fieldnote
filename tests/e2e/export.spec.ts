import { expect, test } from "@playwright/test";
import { docxParagraphs, exportFile, openWith, pdfTextRuns, previewLines, saved, sectionItems, toast } from "./helpers";
import { longCV, sampleCV, savedData } from "../fixtures/cv";

test.describe("Exports", () => {
  test("PDF: named after the user, real text matching the preview on 2+ pages (E-1, E-3, E-4, E-5, E-7)", async ({ page }) => {
    await openWith(page, savedData(longCV()));
    const lines = await previewLines(page);
    const { download, buffer } = await exportFile(page, "Download PDF");
    expect(download.suggestedFilename()).toBe("Jane-Doe-CV.pdf");
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeGreaterThanOrEqual(2);
    const ascii = (texts: string[]) => texts.filter((text) => /^[\x20-\x7e]+$/.test(text));
    expect(ascii(pdfTextRuns(buffer))).toEqual(ascii(lines));
  });

  test("PDF page count matches the number of preview pages", async ({ page }) => {
    await openWith(page, savedData(longCV()));
    await page.getByRole("button", { name: "Preview document" }).click();
    const previewPages = await page.locator(".cv-paper.output-preview").count();
    await page.getByRole("button", { name: "Edit CV" }).click();
    const { buffer } = await exportFile(page, "Download PDF");
    expect(buffer.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBe(previewPages);
  });

  test("Word: editable document with real headings and a bulleted list, in preview order (E-2, E-3)", async ({ page }) => {
    await openWith(page, savedData(sampleCV()));
    const { download, buffer } = await exportFile(page, "Download Word");
    expect(download.suggestedFilename()).toBe("Jane-Doe-CV.docx");
    const paragraphs = await docxParagraphs(buffer);
    expect(paragraphs.filter((paragraph) => paragraph.style === "Heading1").map((paragraph) => paragraph.text))
      .toEqual(["Profile / Summary", "Skills", "Experience", "Education", "Other"]);
    expect(paragraphs.filter((paragraph) => paragraph.style === "Heading2").map((paragraph) => paragraph.text)).toEqual(["Acme Ltd  |  2020-2023"]);
    expect(paragraphs.filter((paragraph) => paragraph.list).map((paragraph) => paragraph.text))
      .toEqual(["Product leader with ten years of experience.", "Stmt one", "Stmt two", "Stmt three", "Acme one", "Volunteer mentor"]);

    // Same wording and order as the preview (headings are shown in capitals by style, skills joined by "·").
    const normalise = (text: string) => text.replace(/\s+/g, " ").replace(/^• /, "").toUpperCase();
    const lines = await previewLines(page);
    expect(paragraphs.map((paragraph) => normalise(paragraph.text))).toEqual(lines.map(normalise));
  });

  test("page size follows the toolbar selection (E-6)", async ({ page }) => {
    await openWith(page, savedData(sampleCV()));
    await page.getByLabel("Paper").selectOption("Letter");
    await page.getByRole("button", { name: "Preview document" }).click();
    await expect(page.locator(".cv-paper.output-preview").first()).toHaveAttribute("aria-label", "Letter CV preview page 1");
    const { buffer } = await exportFile(page, "Download PDF");
    expect(buffer.toString("latin1")).toMatch(/\/MediaBox \[0 0 612\.?\d* 792\.?\d*\]/);
    expect((await saved(page)).cv.pageSize).toBe("Letter");
  });

  test("falls back to My-CV when there is no name (E-7)", async ({ page }) => {
    const cv = sampleCV();
    cv.header.name = "";
    await openWith(page, savedData(cv));
    expect((await exportFile(page, "Download Word")).download.suggestedFilename()).toBe("My-CV.docx");
  });

  test("exports run entirely in the browser: no network requests (E-8)", async ({ page }) => {
    await openWith(page, savedData(sampleCV()));
    const requests: string[] = [];
    page.on("request", (request) => { if (!request.url().startsWith("blob:") && !request.url().startsWith("data:")) requests.push(request.url()); });
    await exportFile(page, "Download PDF");
    await exportFile(page, "Download Word");
    expect(requests.filter((url) => !new URL(url).pathname.startsWith("/assets/"))).toEqual([]);
    expect(requests.every((url) => new URL(url).host === new URL(page.url()).host)).toBe(true);
  });

  test("JSON backup round-trips the collection and CV (section 5)", async ({ page }) => {
    await openWith(page, savedData(sampleCV()));
    const { download, buffer } = await exportFile(page, "Export backup");
    expect(download.suggestedFilename()).toBe("Jane-Doe-CV.json");
    const backup = JSON.parse(buffer.toString());
    expect(backup.cv.header.name).toBe("Jane Doe");

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    expect(await sectionItems(page, "Skills")).toEqual([]);
    await page.getByRole("button", { name: "Export" }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Import backup/ }).click()]);
    await chooser.setFiles({ name: "backup.json", mimeType: "application/json", buffer });
    await expect(toast(page)).toContainText("Your backup has been imported.");
    expect(await sectionItems(page, "Skills")).toEqual(["SkillA", "SkillB", "SkillC"]);
    expect((await saved(page)).collection.map((item) => item.text)).toEqual(["NewSkill", "NewStatement"]);
  });

  test("rejects an invalid backup file", async ({ page }) => {
    await openWith(page, savedData(sampleCV()));
    await page.getByRole("button", { name: "Export" }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /Import backup/ }).click()]);
    await chooser.setFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{\"nope\":true}") });
    await expect(toast(page)).toContainText("That file could not be imported.");
    expect(await sectionItems(page, "Skills")).toEqual(["SkillA", "SkillB", "SkillC"]);
  });
});
