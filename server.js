// server.js
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

// MUST BE FIRST for all non-webhook routes
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ⭐ DO NOT USE express.json() before the webhook
// ⭐ DO NOT USE express.urlencoded() before webhook

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

// ------------------------------
// RAW BODY — ONLY FOR WEBHOOK
// ------------------------------
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),   // ⭐ RAW BODY REQUIRED
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
      console.log("Webhook signature failed:", err.message);
      return res.status(400).send("Webhook Error: " + err.message);
    }

    console.log("Webhook received:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vin = session.metadata.vin;
      const email = session.metadata.email;

      console.log("Generating report for:", vin);

      try {
        const report = await fetchCarfaxReport(vin);
        const pdf = await generateCarfaxPDF({ vin, ...report });

        // Send email
        await axios.post(
          "https://api.resend.com/emails",
          {
            from: "no-reply@vindata.ca",
            to: [email],
            subject: `Your Vehicle History Report – ${vin}`,
            html: `<p>Your Carfax-style PDF is attached.</p>`,
            attachments: [
              {
                filename: `VIN-${vin}.pdf`,
                content: pdf.toString("base64"),
              },
            ],
          },
          { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }
        );

        console.log("Email sent to:", email);

      } catch (err) {
        console.log("Webhook processing error:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// -------------------------------------------------------
// NOW enable express.json() AFTER the webhook
// -------------------------------------------------------
app.use(express.json());

// ------------------------------
// VIN Lookup
// ------------------------------
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const decode = await decodeVinFree(req.params.vin);
    res.json({ success: true, decode });
  } catch (err) {
    res.status(500).json({ success: false, error: "Lookup failed" });
  }
});

// ------------------------------
// Stripe Checkout
// ------------------------------
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
    res.status(500).json({ error: "Could not create checkout" });
  }
});

// ------------------------------
app.get("/_health", (req, res) => res.send("OK"));

// ------------------------------
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
