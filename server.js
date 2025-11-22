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

// ---------------------------------------------
// Global Middlewares (STATIC + CORS)
// ---------------------------------------------
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------
// ENV VARIABLES
// ---------------------------------------------
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

// =====================================================
//  RAW WEBHOOK ROUTE — MUST COME BEFORE express.json()
// =====================================================
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
      console.log("❌ Webhook signature failed:", err.message);
      return res.status(400).send("Webhook Error: " + err.message);
    }

    console.log("✅ Webhook received:", event.type);

    // ------------- Handle checkout complete -----------------
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vin = session.metadata.vin;
      const email = session.metadata.email;

      console.log(`📄 Generating report for VIN: ${vin}`);

      try {
        // 1. Fetch vehicle history
        const report = await fetchCarfaxReport(vin);

        // 2. Generate PDF
        const pdf = await generateCarfaxPDF({
          vin,
          ...report,
        });

        // 3. Email PDF with Resend
        await axios.post(
          "https://api.resend.com/emails",
          {
            from: "no-reply@vindata.ca",
            to: [email],
            subject: `Your Vehicle History Report – ${vin}`,
            html: `<p>Your vehicle history report is ready. Please find the attached PDF.</p>`,
            attachments: [
              {
                filename: `VIN-${vin}.pdf`,
                content: pdf.toString("base64"),
              },
            ],
          },
          { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }
        );

        console.log("📧 Email successfully sent to:", email);
      } catch (err) {
        console.log("❌ Webhook processing error:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// =====================================================
// Now enable JSON parsing AFTER webhook
// =====================================================
app.use(express.json());

// =====================================================
// VIN Decode API (FREE NHTSA)
// =====================================================
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const vin = req.params.vin;
    const decode = await decodeVinFree(vin);
    res.json({ success: true, decode });
  } catch (err) {
    console.log("Decode error:", err.message);
    res.status(500).json({ success: false, error: "VIN lookup failed" });
  }
});

// =====================================================
// Stripe Checkout Session
// =====================================================
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
    console.log("❌ Checkout error:", err.message);
    res.status(500).json({ error: "Unable to create checkout session" });
  }
});

// =====================================================
// Health check for Render
// =====================================================
app.get("/_health", (req, res) => res.send("OK"));

// =====================================================
// Start Server
// =====================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


// ===================================================================
// -------------- Helper Functions (Bottom of File) ------------------
// ===================================================================

// ✔️ CarSimulcast VIN History
async function fetchCarfaxReport(vin) {
  try {
    const response = await axios.post(
      "https://api.carsimulcast.com/v1/vin/history",
      { vin },
      {
        auth: {
          username: CARSIMULCAST_API_KEY,
          password: CARSIMULCAST_API_SECRET,
        },
      }
    );

    return response.data;
  } catch (err) {
    console.error("❌ CarSimulcast API Error:", err.response?.data || err.message);
    throw new Error("CarSimulcast API request failed");
  }
}

// ✔️ Free VIN Decoder (NHTSA)
async function decodeVinFree(vin) {
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;
    const response = await axios.get(url);
    return response.data.Results;
  } catch (err) {
    console.error("❌ VIN decode failed:", err.message);
    throw new Error("VIN decode failed");
  }
}
