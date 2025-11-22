// server.js
import express from "express";
import axios from "axios";
import Stripe from "stripe";
import dotenv from "dotenv";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { generatePdfFromHtml } from "./generatePdf.js";
import fs from "fs";

dotenv.config();

const app = express();

// Needed for Stripe Webhook
app.use(
  "/webhook/stripe",
  express.raw({ type: "application/json" })
);

// Normal JSON for all other routes
app.use(express.json());
app.use(cors());

const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, "public")));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ------------------------------
//  Lookup Endpoint (free NHTSA)
// ------------------------------
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const vin = req.params.vin;
    const apiUrl = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;

    const response = await axios.get(apiUrl);
    const data = response.data.Results;

    const make = data.find((r) => r.Variable === "Make")?.Value || "";
    const model = data.find((r) => r.Variable === "Model")?.Value || "";
    const year = data.find((r) => r.Variable === "Model Year")?.Value || "";

    res.json({ success: true, vin, decode: { make, model, year } });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------
//  Create Stripe Checkout
// ------------------------------
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { vin, email } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        { price: process.env.STRIPE_PRICE_ID, quantity: 1 }
      ],
      success_url: `${process.env.DOMAIN}/success.html?vin=${vin}`,
      cancel_url: `${process.env.DOMAIN}?cancelled=1`,
      customer_email: email,
      metadata: { vin, email },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.json({ error: err.message });
  }
});

// ------------------------------
//  STRIPE WEBHOOK
// ------------------------------
app.post("/webhook/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Webhook signature failed:", err.message);
    return res.status(400).send("Invalid signature");
  }

  // PAYMENT SUCCESS
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const vin = session.metadata.vin;
    const email = session.metadata.email;

    console.log("✔ Payment successful for", vin);

    try {
      // ------------------------------
      // 1. Fetch CarSimulcast HTML Report
      // ------------------------------
      const htmlResp = await axios.get(
        `https://connect.carsimulcast.com/getrecord/html/${vin}`,
        {
          headers: {
            "API-KEY": process.env.CARSIMULCAST_API_KEY,
            "API-SECRET": process.env.CARSIMULCAST_API_SECRET,
          },
        }
      );

      const reportHtml = htmlResp.data;

      // ------------------------------
      // 2. Convert HTML → PDF via Puppeteer
      // ------------------------------
      const pdfPath = `/tmp/${vin}.pdf`;
      await generatePdfFromHtml(reportHtml, pdfPath);

      // ------------------------------
      // 3. Send Email with PDF (Resend)
      // ------------------------------
      const fileData = fs.readFileSync(pdfPath);

      await axios.post(
        "https://api.resend.com/emails",
        {
          from: `no-reply@vindata.ca`,
          to: email,
          subject: `Your Vehicle Report for VIN ${vin}`,
          html: `
            <p>Hello,</p>
            <p>Your complete Carfax-style vehicle history report is attached.</p>
            <p>Thank you for using <strong>VINDATA.ca</strong>.</p>
          `,
          attachments: [
            {
              filename: `${vin}.pdf`,
              content: fileData.toString("base64"),
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📩 PDF emailed:", email);
    } catch (err) {
      console.error("ERROR generating/sending PDF:", err);
    }
  }

  res.json({ received: true });
});

// Health Check
app.get("/_health", (req, res) => res.json({ ok: true }));

// Start Server
app.listen(process.env.PORT || 3000, () =>
  console.log("Server running")
);
