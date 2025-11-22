// server.js
import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import Stripe from 'stripe';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Environment variables
const {
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY,
  DOMAIN = 'https://vindata.ca',
  CARSIMULCAST_API_KEY,
  CARSIMULCAST_API_SECRET,
  PORT = 3000
} = process.env;

// Warn if missing env variables
if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !RESEND_API_KEY || !CARSIMULCAST_API_KEY || !CARSIMULCAST_API_SECRET) {
  console.warn(
    'Warning: one or more required environment variables are missing. ' +
    'Make sure STRIPE_SECRET_KEY, STRIPE_PRICE_ID, RESEND_API_KEY, ' +
    'CARSIMULCAST_API_KEY, and CARSIMULCAST_API_SECRET are set.'
  );
}

const stripe = new Stripe(STRIPE_SECRET_KEY || "");

// Decode VIN (free API)
async function decodeVinFree(vin) {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;
  const resp = await axios.get(url);
  const results = resp.data.Results || [];

  const getVar = (name) => results.find(r => r.Variable === name)?.Value || '';

  return {
    vin,
    make: getVar('Make'),
    model: getVar('Model'),
    year: getVar('Model Year'),
    body: getVar('Body Class'),
    manufacturer: getVar('Manufacturer Name')
  };
}

// Fetch Carfax report from CarSimulcast
async function fetchCarfaxReport(vin) {
  const url = `https://connect.carsimulcast.com/getrecord/carfax/${vin}`;
  const resp = await axios.get(url, {
    headers: {
      'X-API-KEY': CARSIMULCAST_API_KEY,
      'X-API-SECRET': CARSIMULCAST_API_SECRET
    },
    timeout: 45000
  });

  return resp.data;
}

// Public VIN lookup
app.get('/api/lookup/:vin', async (req, res) => {
  try {
    const vin = (req.params.vin || '').trim();
    if (!vin) return res.status(400).json({ success: false, error: 'VIN required' });

    const decode = await decodeVinFree(vin);
    res.json({ success: true, vin, decode });

  } catch (err) {
    console.error('lookup error:', err);
    res.status(500).json({ success: false, error: 'Lookup failed' });
  }
});

// Stripe Checkout session
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { vin, email } = req.body;

    if (!vin || !email)
      return res.status(400).json({ error: 'VIN and email required' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/?cancelled=1`,
      customer_email: email,
      metadata: { vin, email }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('create-checkout error:', err);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// Stripe webhook handler
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature failed', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const vin = session.metadata?.vin || session.client_reference_id || 'unknown';
    const email = session.metadata?.email || session.customer_email || 'unknown@example.com';

    console.log('Payment success — generating report for', vin);

    try {
      const report = await fetchCarfaxReport(vin);

      const html = `
        <p>Hi,</p>
        <p>Your VIN report for <strong>${vin}</strong> is below.</p>
        <pre style="white-space:pre-wrap">${JSON.stringify(report, null, 2)}</pre>
        <p>Thank you,<br/>Vindata</p>
      `;

      await axios.post(
        'https://api.resend.com/emails',
        {
          from: `no-reply@${DOMAIN.replace(/^https?:\/\//, '')}`,
          to: [email],
          subject: `Your VIN report for ${vin}`,
          html
        },
        { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } }
      );

      console.log('Report emailed to', email);

    } catch (err) {
      console.error('Report sending error:', err);
    }
  }

  res.json({ received: true });
});

// Health endpoint
app.get('/_health', (req, res) => res.json({ ok: true }));

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
