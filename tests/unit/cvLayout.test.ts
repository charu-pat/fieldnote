import { describe, expect, it } from "vitest";
import { CV_DOCUMENT, cvOutline, SKILL_SEPARATOR, type CVData } from "../../src/cvModel";
import { layoutCV, type OutputBlock, type OutputPage } from "../../src/cvLayout";
import { longCV, sampleCV, skill, stubMeasurer } from "../fixtures/cv";

const layout = (cv: CVData) => layoutCV(cv, 700, stubMeasurer());

const blockHeightMm = (block: OutputBlock) => block.beforeMm + block.lines.length * block.size * 0.46 + block.afterMm;
const pageCapacityMm = (cv: CVData) => (cv.pageSize === "A4" ? 297 : 279.4) - CV_DOCUMENT.marginMm * 2 - CV_DOCUMENT.topOffsetMm;
const headerHeightMm = (page: OutputPage) => page.header.reduce((sum, block) =>
  sum + (block.kind === "rule" ? block.afterMm : block.lines.length * block.size * 0.46 + block.afterMm), 0);
const allBlocks = (pages: OutputPage[]) => pages.flatMap((page) => page.blocks);

describe("layoutCV header", () => {
  it("includes name, title, a joined contact line and a rule", () => {
    const [page] = layout(sampleCV());
    expect(page.header.map((block) => block.kind)).toEqual(["name", "title", "contact", "rule"]);
    expect(page.header[2].text).toBe("jane@example.com  |  0123 456  |  London  |  linkedin.com/in/jane");
  });

  it("omits empty header fields and the rule when the header is blank", () => {
    const cv = sampleCV();
    cv.header = { name: "", title: "", email: "", phone: "", location: "", links: "" };
    expect(layout(cv)[0].header).toEqual([]);
  });
});

describe("layoutCV content (D-10, E-3)", () => {
  it("renders section headings in capitals, statements as bullets and skills as one joined line", () => {
    const blocks = allBlocks(layout(sampleCV()));
    expect(blocks.filter((block) => block.kind === "section").map((block) => block.text))
      .toEqual(["PROFILE / SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION", "OTHER"]);
    // Wrapping normalises whitespace, so the bullet is followed by a single space.
    expect(blocks.find((block) => block.text === "Stmt one")!.lines).toEqual(["• Stmt one"]);
    const skills = blocks.find((block) => block.kind === "skills")!;
    expect(skills.text).toBe(["SkillA", "SkillB", "SkillC"].join(SKILL_SEPARATOR));
    expect(skills.lines).toEqual([skills.text]);
  });

  it("follows the shared outline exactly, in order", () => {
    const cv = sampleCV();
    const expected = cvOutline(cv).map((entry) =>
      entry.kind === "section" ? entry.text.toLocaleUpperCase()
        : entry.kind === "skills" ? entry.skills.join(SKILL_SEPARATOR)
        : entry.text);
    expect(allBlocks(layout(cv)).map((block) => block.text)).toEqual(expected);
  });

  it("wraps long skill lists between skills, never inside one", () => {
    const cv = sampleCV();
    const names = Array.from({ length: 30 }, (_, index) => `Skill number ${index + 1}`);
    cv.sections[1].items = names.map((name, index) => skill(`k${index}`, name));
    const skills = allBlocks(layout(cv)).find((block) => block.kind === "skills")!;
    expect(skills.lines.length).toBeGreaterThan(1);
    expect(skills.lines.flatMap((line) => line.split(SKILL_SEPARATOR))).toEqual(names);
  });

  it("keeps an empty section's heading but does not keep it with the next block", () => {
    const education = allBlocks(layout(sampleCV())).find((block) => block.text === "EDUCATION")!;
    expect(education.keepWithNext).toBe(false);
  });
});

describe("layoutCV pagination (E-5)", () => {
  for (const pageSize of ["A4", "Letter"] as const) {
    describe(pageSize, () => {
      const cv = { ...longCV(), pageSize };
      const pages = layout(cv);

      it("flows a long CV onto more than one page", () => {
        expect(pages.length).toBeGreaterThan(1);
        expect(pages.slice(1).every((page) => page.header.length === 0)).toBe(true);
      });

      it("never overfills a page", () => {
        pages.forEach((page) => {
          const used = headerHeightMm(page) + page.blocks.reduce((sum, block) => sum + blockHeightMm(block), 0);
          expect(used).toBeLessThanOrEqual(pageCapacityMm(cv) + 0.001);
        });
      });

      it("never leaves a heading with content at the bottom of a page", () => {
        pages.slice(0, -1).forEach((page) => {
          const last = page.blocks.at(-1)!;
          expect(last.keepWithNext).toBe(false);
        });
      });

      it("keeps every item whole and in order across pages", () => {
        const flat = allBlocks(pages).map((block) => block.text);
        expect(flat).toEqual(allBlocks(layout({ ...cv, pageSize: "A4" })).map((block) => block.text));
        expect(new Set(flat.filter((text) => /^\d+\. /.test(text))).size).toBe(22);
      });

      it("drops the top spacing of the first block on a new page", () => {
        pages.slice(1).forEach((page) => expect(page.blocks[0].beforeMm).toBe(0));
      });
    });
  }

  it("needs at least as many Letter pages as A4 pages (Letter is shorter)", () => {
    const cv = longCV(40);
    expect(layout({ ...cv, pageSize: "Letter" }).length).toBeGreaterThanOrEqual(layout(cv).length);
  });
});
