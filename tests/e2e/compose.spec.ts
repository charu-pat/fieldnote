import { expect, test, type Page } from "@playwright/test";
import {
  cvHandle,
  cvItem,
  drag,
  libraryCard,
  libraryHandle,
  markers,
  openFresh,
  openWith,
  pickUpWithKeyboard,
  pointIn,
  saved,
  section,
  sectionItems,
  subsection,
  toast,
} from "./helpers";
import { longCV, sampleCV, savedData } from "../fixtures/cv";

const open = (page: Page) => openWith(page, savedData());

test.describe("Editor basics", () => {
  test("opens in the editor with the five default drop zones (D-3)", async ({ page }) => {
    await openFresh(page);
    await expect(page.getByText("LIVE EDITOR")).toBeVisible();
    await expect(page.locator("section.cv-section .cv-section-heading .section-title")).toHaveText(["Profile / Summary", "Skills", "Experience", "Education", "Other"]);
    await expect(page.getByText("Drag an item here, or use")).toHaveCount(5);
  });

  test("header details appear in the document preview (D-8, acceptance)", async ({ page }) => {
    await openFresh(page);
    await page.getByLabel("Name", { exact: true }).fill("Sam Lee");
    await page.getByLabel("Job title").fill("Designer");
    await page.getByLabel("Email").fill("sam@example.com");
    await page.getByLabel("Phone").fill("0700 000");
    await page.getByLabel("Location").fill("Bristol");
    await page.getByLabel("Links").fill("sam.design");
    await page.getByRole("button", { name: "Preview document" }).click();
    const paper = page.locator(".cv-paper.output-preview").first();
    await expect(paper.locator(".cv-name")).toHaveText("Sam Lee");
    await expect(paper.locator(".cv-job-title")).toHaveText("Designer");
    await expect(paper.locator(".contact-line")).toHaveText("sam@example.com  |  0700 000  |  Bristol  |  sam.design");
  });
});

test.describe("Drag from the collection (D-1, D-2, D-6)", () => {
  test("drops where the insertion marker shows, and the original stays in the collection", async ({ page }) => {
    await open(page);
    await drag(page, libraryHandle(page, "NewStatement"), () => pointIn(cvItem(page, "Stmt two"), 0.3, 0.15), async () => {
      expect(await markers(page)).toEqual(["before:Stmt two"]);
      await expect(section(page, "Experience")).toHaveClass(/drop-target/);
      await expect(page.locator(".drag-overlay.statement")).toBeVisible();
    });
    expect(await sectionItems(page, "Experience")).toEqual(["Stmt one", "NewStatement", "Stmt two", "Stmt three", "Acme one", "Python"]);
    await expect(toast(page)).toContainText("Statement added to Experience, position 2.");
    await expect(libraryCard(page, "NewStatement")).toBeVisible();
    expect((await saved(page)).collection).toHaveLength(2);
  });

  test("skill chips use left/right halves, and dragged skills are pills", async ({ page }) => {
    await open(page);
    await drag(page, libraryHandle(page, "NewSkill"), () => pointIn(cvItem(page, "SkillA"), 0.9), async () => {
      expect(await markers(page)).toEqual(["before:SkillB"]);
      const overlay = page.locator(".drag-overlay.skill");
      await expect(overlay).toBeVisible();
      expect(await overlay.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("999px");
    });
    expect(await sectionItems(page, "Skills")).toEqual(["SkillA", "NewSkill", "SkillB", "SkillC"]);
  });

  test("the same item can be added more than once", async ({ page }) => {
    await open(page);
    for (let index = 0; index < 2; index++) {
      await drag(page, libraryHandle(page, "NewSkill"), () => pointIn(cvItem(page, "SkillC"), 0.9));
    }
    expect(await sectionItems(page, "Skills")).toEqual(["SkillA", "SkillB", "SkillC", "NewSkill", "NewSkill"]);
  });

  test("dropping below a group adds to its end; an empty section takes the first item", async ({ page }) => {
    await open(page);
    await drag(page, libraryHandle(page, "NewSkill"), () => pointIn(section(page, "Skills").locator(".add-subsection"), 0.1), async () => {
      expect(await markers(page)).toEqual(["after:SkillC"]);
    });
    expect(await sectionItems(page, "Skills")).toEqual(["SkillA", "SkillB", "SkillC", "NewSkill"]);

    await drag(page, libraryHandle(page, "NewStatement"), () => pointIn(section(page, "Education")), async () => {
      await expect(section(page, "Education")).toHaveClass(/drop-target/);
    });
    expect(await sectionItems(page, "Education")).toEqual(["NewStatement"]);
  });

  test("drops into a subsection", async ({ page }) => {
    await open(page);
    await drag(page, libraryHandle(page, "NewStatement"), () => pointIn(cvItem(page, "Acme one"), 0.3, 0.9), async () => {
      await expect(subsection(page, "Experience", "Acme Ltd")).toHaveClass(/drop-target/);
    });
    expect((await saved(page)).cv.sections[2].items.filter((item) => item.subsectionId === "acme").map((item) => item.text))
      .toEqual(["Acme one", "NewStatement", "Python"]);
  });

  test("dropping outside the CV does nothing", async ({ page }) => {
    await open(page);
    const before = (await saved(page)).cv;
    await drag(page, libraryHandle(page, "NewSkill"), () => pointIn(page.locator(".collection-list"), 0.5, 0.9));
    expect((await saved(page)).cv).toEqual(before);
  });
});

test.describe("Rearranging the CV (D-4, D-5)", () => {
  test("reorders within a section by dragging", async ({ page }) => {
    await open(page);
    await drag(page, cvHandle(page, "Stmt one"), () => pointIn(cvItem(page, "Stmt three"), 0.3, 0.9), async () => {
      expect(await markers(page)).toEqual(["after:Stmt three"]);
      await expect(cvItem(page, "Stmt one")).toHaveClass(/is-dragging/);
    });
    expect(await sectionItems(page, "Experience")).toEqual(["Stmt two", "Stmt three", "Stmt one", "Acme one", "Python"]);
    await expect(toast(page)).toContainText("Moved to Experience, position 3.");
  });

  test("moves an item between sections by dragging", async ({ page }) => {
    await open(page);
    await drag(page, cvHandle(page, "Stmt two"), () => pointIn(cvItem(page, "Volunteer mentor"), 0.3, 0.1));
    expect(await sectionItems(page, "Experience")).toEqual(["Stmt one", "Stmt three", "Acme one", "Python"]);
    expect(await sectionItems(page, "Other")).toEqual(["Stmt two", "Volunteer mentor"]);
  });

  test("lands on the marker even when the CV scrolls during the drag", async ({ page }) => {
    await openWith(page, savedData(longCV()));
    const stage = page.locator(".paper-stage");
    await drag(page, libraryHandle(page, "NewStatement"), async () => {
      await stage.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      return pointIn(cvItem(page, "Volunteer mentor"), 0.3, 0.15);
    }, async () => {
      expect(await stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
      expect(await markers(page)).toEqual(["before:Volunteer mentor"]);
    });
    expect(await sectionItems(page, "Other")).toEqual(["NewStatement", "Volunteer mentor"]);
  });

  test("dropping an item back on its own spot shows no marker and changes nothing", async ({ page }) => {
    await open(page);
    const before = (await saved(page)).cv;
    await drag(page, cvHandle(page, "Stmt two"), () => pointIn(cvItem(page, "Stmt three"), 0.3, 0.2), async () => {
      expect(await markers(page)).toEqual([]);
    });
    expect((await saved(page)).cv).toEqual(before);
  });

  test("removes an item with its delete control", async ({ page }) => {
    await open(page);
    await cvItem(page, "Stmt two").hover();
    await cvItem(page, "Stmt two").getByRole("button", { name: "Remove item from CV" }).click();
    expect(await sectionItems(page, "Experience")).toEqual(["Stmt one", "Stmt three", "Acme one", "Python"]);
  });

  test("CV copies are independent: editing or deleting the original leaves them alone (D-7, acceptance)", async ({ page }) => {
    await open(page);
    await drag(page, libraryHandle(page, "NewStatement"), () => pointIn(section(page, "Education")));
    await page.getByRole("button", { name: "Edit CV copy: NewStatement" }).click();
    await page.getByLabel("Edit CV item").fill("Edited copy");
    await page.getByLabel("Edit CV item").press("Control+Enter");
    expect(await sectionItems(page, "Education")).toEqual(["Edited copy"]);
    await expect(libraryCard(page, "NewStatement")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete NewStatement" }).click();
    await expect(libraryCard(page, "NewStatement")).toHaveCount(0);
    expect(await sectionItems(page, "Education")).toEqual(["Edited copy"]);
  });

  test("inline edit: Escape cancels and blank text reverts", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Edit CV copy: Stmt one" }).click();
    await page.getByLabel("Edit CV item").fill("Changed");
    await page.getByLabel("Edit CV item").press("Escape");
    await expect(cvItem(page, "Stmt one")).toBeVisible();
    await page.getByRole("button", { name: "Edit CV copy: Stmt one" }).click();
    await page.getByLabel("Edit CV item").fill("   ");
    await page.locator(".preview-toolbar").click();
    await expect(cvItem(page, "Stmt one")).toBeVisible();
  });
});

test.describe("Keyboard alternative (A-1, acceptance)", () => {
  test("adds an item to a chosen section with the + control and the keyboard", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Choose a section for NewSkill" }).focus();
    await page.keyboard.press("Enter");
    const picker = page.getByLabel("Add copy to");
    await expect(picker).toBeFocused();
    await picker.selectOption({ label: "Education" });
    expect(await sectionItems(page, "Education")).toEqual(["NewSkill"]);
    await expect(toast(page)).toContainText("Skill added to Education, position 1.");
  });

  test("moves items with the up/down controls", async ({ page }) => {
    await open(page);
    await cvItem(page, "Stmt one").getByRole("button", { name: "Move item down" }).focus();
    await page.keyboard.press("Enter");
    expect(await sectionItems(page, "Experience")).toEqual(["Stmt two", "Stmt one", "Stmt three", "Acme one", "Python"]);
    await cvItem(page, "Stmt three").getByRole("button", { name: "Move item up" }).focus();
    await page.keyboard.press("Enter");
    expect(await sectionItems(page, "Experience")).toEqual(["Stmt two", "Stmt three", "Stmt one", "Acme one", "Python"]);
    await expect(cvItem(page, "Stmt two").getByRole("button", { name: "Move item up" })).toBeDisabled();
  });

  test("drags with the keyboard: Space, arrows, Space", async ({ page }) => {
    await open(page);
    await pickUpWithKeyboard(page, "SkillA");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => markers(page)).toEqual(["before:SkillC"]);
    await page.keyboard.press("Space");
    await expect.poll(() => sectionItems(page, "Skills")).toEqual(["SkillB", "SkillA", "SkillC"]);

    await pickUpWithKeyboard(page, "Stmt one");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => markers(page)).toEqual(["before:Stmt three"]);
    await page.keyboard.press("Space");
    await expect.poll(() => sectionItems(page, "Experience")).toEqual(["Stmt two", "Stmt one", "Stmt three", "Acme one", "Python"]);
  });

  test("Escape cancels a keyboard drag", async ({ page }) => {
    await open(page);
    await pickUpWithKeyboard(page, "SkillA");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => markers(page)).toEqual(["before:SkillC"]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".drag-overlay")).toHaveCount(0);
    expect(await sectionItems(page, "Skills")).toEqual(["SkillA", "SkillB", "SkillC"]);
  });
});

test.describe("Sections and subsections (D-9)", () => {
  test("renames, adds, reorders and removes sections", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Rename Other section" }).click();
    await page.getByLabel("Rename section").fill("Interests");
    await page.getByLabel("Rename section").press("Enter");
    await expect(section(page, "Interests")).toBeVisible();

    await page.getByRole("button", { name: "Add section" }).click();
    await expect(section(page, "New section")).toBeVisible();

    await section(page, "Skills").getByRole("button", { name: "Move section up" }).click();
    await expect(page.locator("section.cv-section .cv-section-heading .section-title").first()).toHaveText("Skills");

    await page.getByRole("button", { name: "Remove New section section" }).click();
    await expect(section(page, "New section")).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Remove Interests section" }).click();
    await expect(section(page, "Interests")).toBeVisible();
  });

  test("adds a dated subsection; removing it keeps its items in the parent section", async ({ page }) => {
    await open(page);
    await section(page, "Education").getByRole("button", { name: "Add subsection" }).click();
    await page.getByLabel("New subsection name in Education").fill("University of Leeds");
    await page.getByLabel("Subsection dates").fill("2010-2013");
    await section(page, "Education").getByRole("button", { name: "Add subsection" }).click();
    await expect(page.getByLabel("Dates for University of Leeds")).toHaveValue("2010-2013");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove Acme Ltd subsection" }).click();
    await expect(subsection(page, "Experience", "Acme Ltd")).toHaveCount(0);
    expect(await sectionItems(page, "Experience")).toEqual(["Stmt one", "Stmt two", "Stmt three", "Acme one", "Python"]);
    expect((await saved(page)).cv.sections[2].items.every((item) => item.subsectionId === null)).toBe(true);
  });

  test("renames a section by Enter or clicking away; blank names are ignored", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Rename Skills section" }).click();
    await page.getByLabel("Rename section").fill("Core skills");
    await page.getByLabel("Rename section").press("Enter");
    await expect(section(page, "Core skills")).toBeVisible();

    await page.getByRole("button", { name: "Rename Core skills section" }).click();
    await page.getByLabel("Rename section").fill("Key skills");
    await page.locator(".preview-toolbar").click();
    await expect(section(page, "Key skills")).toBeVisible();

    await page.getByRole("button", { name: "Rename Key skills section" }).click();
    await page.getByLabel("Rename section").fill("   ");
    await page.getByLabel("Rename section").press("Enter");
    await expect(section(page, "Key skills")).toBeVisible();
    await page.getByRole("button", { name: "Rename Key skills section" }).click();
    await expect(page.getByLabel("Rename section")).toHaveValue("Key skills");
  });

  test("edits subsection names and dates inline; a duplicate or blank name reverts", async ({ page }) => {
    await open(page);
    await section(page, "Experience").getByRole("button", { name: "Add subsection" }).click();
    await page.getByLabel("New subsection name in Experience").fill("Beta Inc");
    await section(page, "Experience").locator(".subsection-form").getByRole("button", { name: "Add subsection" }).click();

    const name = page.getByLabel("Subsection name: Beta Inc");
    await name.fill("ACME LTD");
    await name.press("Enter");
    await expect(toast(page)).toContainText("That subsection name already exists.");
    await expect(name).toHaveValue("Beta Inc");
    await name.fill("  ");
    await name.press("Enter");
    await expect(name).toHaveValue("Beta Inc");

    await page.getByLabel("Dates for Beta Inc").fill(" 2015-2018 ");
    await page.getByLabel("Dates for Beta Inc").press("Enter");
    await expect.poll(async () => (await saved(page)).cv.sections[2].subsections[1].dates).toBe("2015-2018");
    await expect(page.getByLabel("Dates for Beta Inc")).toHaveValue("2015-2018");
  });

  test("statement placement tags follow section and subsection renames", async ({ page }) => {
    await openWith(page, savedData(sampleCV(), [{ id: "T1", type: "statement", text: "Tagged", placement: { sectionTitle: "Experience", subsectionTitle: "Acme Ltd" } }]));
    await page.getByLabel("Subsection name: Acme Ltd").fill("Acme Group");
    await page.getByLabel("Subsection name: Acme Ltd").press("Enter");
    await page.getByRole("button", { name: "Rename Experience section" }).click();
    await page.getByLabel("Rename section").fill("Work history");
    await page.getByLabel("Rename section").press("Enter");
    await expect(libraryCard(page, "Tagged")).toContainText("Work history / Acme Group");
    expect((await saved(page)).collection[0].placement).toEqual({ sectionTitle: "Work history", subsectionTitle: "Acme Group" });
  });

  test("rejects a duplicate subsection name", async ({ page }) => {
    await open(page);
    await section(page, "Experience").getByRole("button", { name: "Add subsection" }).click();
    await page.getByLabel("New subsection name in Experience").fill("acme ltd");
    await section(page, "Experience").locator(".subsection-form").getByRole("button", { name: "Add subsection" }).click();
    await expect(toast(page)).toContainText("That subsection already exists.");
  });
});

test("CV edits persist across a reload (C-5, section 7 reliability)", async ({ page }) => {
  await openWith(page, savedData(sampleCV()));
  await drag(page, libraryHandle(page, "NewSkill"), () => pointIn(section(page, "Education")));
  await page.getByLabel("Name", { exact: true }).fill("Persisted Name");
  await page.reload();
  expect(await sectionItems(page, "Education")).toEqual(["NewSkill"]);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Persisted Name");
});
