import { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import { contactLine, cvOutline, CV_DOCUMENT, SKILL_SEPARATOR, type CVData } from "./cvModel";

/** Builds an editable Word document with real heading styles and a bulleted list, from the shared CV outline. */
export function buildDocxDocument(cv: CVData): Document {
  const { header, pageSize } = cv;
  const docxSize = (points: number) => points * 2;
  const twips = (millimeters: number) => Math.round(millimeters * 1440 / 25.4);
  const bulletHangMm = 3.2;
  const itemIndentMm = 1;

  // Word handles line wrapping and pagination; headings keep with the next paragraph and items never split.
  const headerLines: { text: string; style?: string; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel] }[] = [];
  if (header.name) headerLines.push({ text: header.name, heading: HeadingLevel.TITLE });
  if (header.title) headerLines.push({ text: header.title, style: "CVJobTitle" });
  if (contactLine(header)) headerLines.push({ text: contactLine(header), style: "CVContact" });
  const children: Paragraph[] = headerLines.map((line, index) => {
    const isLast = index === headerLines.length - 1;
    return new Paragraph({
      heading: line.heading,
      style: line.style,
      children: [new TextRun(line.text)],
      border: isLast ? { bottom: { color: "E8EBE6", style: BorderStyle.SINGLE, size: 4, space: 6 } } : undefined,
      spacing: isLast ? { after: twips(6) } : undefined,
    });
  });

  cvOutline(cv).forEach((entry) => {
    if (entry.kind === "section") {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(entry.text)],
        keepNext: entry.hasContent,
        spacing: entry.isFirst ? { before: 0 } : undefined,
      }));
    } else if (entry.kind === "subsection") {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(entry.text)],
        keepNext: entry.hasContent,
      }));
    } else if (entry.kind === "skills") {
      children.push(new Paragraph({ style: "CVSkills", children: [new TextRun(entry.skills.join(SKILL_SEPARATOR))] }));
    } else {
      children.push(new Paragraph({
        style: "ListParagraph",
        numbering: { reference: "cv-bullets", level: 0 },
        children: [new TextRun(entry.text)],
      }));
    }
  });

  const doc = new Document({
    creator: header.name || undefined,
    title: header.name ? `${header.name} CV` : "CV",
    styles: {
      default: {
        document: {
          run: { font: CV_DOCUMENT.font, size: docxSize(CV_DOCUMENT.itemSize), color: "37433A" },
          paragraph: { spacing: { line: 312 } },
        },
        title: {
          run: { font: CV_DOCUMENT.font, size: docxSize(CV_DOCUMENT.nameSize), bold: true, color: "1D2720" },
          paragraph: { spacing: { before: 0, after: twips(2), line: 312 } },
        },
        heading1: {
          run: { font: CV_DOCUMENT.font, size: docxSize(CV_DOCUMENT.sectionSize), bold: true, allCaps: true, color: "385344" },
          paragraph: {
            border: { bottom: { color: "A3B18A", style: BorderStyle.SINGLE, size: 4, space: 4 } },
            spacing: { before: twips(4), after: twips(6 - 1.35), line: 312 },
            keepNext: true,
            keepLines: true,
          },
        },
        heading2: {
          run: { font: CV_DOCUMENT.font, size: docxSize(CV_DOCUMENT.subsectionSize), bold: true, color: "44594A" },
          paragraph: {
            indent: { left: twips(itemIndentMm) },
            spacing: { before: twips(3), after: twips(2), line: 312 },
            keepNext: true,
            keepLines: true,
          },
        },
        listParagraph: {
          run: { font: CV_DOCUMENT.font, size: docxSize(CV_DOCUMENT.itemSize), color: "37433A" },
          paragraph: { spacing: { before: 0, after: twips(2), line: 312 }, keepLines: true },
        },
      },
      paragraphStyles: [
        {
          id: "CVJobTitle",
          name: "Job Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: docxSize(CV_DOCUMENT.titleSize), color: "5F7A66" },
          paragraph: { spacing: { after: twips(2) } },
        },
        {
          id: "CVContact",
          name: "Contact Details",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: docxSize(CV_DOCUMENT.contactSize), color: "626C63" },
          paragraph: { spacing: { after: twips(2) } },
        },
        {
          id: "CVSkills",
          name: "Skills",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          paragraph: { indent: { left: twips(itemIndentMm) }, spacing: { after: twips(2) }, keepLines: true },
        },
      ],
    },
    numbering: {
      config: [{
        reference: "cv-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "•",
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: twips(itemIndentMm + bulletHangMm), hanging: twips(bulletHangMm) } },
            run: { font: CV_DOCUMENT.font, color: "37433A" },
          },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: pageSize === "A4" ? 11906 : 12240, height: pageSize === "A4" ? 16838 : 15840 },
          margin: {
            top: twips(CV_DOCUMENT.marginMm + CV_DOCUMENT.topOffsetMm),
            bottom: twips(CV_DOCUMENT.marginMm),
            left: twips(CV_DOCUMENT.marginMm),
            right: twips(CV_DOCUMENT.marginMm),
          },
        },
      },
      children,
    }],
  });
  return doc;
}

export const docxBlob = (cv: CVData) => Packer.toBlob(buildDocxDocument(cv));
