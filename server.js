// =========================
//  VIN DATA COMPLETE SERVER
// =========================

import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import Stripe from "stripe";
import cors from "cors";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

// Path helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ENV VARS
const {
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY,
  DOMAIN = "https://vindata.ca",
  CARSIMULCAST_API_KEY,
  CARSIMULCAST_API_SECRET,
  PORT = 10000,
} = process.env;

const stripe = new Stripe(STRIPE_SECRET_KEY);

// ================================
// FREE VIN DECODE FROM NHTSA
// ================================
async function decodeVinFree(vin) {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;
  const r = await axios.get(url);
  const results = r.data.Results || [];
  const find = (x) => results.find((r) => r.Variable === x)?.Value || "";

  return {
    vin,
    make: find("Make"),
    model: find("Model"),
    year: find("Model Year"),
  };
}

// ================================
// CARSIMULCAST CARFAX REPORT
// ================================
async function fetchCarfaxReport(vin) {
  const url = `https://connect.carsimulcast.com/getrecord/carfax/${vin}`;
  const r = await axios.get(url, {
    headers: {
      "X-API-KEY": CARSIMULCAST_API_KEY,
      "X-API-SECRET": CARSIMULCAST_API_SECRET,
    },
  });
  return r.data;
}

// ================================
// GENERATE CARFAX-STYLE PDF (pdf-lib)
// ================================
async function generateCarfaxPDF(report) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([620, 820]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 780;

  // Header bar
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

  // VIN block
  page.drawText("VIN:", { x: 20, y, size: 14, font: bold });
  page.drawText(report.vin || "N/A", { x: 140, y, size: 14, font });
  y -= 30;

  // Vehicle Info
  page.drawText("Vehicle Information", {
    x: 20,
    y,
    size: 16,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 25;

  const info = [
    ["Make", report.make || "N/A"],
    ["Model", report.model || "N/A"],
    ["Year", report.year || "N/A"],
    ["Trim", report.trim || "N/A"],
    ["Body", report.body || "N/A"],
    ["Engine", report.engine || "N/A"],
  ];

  info.forEach(([label, val]) => {
    page.drawText(label + ":", { x: 20, y, size: 12, font: bold });
    page.drawText(val, { x: 150, y, size: 12, font });
    y -= 18;
  });

  y -= 20;

  // Ownership Section
  page.drawText("Ownership Summary", {
    x: 20,
    y,
    size: 16,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 25;

  page.drawRectangle({
    x: 20,
    y: y - 80,
    width: 580,
    height: 80,
    color: rgb(0.95, 0.95, 0.98),
  });

  const owner = report.ownership || report.ownerHistory || {};
  let oy = y - 10;

  [
    `Owners: ${owner.totalOwners || "N/A"}`,
    `Last Odometer: ${owner.lastOdometer || "N/A"}`,
    `Last Registration: ${owner.lastState || "N/A"}`,
  ].forEach((t) => {
    page.drawText(t, { x: 30, y: oy, size: 12, font });
    oy -= 20;
  });

  y -= 110;

  // Accident Section
  page.drawText("Accident / Damage Records", {
    x: 20,
    y,
    size: 16,
    font: bold,
    color: rgb(0.8, 0, 0),
  });
  y -= 25;

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

      page.drawText(`Accident #${i + 1}`, {
        x: 30,
        y: y - 15,
        size: 14,
        font: bold,
      });

      page.drawText(`Date: ${acc.date || "N/A"}`, {
        x: 30,
        y: y - 35,
        size: 12,
        font,
      });

      page.drawText(`Description: ${acc.description || "N/A"}`, {
        x: 200,
        y: y - 35,
        size: 12,
        font,
      });

      y -= 75;
    });
  }

  // Save PDF
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// ================================
// ROUTE: VIN Lookup
// ================================
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const decode = await decodeVinFree(req.params.vin);
    res.json({ success: true, decode });
  } catch (e) {
    res.status(500).json({ success: false, error: "Lookup failed" });
  }
});

// ================================
// ROUTE: Stripe Checkout
// ================================
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { vin, email } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/`,
      customer_email: email,
      metadata: { vin, email },
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Could not create checkout" });
  }
});

// ================================
// STRIPE WEBHOOK
// ================================
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const vin = s.metadata.vin;
      const email = s.metadata.email;

      try {
        // Get full report
        const jsonData = await fetchCarfaxReport(vin);

        // Generate PDF
        const pdf = await generateCarfaxPDF({
          vin,
          ...jsonData,
        });

        // Email PDF
        await axios.post(
          "https://api.resend.com/emails",
          {
            from: "no-reply@vindata.ca",
            to: [email],
            subject: `Your VIN Report – ${vin}`,
            html: `<p>Your attached vehicle report is ready.</p>`,
            attachments: [
              {
                filename: `VIN-${vin}.pdf`,
                content: pdf.toString("base64"),
              },
            ],
          },
          {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
          }
        );
      } catch (err) {
        console.log("Email/PDF failed:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// ================================
// HEALTH
// ================================
app.get("/_health", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
