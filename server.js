// server.js
import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import Stripe from "stripe";
import cors from "cors";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// FIX: Stripe webhook RAW BODY requirement BEFORE JSON middleware
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook/stripe") {
    next(); // raw body will be handled later
  } else {
    express.json()(req, res, next);
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// Environment variables
const {
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY,
  DOMAIN = "https://vindata.ca",
  CARSIMULCAST_API_KEY,
  CARSIMULCAST_API_SECRET,
  PORT = 3000
} = process.env;

if (
  !STRIPE_SECRET_KEY ||
  !STRIPE_PRICE_ID ||
  !RESEND_API_KEY ||
  !CARSIMULCAST_API_KEY ||
  !CARSIMULCAST_API_SECRET
) {
  console.warn("⚠ Missing required environment variables");
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

// -------------------------- FREE VIN DECODER --------------------------
async function decodeVinFree(vin) {
  const resp = await axios.get(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`
  );

  const results = resp.data.Results || [];
  const get = (x) => results.find((r) => r.Variable === x)?.Value || "";

  return {
    vin,
    make: get("Make"),
    model: get("Model"),
    year: get("Model Year"),
    body: get("Body Class"),
    manufacturer: get("Manufacturer Name")
  };
}

// -------------------------- FIXED CARFAX API --------------------------
async function fetchCarfaxReport(vin) {
  const url = `https://connect.carsimulcast.com/getrecord/carfax/${vin}`;

  const resp = await axios.get(url, {
    headers: {
      "API-KEY": CARSIMULCAST_API_KEY,
      "API-SECRET": CARSIMULCAST_API_SECRET
    },
    timeout: 45000
  });

  return resp.data;
}

// -------------------------- VIN LOOKUP (PUBLIC) --------------------------
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const vin = req.params.vin.trim();
    if (!vin) return res.json({ success: false, error: "VIN is required" });

    const decode = await decodeVinFree(vin);
    res.json({ success: true, decode });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------- CREATE STRIPE CHECKOUT SESSION --------------------------
app.post("/api/create-checkout", async (req, res) => {
  try {
    const { vin, email } = req.body;

    if (!vin || !email)
      return res.status(400).json({ error: "VIN and Email required" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      customer_email: email,
      metadata: { vin, email },
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/?cancelled=1`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err.message);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// -------------------------- STRIPE WEBHOOK --------------------------
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }), // required!
  async (req, res) => {
    let event;

    try {
      if (STRIPE_WEBHOOK_SECRET) {
        const sig = req.headers["stripe-signature"];
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          STRIPE_WEBHOOK_SECRET
        );
      } else {
        event = JSON.parse(req.body);
      }
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const vin = session.metadata?.vin;
      const email = session.metadata?.email;

      console.log("✔ Payment confirmed for VIN:", vin);

      try {
        const report = await fetchCarfaxReport(vin);

        const html = `
          <p>Hi,</p>
          <p>Thanks for your payment. Your Carfax-style VIN report for <b>${vin}</b> is ready:</p>
          <pre style="white-space:pre-wrap">${JSON.stringify(
            report,
            null,
            2
          )}</pre>
          <p>Thanks,<br>Vindata</p>
        `;

        await axios.post(
          "https://api.resend.com/emails",
          {
            from: `no-reply@${DOMAIN.replace("https://", "")}`,
            to: [email],
            subject: `Your VIN Carfax Report: ${vin}`,
            html
          },
          {
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`
            }
          }
        );

        console.log("📧 Report emailed to", email);
      } catch (err) {
        console.error("Carfax fetch/send error:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// -------------------------- HEALTH CHECK --------------------------
app.get("/_health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
