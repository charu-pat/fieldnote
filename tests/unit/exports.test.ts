import JSZip from "jszip";
import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import { cvOutline, SKILL_SEPARATOR, type CVData } from "../../src/cvModel";
import { layoutCV } from "../../src/cvLayout";
import { buildDocxDocument } from "../../src/exportDocx";
import { buildPdf } from "../../src/exportPdf";
import { longCV, sampleCV, stubMeasurer } from "../fixtures/cv";

type DocxParagraph = { style: string | null; list: boolean; text: string };

async function docxParts(cv: CVData) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocxDocument(cv)));
  const read = (path: string) => zip.file(path)!.async("string");
  const document = await read("word/document.xml");
  const paragraphs: DocxParagraph[] = [...document.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(([, body]) => ({
    style: /<w:pStyle w:val="([^"]+)"/.exec(body)?.[1] ?? null,
    list: body.includes("<w:numPr>"),
    text: [...body.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(""),
  }));
  return { document, paragraphs, styles: await read("word/styles.xml"), numbering: await read("word/numbering.xml") };
}

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");

describe("Word export (E-2, E-3, E-4, E-5)", () => {
  it("uses Title, Heading 1, Heading 2, a bulleted list and the Skills style", async () => {
    const { paragraphs } = await docxParts(sampleCV());
    const byStyle = (style: string) => paragraphs.filter((paragraph) => paragraph.style === style).map((paragraph) => decode(paragraph.text));
    expect(byStyle("Title")).toEqual(["Jane Doe"]);
    expect(byStyle("CVJobTitle")).toEqual(["Product Lead"]);
    expect(byStyle("CVContact")).toEqual(["jane@example.com  |  0123 456  |  London  |  linkedin.com/in/jane"]);
    expect(byStyle("Heading1")).toEqual(["Profile / Summary", "Skills", "Experience", "Education", "Other"]);
    expect(byStyle("Heading2")).toEqual(["Acme Ltd  |  2020-2023"]);
    expect(byStyle("CVSkills")).toEqual(["SkillA  ·  SkillB  ·  SkillC", "Python"]);
    const bullets = paragraphs.filter((paragraph) => paragraph.list);
    expect(bullets.map((paragraph) => paragraph.text)).toEqual(["Product leader with ten years of experience.", "Stmt one", "Stmt two", "Stmt three", "Acme one", "Volunteer mentor"]);
    expect(bullets.every((paragraph) => paragraph.style === "ListParagraph")).toBe(true);
  });

  it("matches the shared outline wording and order", async () => {
    const cv = sampleCV();
    const { paragraphs } = await docxParts(cv);
    const expected = cvOutline(cv).map((entry) => entry.kind === "skills" ? entry.skills.join(SKILL_SEPARATOR) : entry.text);
    expect(paragraphs.slice(3).map((paragraph) => decode(paragraph.text))).toEqual(expected);
  });

  it("lets Word wrap and paginate: no manual line or page breaks", async () => {
    const { document } = await docxParts(longCV());
    expect(document).not.toMatch(/<w:br\b/);
    expect(document).not.toContain("<w:pageBreakBefore");
  });

  it("keeps headings with their content and items on one page", async () => {
    const { styles, document } = await docxParts(sampleCV());
    const style = (id: string) => new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`).exec(styles)![0];
    expect(style("Heading1")).toContain("<w:keepNext/>");
    expect(style("Heading1")).toContain("<w:caps/>");
    expect(style("Heading2")).toContain("<w:keepNext/>");
    expect(style("ListParagraph")).toContain("<w:keepLines/>");
    // An empty section heading must not chain onto the next section.
    const education = /<w:p>(?:(?!<\/w:p>)[\s\S])*Education<\/w:t>/.exec(document)![0];
    expect(education).toMatch(/<w:keepNext w:val="(false|0)"\/>/);
  });

  it("defines a real bullet list with a hanging indent", async () => {
    const { numbering } = await docxParts(sampleCV());
    expect(numbering).toMatch(/<w:numFmt w:val="bullet"\/>\s*<w:lvlText w:val="•"\/>/);
    expect(numbering).toMatch(/<w:ind w:left="\d+" w:hanging="\d+"\/>/);
  });

  it("sets the page size from the CV", async () => {
    expect((await docxParts(sampleCV())).document).toContain('<w:pgSz w:w="11906" w:h="16838"');
    expect((await docxParts(sampleCV({ pageSize: "Letter" }))).document).toContain('<w:pgSz w:w="12240" w:h="15840"');
  });

  it("preserves accented and typographic characters as text", async () => {
    const cv = sampleCV();
    cv.sections[0].items[0].text = "Café résumé — “quoted” & <tagged>";
    const { paragraphs } = await docxParts(cv);
    expect(paragraphs.map((paragraph) => decode(paragraph.text))).toContain("Café résumé — “quoted” & <tagged>");
  });

  it("omits header paragraphs that are empty", async () => {
    const cv = sampleCV();
    cv.header = { ...cv.header, title: "", email: "", phone: "", location: "", links: "" };
    const { paragraphs } = await docxParts(cv);
    expect(paragraphs[0]).toMatchObject({ style: "Title", text: "Jane Doe" });
    expect(paragraphs[1].style).toBe("Heading1");
  });
});

describe("PDF export (E-1, E-3, E-4, E-5, E-6)", () => {
  const textRuns = (raw: string) => [...raw.matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((match) => match[1].replace(/\\([()\\])/g, "$1"));

  it("draws every layout line as real text, in layout order", () => {
    const cv = longCV();
    const measurer = stubMeasurer();
    const expected = layoutCV(cv, 700, stubMeasurer()).flatMap((page) =>
      [...page.header.filter((block) => block.kind !== "rule"), ...page.blocks].flatMap((block) => block.lines));
    const raw = buildPdf(cv, measurer).output();
    expect(textRuns(raw).filter((text) => /^[\x20-\x7e]*$/.test(text))).toEqual(expected.filter((text) => /^[\x20-\x7e]*$/.test(text)));
  });

  it("has the same page count as the preview layout", () => {
    const cv = longCV();
    const pages = layoutCV(cv, 700, stubMeasurer()).length;
    expect(pages).toBeGreaterThan(1);
    expect(buildPdf(cv, stubMeasurer()).getNumberOfPages()).toBe(pages);
  });

  it("uses the selected page size", () => {
    const a4 = buildPdf(sampleCV(), stubMeasurer()).internal.pageSize;
    expect([Math.round(a4.getWidth()), Math.round(a4.getHeight())]).toEqual([210, 297]);
    const letter = buildPdf(sampleCV({ pageSize: "Letter" }), stubMeasurer()).internal.pageSize;
    expect([Math.round(letter.getWidth() * 10), Math.round(letter.getHeight() * 10)]).toEqual([2159, 2794]);
  });
});
