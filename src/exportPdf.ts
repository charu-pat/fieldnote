import { jsPDF } from "jspdf";
import { CV_DOCUMENT, type CVData } from "./cvModel";
import { layoutCV, linesHeightMm, type TextMeasurer } from "./cvLayout";

/** Draws the paginated CV layout as real, selectable PDF text. */
export function buildPdf(cv: CVData, measurer?: TextMeasurer): jsPDF {
  const pdf = new jsPDF({ unit: "mm", format: cv.pageSize.toLowerCase() as "a4" | "letter" });
  const pageWidth = cv.pageSize === "A4" ? 210 : 215.9;
  const margin = CV_DOCUMENT.marginMm;
  const pages = layoutCV(cv, 700, measurer);
  pages.forEach((page, pageIndex) => {
    if (pageIndex) pdf.addPage();
    let y = margin + CV_DOCUMENT.topOffsetMm;
    const drawLines = (lines: string[], size: number, bold: boolean, color: string, indentMm: number) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(size);
      pdf.setTextColor(`#${color}`);
      pdf.text(lines, margin + indentMm, y, { baseline: "top", lineHeightFactor: 1.3 });
      y += linesHeightMm(lines.length, size);
    };
    page.header.forEach((block) => {
      if (block.kind === "rule") {
        pdf.setDrawColor(232, 235, 230);
        pdf.setLineWidth(0.25);
        pdf.line(margin, y, pageWidth - margin, y);
        y += block.afterMm;
        return;
      }
      drawLines(block.lines, block.size, block.bold, block.color, 0);
      y += block.afterMm;
    });
    page.blocks.forEach((block) => {
      y += block.beforeMm;
      drawLines(block.lines, block.size, block.bold, block.color, block.indentMm);
      if (block.kind === "section") {
        y += 3;
        pdf.setDrawColor(163, 177, 138);
        pdf.setLineWidth(0.35);
        pdf.line(margin, y - 2, pageWidth - margin, y - 2);
        y += 3;
      } else y += block.afterMm;
    });
  });
  return pdf;
}
