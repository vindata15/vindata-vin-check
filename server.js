import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function generateCarfaxPDF(report) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([620, 820]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 780;

  // Draw header bar
  page.drawRectangle({
    x: 0,
    y: 780,
    width: 620,
    height: 40,
    color: rgb(0.0, 0.26, 0.55)
  });

  page.drawText("VEHICLE HISTORY REPORT", {
    x: 20,
    y: 790,
    font: boldFont,
    size: 20,
    color: rgb(1, 1, 1),
  });

  y -= 60;

  // VIN section
  page.drawText("VIN Number:", { x: 20, y, size: 14, font: boldFont });
  page.drawText(report.vin || "
