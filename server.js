// server.js
import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import Stripe from "stripe";
import cors from "cors";
import { generateCarfaxPDF } from "./generatePdf.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const {
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY,
  CARSIMULCAST_API_KEY,
  CARSIMULCAST_API_SECRET,
  DOMAIN,
  PORT = 10000,
} = process.env;

const stripe = new Stripe(STRIPE_SECRET_KEY);

// --------------------------------------------------
// RAW WEBHOOK — MUST BE BEFORE express.json()
// --------------------------------------------------
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
      console.log("❌ Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("🔔 Webhook:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vin = session.metadata.vin;
      const email = session.metadata.email;

      console.log("⚡ Processing report for:", vin);

      try {
        // Fetch VIN history
        const report = await fetchCarfaxReport(vin);

        // Generate PDF
        const pdf = await generateCarfaxPDF({ vin, ...report });

        // Send email via Resend
        const emailSend = await axios.post(
          "https://api.resend.com/emails",
          {
            from: "no-reply@vindata.ca",
            to: [email],
            subject: `Your Vehicle Report – ${vin}`,
            html: `<p>Your vehicle history report is attached.</p>`,
            attachments: [
              {
                filename: `VIN-${vin}.pdf`,
                content: pdf.toString("base64"),
              }
            ]
          },
          {
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json"
            }
          }
        );

        console.log("📧 Email sent:", emailSend.data);

      } catch (err) {
        console.log("❌ Error sending email:", err.response?.data || err.message);
      }
    }

    res.json({ received: true });
  }
);

// After webhook
app.use(express.json());

// -----------------------------------------------
// VIN Lookup API
// -----------------------------------------------
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const vin = req.params.vin;
    const decode = await decodeVin(vin);
    res.json({ success: true, decode });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// -----------------------------------------------
// Create Stripe checkout session
// -----------------------------------------------
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { vin, email } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        { price: STRIPE_PRICE_ID, quantity: 1 }
      ],
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/`,
      customer_email: email,
      metadata: { vin, email }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.log("❌ Stripe error:", err.message);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// -----------------------------------------------
app.get("/_health", (req, res) => res.send("OK"));
// -----------------------------------------------

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});


// =========================================================
// Helper Functions
// =========================================================

async function decodeVin(vin) {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;
  const res = await axios.get(url);
  return res.data.Results;
}

async function fetchCarfaxReport(vin) {
  try {
    const response = await axios.post(
      "https://api.carsimulcast.com/v1/vin/history",
      { vin },
      {
        auth: {
          username: CARSIMULCAST_API_KEY,
          password: CARSIMULCAST_API_SECRET,
        }
      }
    );
    return response.data;
  } catch (err) {
    console.log("CarSimulcast error:", err.response?.data);
    throw new Error("Unable to fetch history");
  }
}
