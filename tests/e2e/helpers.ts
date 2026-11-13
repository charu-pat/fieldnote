import { expect, type Download, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import type { SavedData } from "../../src/cvModel";

export const STORAGE_KEY = "fieldnote-cv-v1";

/** Opens the app with a clean browser store (empty collection, default CV). */
export async function openFresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#new-item-text")).toBeVisible();
}

/** Opens the app with saved data already in local storage. */
export async function openWith(page: Page, data: SavedData) {
  await page.goto("/");
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(data)]);
  await page.reload();
  await expect(page.locator("#new-item-text")).toBeVisible();
}

/** The visible confirmation toast (dnd-kit adds its own hidden role="status" region, so target the toast). */
export const toast = (page: Page) => page.locator(".toast");

export const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), STORAGE_KEY) as Promise<SavedData>;

export const section = (page: Page, title: string) =>
  page.locator("section.cv-section").filter({ has: page.locator(".cv-section-heading .section-title", { hasText: new RegExp(`^${title}$`) }) });

/** Texts of the CV items in a section (including its subsections), in display order. */
export const sectionItems = async (page: Page, title: string) =>
  (await section(page, title).locator("[data-cv-item-id]").allInnerTexts()).map((text) => text.trim());

export const subsection = (page: Page, sectionTitle: string, subsectionTitle: string) =>
  section(page, sectionTitle).locator(".cv-subsection").filter({ has: page.locator(`input[value="${subsectionTitle}"]`) });

export const cvItem = (page: Page, text: string) =>
  page.locator("[data-cv-item-id]").filter({ hasText: new RegExp(`^${text}$`) });

export const libraryCard = (page: Page, text: string) =>
  page.locator(".library-card").filter({ hasText: text });

export const markers = (page: Page) =>
  page.locator(".marker-before, .marker-after").evaluateAll((elements) =>
    elements.map((element) => `${element.classList.contains("marker-before") ? "before" : "after"}:${(element as HTMLElement).innerText.trim()}`));

type Point = { x: number; y: number };

/**
 * Real pointer drag: press on the handle, move in steps to the target, run `whileOver` with the drag still
 * active (e.g. to inspect the insertion marker), then release.
 */
export async function drag(page: Page, handle: Locator, to: Point | (() => Promise<Point>), whileOver?: () => Promise<void>) {
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 });
  const target = typeof to === "function" ? await to() : to;
  await page.mouse.move(target.x, target.y, { steps: 15 });
  if (whileOver) await whileOver();
  await page.mouse.up();
  // dnd-kit swallows clicks for 50 ms after a drop so the release isn't treated as a click. Real users
  // can't click that fast, but Playwright can, so wait it out before the next interaction.
  await page.waitForTimeout(80);
}

/** Points relative to an element's box: fractions of its width and height. Scrolls the element into view first. */
export async function pointIn(locator: Locator, fx = 0.5, fy = 0.5): Promise<Point> {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Picks up a CV item with the keyboard and waits until the drag is live (arrow keys are ignored until then). */
export async function pickUpWithKeyboard(page: Page, text: string) {
  // Let any previous drop animation finish so only this drag's overlay is present.
  await expect(page.locator(".drag-overlay")).toHaveCount(0);
  await cvItem(page, text).locator(".draft-grip").focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".drag-overlay")).toHaveCount(1);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

export const libraryHandle = (page: Page, text: string) => libraryCard(page, text).locator(".drag-handle");
export const cvHandle = (page: Page, text: string) => cvItem(page, text).locator(".draft-grip");

export async function exportFile(page: Page, label: "Download PDF" | "Download Word" | "Export backup"): Promise<{ download: Download; buffer: Buffer }> {
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: new RegExp(label) }).click()]);
  return { download, buffer: await readFile((await download.path())!) };
}

export async function docxParagraphs(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  return [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(([, body]) => ({
    style: /<w:pStyle w:val="([^"]+)"/.exec(body)?.[1] ?? null,
    list: body.includes("<w:numPr>"),
    text: [...body.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(""),
  }));
}

/** Text runs drawn in an (uncompressed) jsPDF file, in drawing order. */
export const pdfTextRuns = (buffer: Buffer) =>
  [...buffer.toString("latin1").matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((match) => match[1].replace(/\\([()\\])/g, "$1"));

/** Lines shown on the paginated document preview, in page order. */
export async function previewLines(page: Page) {
  await page.getByRole("button", { name: "Preview document" }).click();
  await expect(page.getByText("DOCUMENT PREVIEW")).toBeVisible();
  const lines = await page.locator(".cv-paper.output-preview .cv-output-lines > span").allInnerTexts();
  await page.getByRole("button", { name: "Edit CV" }).click();
  return lines;
}
