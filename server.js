// server.js
import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import Stripe from "stripe";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---- STRIPE WEBHOOK MUST BE FIRST (before express.json) ----
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      if (process.env.STRIPE_WEBHOOK_SECRET) {
        event = Stripe(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } else {
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error("❌ Webhook signature failed:", err.message);
      return res.status(400).send("Webhook Error");
    }

    // When payment is successful
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vin = session.metadata?.vin;
      const email = session.metadata?.email;

      console.log("✅ Payment Success Webhook Triggered:", vin, email);

      try {
        // Fetch Carfax-style report from CarSimulcast
        const report = await axios.get(
          `https://connect.carsimulcast.com/getrecord/carfax/${vin}`,
          {
            headers: {
              "X-API-KEY": process.env.CARSIMULCAST_API_KEY,
              "X-API-SECRET": process.env.CARSIMULCAST_API_SECRET,
            },
            timeout: 45000,
          }
        );

        const html = `
          <p>Hi,</p>
          <p>Thanks for your payment. Your Carfax-style VIN report for <strong>${vin}</strong> is ready.</p>
          <pre style="white-space:pre-wrap">${JSON.stringify(
            report.data,
            null,
            2
          )}</pre>
          <p>Thanks,<br/>Vindata</p>
        `;

        // SEND EMAIL
        await axios.post(
          "https://api.resend.com/emails",
          {
            from: "no-reply@" + process.env.DOMAIN.replace(/^https?:\/\//, ""),
            to: email,
            subject: `Your VIN Carfax Report: ${vin}`,
            html,
          },
          { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }
        );

        console.log("📧 Email sent to", email);
      } catch (err) {
        console.error("❌ Failed to fetch/send report:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// -----------------------------------------------------------
// Now safe to use JSON body parser
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// Load env
const {
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID,
  RESEND_API_KEY,
  DOMAIN = "https://vindata.ca",
  CARSIMULCAST_API_KEY,
  CARSIMULCAST_API_SECRET,
  PORT = 3000,
} = process.env;

const stripe = new Stripe(STRIPE_SECRET_KEY);

// ----------------- Lookup free VIN info -----------------
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const vin = req.params.vin.trim();
    if (!vin) return res.status(400).json({ success: false, error: "vin required" });

    const decode = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`
    );

    const results = decode.data.Results || [];
    const getVal = (v) => results.find((r) => r.Variable === v)?.Value || "";

    res.json({
      success: true,
      vin,
      decode: {
        make: getVal("Make"),
        model: getVal("Model"),
        year: getVal("Model Year"),
        body: getVal("Body Class"),
      },
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ----------------- Create Stripe Checkout -----------------
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { vin, email } = req.body;
    if (!vin || !email) return res.json({ error: "vin and email required" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/?cancelled=1`,
      customer_email: email,
      metadata: { vin, email },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.log("❌ Checkout creation error:", err.message);
    res.json({ error: "Checkout failed" });
  }
});

// ----------------- Health check -----------------
app.get("/_health", (req, res) => res.json({ ok: true }));

// ----------------- Start server -----------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
