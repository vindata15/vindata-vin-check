// generatePdf.js - Final Carfax PDF (pdf-lib version)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function generateCarfaxPDF(report) {
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let page = pdfDoc.addPage([620, 820]);
  let y = 780;

  // Header bar
  page.drawRectangle({
    x: 0,
    y: 780,
    width: 620,
    height: 40,
    color: rgb(0, 0.25, 0.55),
  });

  page.drawText("VEHICLE HISTORY REPORT", {
    x: 20,
    y: 790,
    size: 20,
    font: bold,
    color: rgb(1, 1, 1),
  });

  y -= 60;

  // VIN block
  page.drawText("VIN:", { x: 20, y, size: 14, font: bold });
  page.drawText(report.vin || "N/A", { x: 150, y, size: 14, font });
  y -= 30;

  // Section
  page.drawText("Vehicle Summary", {
    x: 20,
    y,
    size: 16,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 25;

  const summary = [
    ["Make", report.make],
    ["Model", report.model],
    ["Year", report.year],
    ["Trim", report.trim],
    ["Body", report.body],
    ["Engine", report.engine],
  ];

  summary.forEach(([label, val]) => {
    page.drawText(label + ":", { x: 20, y, size: 12, font: bold });
    page.drawText(val || "N/A", { x: 150, y, size: 12, font });
    y -= 18;
  });

  y -= 20;

  // Raw JSON data
  page.drawText("Full Report Data", {
    x: 20,
    y,
    size: 16,
    font: bold,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 25;

  const pretty = JSON.stringify(report, null, 2).split("\n");

  for (const line of pretty) {
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
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
