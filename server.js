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
  page.drawText(report.vin || "N/A", { x: 140, y, size: 14, font });
  y -= 25;

  // Basic Vehicle Info Section
  page.drawText("Vehicle Information", {
    x: 20,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 20;

  const infoList = [
    ["Make", report.make || "N/A"],
    ["Model", report.model || "N/A"],
    ["Year", report.year || "N/A"],
    ["Trim", report.trim || "N/A"],
    ["Body Type", report.body || report.vehicleBody || "N/A"],
    ["Engine", report.engine || "N/A"],
  ];

  infoList.forEach(([label, value]) => {
    page.drawText(label + ":", { x: 25, y, size: 12, font: boldFont });
    page.drawText(String(value), { x: 150, y, size: 12, font });
    y -= 18;
  });

  y -= 15;

  // Ownership Summary
  page.drawText("Ownership Summary", {
    x: 20,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 25;

  page.drawRectangle({
    x: 20,
    y: y - 80,
    width: 580,
    height: 80,
    color: rgb(0.95, 0.95, 0.97),
  });

  const ownerHist = report.ownership || report.ownerHistory || {};
  const summaryText = [
    `Owners: ${ownerHist.totalOwners || "N/A"}`,
    `Last Known Odometer: ${ownerHist.lastOdometer || "N/A"}`,
    `Last Registration: ${ownerHist.lastState || "N/A"}`
  ];

  let sy = y - 10;
  summaryText.forEach(t => {
    page.drawText(t, { x: 30, y: sy, size: 12, font });
    sy -= 20;
  });

  y -= 120;

  // Accident Records Section
  page.drawText("Accident / Damage Records", {
    x: 20,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0.8, 0, 0),
  });
  y -= 20;

  const accidents = report.accidentRecords || report.accidents || [];

  if (accidents.length === 0) {
    page.drawText("No accident records found.", {
      x: 25,
      y,
      size: 12,
      font,
      color: rgb(0, 0.5, 0),
    });
    y -= 20;
  } else {
    accidents.forEach((acc, i) => {
      page.drawRectangle({
        x: 20,
        y: y - 60,
        width: 580,
        height: 60,
        color: rgb(1, 0.93, 0.93),
      });

      page.drawText(`Accident #${i + 1}`, { x: 30, y: y - 15, size: 14, font: boldFont });
      page.drawText(`Date: ${acc.date || "N/A"}`, { x: 30, y: y - 35, size: 12, font });
      page.drawText(`Description: ${acc.description || "N/A"}`, {
        x: 200,
        y: y - 35,
        size: 12,
        font,
      });

      y -= 75;
    });
  }

  // Service Records
  page.drawText("Service History", {
    x: 20,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 20;

  const services = report.serviceRecords || report.serviceHistory || [];

  if (services.length === 0) {
    page.drawText("No service records available.", {
      x: 25,
      y,
      size: 12,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 20;
  } else {
    services.forEach((s, i) => {
      page.drawText(`• ${s.date || "N/A"} — ${s.service || "Service performed"}`, {
        x: 25,
        y,
        size: 12,
        font,
      });
      y -= 18;
    });
  }

  // Convert to buffer
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
