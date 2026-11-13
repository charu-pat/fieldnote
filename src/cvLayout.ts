import { CV_DOCUMENT, cvOutline, contactLine, SKILL_SEPARATOR, type CVData } from "./cvModel";

export type TextMeasurer = { font: string; measureText(text: string): { width: number } };

export type OutputBlock = {
  kind: "section" | "subsection" | "item" | "skills";
  text: string;
  lines: string[];
  size: number;
  bold: boolean;
  color: string;
  beforeMm: number;
  afterMm: number;
  indentMm: number;
  keepWithNext: boolean;
};
export type HeaderBlock = { kind: "name" | "title" | "contact" | "rule"; text: string; lines: string[]; size: number; bold: boolean; color: string; afterMm: number };
export type OutputPage = { header: HeaderBlock[]; blocks: OutputBlock[] };

/** Height of text lines in millimetres at a 1.3 line height (points to mm × 1.3). */
export const linesHeightMm = (lineCount: number, sizePt: number) => lineCount * sizePt * 0.46;

let canvasContext: CanvasRenderingContext2D | null = null;
const defaultMeasurer = () => {
  canvasContext ??= document.createElement("canvas").getContext("2d");
  if (!canvasContext) throw new Error("Could not measure CV text for the document preview.");
  return canvasContext;
};

export function layoutCV(cv: CVData, pageWidthPx: number, measurer?: TextMeasurer): OutputPage[] {
  const isA4 = cv.pageSize === "A4";
  const pageWidthMm = isA4 ? 210 : 215.9;
  const pageHeightMm = isA4 ? 297 : 279.4;
  const scale = pageWidthPx / pageWidthMm;
  const contentWidthPx = (pageWidthMm - CV_DOCUMENT.marginMm * 2) * scale;
  const contentHeightPx = (pageHeightMm - CV_DOCUMENT.marginMm * 2 - CV_DOCUMENT.topOffsetMm) * scale;
  const context: TextMeasurer = measurer ?? defaultMeasurer();

  const wrap = (text: string, size: number, bold: boolean, width: number) => {
    context.font = `${bold ? "700" : "400"} ${size * 25.4 / 72 * scale}px Arial`;
    const lines: string[] = [];
    let line = "";
    const splitLongWord = (word: string) => {
      let fragment = "";
      for (const character of word) {
        if (fragment && context.measureText(fragment + character).width > width) {
          lines.push(fragment);
          fragment = character;
        } else fragment += character;
      }
      line = fragment;
    };
    for (const word of text.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = "";
        if (context.measureText(word).width <= width) line = word;
        else splitLongWord(word);
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };
  // Skills arrive whitespace-normalised from cvOutline.
  const wrapSkills = (skills: string[], size: number, width: number) => {
    context.font = `400 ${size * 25.4 / 72 * scale}px Arial`;
    const lines: string[] = [];
    let line = "";
    for (const skill of skills) {
      const candidate = line ? `${line}${SKILL_SEPARATOR}${skill}` : skill;
      if (context.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // wrap() leaves the context on this same regular font.
      const skillLines = wrap(skill, size, false, width);
      lines.push(...skillLines.slice(0, -1));
      line = skillLines[skillLines.length - 1];
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };
  const header: HeaderBlock[] = [];
  const addHeader = (kind: HeaderBlock["kind"], text: string, size: number, bold: boolean, color: string, afterMm: number) => {
    if (!text) return;
    header.push({ kind, text, lines: kind === "rule" ? [] : wrap(text, size, bold, contentWidthPx), size, bold, color, afterMm });
  };
  addHeader("name", cv.header.name, CV_DOCUMENT.nameSize, true, "1D2720", 2);
  addHeader("title", cv.header.title, CV_DOCUMENT.titleSize, false, "5F7A66", 2);
  addHeader("contact", contactLine(cv.header), CV_DOCUMENT.contactSize, false, "626C63", 2);
  if (header.length) addHeader("rule", " ", 0, false, "E8EBE6", 6);

  let page: OutputPage = { header, blocks: [] };
  const pages = [page];
  const blockHeight = (block: OutputBlock) =>
    (block.beforeMm + linesHeightMm(block.lines.length, block.size) + block.afterMm) * scale;
  let headerUsed = header.reduce((sum, current) =>
    sum + (current.kind === "rule" ? current.afterMm : linesHeightMm(current.lines.length, current.size) + current.afterMm) * scale, 0);
  let blocksUsed = 0;
  const addBlock = (block: OutputBlock, nextBlock?: OutputBlock) => {
    const nextHeight = block.keepWithNext && nextBlock ? blockHeight(nextBlock) : 0;
    const used = blocksUsed + headerUsed;
    // Start a new page unless this page is completely empty (an oversized block has to go somewhere).
    if (used + blockHeight(block) + nextHeight > contentHeightPx && (page.blocks.length || used > 0)) {
      page = { header: [], blocks: [] };
      pages.push(page);
      headerUsed = 0;
      blocksUsed = 0;
      block = { ...block, beforeMm: 0 };
    }
    page.blocks.push(block);
    blocksUsed += blockHeight(block);
  };
  const itemBlock = (kind: "item" | "skills", text: string, lines: string[]): OutputBlock => ({
    kind,
    text,
    lines,
    size: CV_DOCUMENT.itemSize,
    bold: false,
    color: "37433A",
    beforeMm: 0,
    afterMm: 2,
    indentMm: 1,
    keepWithNext: false,
  });
  const blocks: OutputBlock[] = cvOutline(cv).map((entry) => {
    if (entry.kind === "section") {
      const text = entry.text.toLocaleUpperCase();
      return {
        kind: "section",
        text,
        lines: wrap(text, CV_DOCUMENT.sectionSize, true, contentWidthPx),
        size: CV_DOCUMENT.sectionSize,
        bold: true,
        color: "385344",
        beforeMm: entry.isFirst ? 0 : 4,
        afterMm: 6,
        indentMm: 0,
        keepWithNext: entry.hasContent,
      };
    }
    if (entry.kind === "subsection") return {
      kind: "subsection",
      text: entry.text,
      lines: wrap(entry.text, CV_DOCUMENT.subsectionSize, true, contentWidthPx - scale),
      size: CV_DOCUMENT.subsectionSize,
      bold: true,
      color: "44594A",
      beforeMm: 3,
      afterMm: 2,
      indentMm: 1,
      keepWithNext: entry.hasContent,
    };
    if (entry.kind === "skills") {
      return itemBlock("skills", entry.skills.join(SKILL_SEPARATOR), wrapSkills(entry.skills, CV_DOCUMENT.itemSize, contentWidthPx - scale));
    }
    return itemBlock("item", entry.text, wrap(`•  ${entry.text}`, CV_DOCUMENT.itemSize, false, contentWidthPx - scale));
  });
  blocks.forEach((block, index) => addBlock(block, blocks[index + 1]));
  return pages;
}