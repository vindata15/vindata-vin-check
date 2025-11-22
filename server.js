// =========================
//  VIN DATA - FINAL SERVER
// =========================

import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import Stripe from "stripe";
import cors from "cors";
import { generateCarfaxPDF } from "./generatePdf.js";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

// ---------------------------------------------
// FREE VIN DECODER (NHTSA)
// ---------------------------------------------
async function decodeVinFree(vin) {
  const r = await axios.get(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`
  );

  const results = r.data.Results || [];
  const find = (v) => results.find((r) => r.Variable === v)?.Value || "N/A";

  return {
    vin,
    make: find("Make"),
    model: find("Model"),
    year: find("Model Year"),
  };
}

// ---------------------------------------------
// FETCH CARFAX REPORT (AUTO-DETECT AUTH FORMAT)
// ---------------------------------------------
async function fetchCarfaxReport(vin) {
  const url = `https://connect.carsimulcast.com/getrecord/carfax/${vin}`;

  const attempts = [
    { "api-key": CARSIMULCAST_API_KEY, "api-secret": CARSIMULCAST_API_SECRET },
    { "x-api-key": CARSIMULCAST_API_KEY, "x-api-secret": CARSIMULCAST_API_SECRET },
    { "X-API-KEY": CARSIMULCAST_API_KEY, "X-API-SECRET": CARSIMULCAST_API_SECRET },
    { Authorization: `Bearer ${CARSIMULCAST_API_KEY}` },
  ];

  for (const headers of attempts) {
    try {
      console.log("Trying headers:", headers);

      const r = await axios.get(url, { headers });

      if (r.data && r.data.status !== "error") {
        console.log("SUCCESS AUTH WITH:", headers);
        return r.data;
      }

    } catch (err) {
      console.log("FAILED HEADERS:", headers);
    }
  }

  throw new Error("CarSimulcast authentication failed. Check API keys.");
}

// ---------------------------------------------
// VIN LOOKUP API
// ---------------------------------------------
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const decode = await decodeVinFree(req.params.vin);
    res.json({ success: true, decode });
  } catch (err) {
    res.status(500).json({ success: false, error: "Lookup failed" });
  }
});

// ---------------------------------------------
// CREATE STRIPE CHECKOUT
// ---------------------------------------------
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { vin, email } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/`,
      customer_email: email,
      metadata: { vin, email },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.log("Checkout error:", err);
    res.status(500).json({ error: "Could not create checkout" });
  }
});

// ---------------------------------------------
//  FIX STRIPE WEBHOOK BODY PARSER
// ---------------------------------------------
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
      console.log("Webhook signature error:", err.message);
      return res.status(400).send("Webhook Error: " + err.message);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vin = session.metadata.vin;
      const email = session.metadata.email;

      console.log("PAYMENT COMPLETED FOR VIN:", vin);

      try {
        // 1️⃣ Fetch Report
        const report = await fetchCarfaxReport(vin);

        // 2️⃣ Generate PDF
        const pdf = await generateCarfaxPDF({ vin, ...report });

        // 3️⃣ Send Email via Resend
        const send = await axios.post(
          "https://api.resend.com/emails",
          {
            from: "no-reply@vindata.ca",
            to: [email],
            subject: `Your Vehicle History Report – ${vin}`,
            html: `<p>Your Carfax-style vehicle history report is attached.</p>`,
            attachments: [
              {
                filename: `VIN-${vin}.pdf`,
                content: pdf.toString("base64"),
                contentType: "application/pdf",
              },
            ],
          },
          { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }
        );

        console.log("EMAIL SENT SUCCESS:", send.data);

      } catch (err) {
        console.log("EMAIL/PDF ERROR:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// ---------------------------------------------
app.get("/_health", (req, res) => res.send("OK"));

// ---------------------------------------------
app.listen(PORT, () =>
  console.log("Server running on port", PORT)
);
