import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import Stripe from "stripe";
import cors from "cors";
import puppeteer from "puppeteer";
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
  PORT = 10000
} = process.env;

const stripe = new Stripe(STRIPE_SECRET_KEY);

// -----------------------
// Free VIN decode (NHTSA)
// -----------------------
async function decodeVinFree(vin) {
  const resp = await axios.get(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`
  );
  const results = resp.data.Results || [];
  const getVar = (v) => results.find((r) => r.Variable === v)?.Value || "";

  return {
    vin,
    make: getVar("Make"),
    model: getVar("Model"),
    year: getVar("Model Year")
  };
}

// ---------------------------
// CarSimulcast Carfax Report
// ---------------------------
async function fetchCarfaxReport(vin) {
  const url = `https://connect.carsimulcast.com/getrecord/carfax/${vin}`;
  const r = await axios.get(url, {
    headers: {
      "X-API-KEY": CARSIMULCAST_API_KEY,
      "X-API-SECRET": CARSIMULCAST_API_SECRET
    }
  });
  return r.data;
}

// ---------------------------
// Generate PDF via Puppeteer
// ---------------------------
async function generatePDF(jsonData) {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  // Construct HTML
  const html = `
  <html>
  <head>
    <style>
      body { font-family: Arial; padding: 20px; }
      h1 { color: #004aad; }
      .section { margin-bottom: 20px; }
      .box { background:#f4f4f4; padding:10px; border-radius:8px; }
    </style>
  </head>
  <body>
    <h1>Vehicle History Report</h1>
    <p><b>VIN:</b> ${jsonData.vin || "N/A"}</p>

    <div class="section">
      <h2>Raw Report Data</h2>
      <div class="box">
        <pre>${JSON.stringify(jsonData, null, 2)}</pre>
      </div>
    </div>
  </body>
  </html>
  `;

  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true
  });

  await browser.close();
  return pdfBuffer;
}

// ---------------------------
// API: Lookup
// ---------------------------
app.get("/api/lookup/:vin", async (req, res) => {
  try {
    const decode = await decodeVinFree(req.params.vin);
    res.json({ success: true, decode });
  } catch (e) {
    res.status(500).json({ success: false, error: "Lookup failed" });
  }
});

// ---------------------------
// API: Create Stripe Checkout
// ---------------------------
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
      metadata: { vin, email }
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: "Checkout failed" });
  }
});

// ---------------------------
// Stripe Webhook
// ---------------------------
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
        const jsonData = await fetchCarfaxReport(vin);

        const pdf = await generatePDF(jsonData);

        await axios.post(
          "https://api.resend.com/emails",
          {
            from: "no-reply@vindata.ca",
            to: [email],
            subject: `Your VIN Report: ${vin}`,
            html: `<p>Your PDF report is attached.</p>`,
            attachments: [
              {
                filename: `VIN-${vin}.pdf`,
                content: pdf.toString("base64")
              }
            ]
          },
          { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }
        );
      } catch (error) {
        console.log("Failed to email report:", error);
      }
    }

    res.json({ received: true });
  }
);

// ---------------------------
// Health
// ---------------------------
app.get("/_health", (req, res) => res.send("OK"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
