// generatePdf.js (NO puppeteer, works on Render)
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function generatePdfFromJson(report) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([620, 820]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 780;

  // Header
  page.drawRectangle({
    x: 0,
    y: 780,
    width: 620,
    height: 40,
    color: rgb(0, 0.26, 0.55),
  });

  page.drawText("VEHICLE HISTORY REPORT", {
    x: 20,
    y: 790,
    size: 20,
    font: bold,
    color: rgb(1, 1, 1),
  });

  y -= 60;

  // VIN
  page.drawText("VIN:", { x: 20, y, size: 14, font: bold });
  page.drawText(report.vin || "N/A", { x: 140, y, size: 14, font });
  y -= 30;

  // Summary
  page.drawText("Report Summary", {
    x: 20,
    y,
    size: 16,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 25;

  const pretty = JSON.stringify(report, null, 2).split("\n");

  pretty.forEach((line) => {
    if (y < 40) {
      page = pdfDoc.addPage([620, 820]);
      y = 780;
    }
    page.drawText(line.substring(0, 100), {
      x: 20,
      y,
      size: 10,
      font,
    });
    y -= 14;
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
