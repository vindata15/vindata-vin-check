import PDFDocument from "pdfkit";
import fs from "fs";

export async function generateCarfaxPDF(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });

    doc.fontSize(26).text("Vehicle History Report", { underline: true });
    doc.moveDown();
    doc.fontSize(14).text(`VIN: ${data.vin}`);
    doc.moveDown();

    doc.text(JSON.stringify(data, null, 2));

    doc.end();
  });
}
