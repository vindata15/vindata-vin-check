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
// Environment variables (set these in Render or .env)
const {
STRIPE_SECRET_KEY,
STRIPE_PRICE_ID,
STRIPE_WEBHOOK_SECRET, // optional but recommended
RESEND_API_KEY,
DOMAIN = 'https://vindata.ca',
CARSIMULCAST_API_KEY,
CARSIMULCAST_API_SECRET,
PORT = 3000
} = process.env;
if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !RESEND_API_KEY || !
CARSIMULCAST_API_KEY || !CARSIMULCAST_API_SECRET) {
console.warn('Warning: one or more required env vars missing. Make sure
STRIPE_SECRET_KEY, STRIPE_PRICE_ID, RESEND_API_KEY, CARSIMULCAST_API_KEY and
CARSIMULCAST_API_SECRET are set.');
}
2
const stripe = new Stripe(STRIPE_SECRET_KEY || '');
// Helper: free VIN decode from NHTSA (used to show make/model before
payment)
async function decodeVinFree(vin) {
const resp = await axios.get(`https://vpic.nhtsa.dot.gov/api/vehicles/
DecodeVin/${vin}?format=json`);
const results = resp.data.Results || [];
const getVar = (name) => results.find(r => r.Variable === name)?.Value ||
'';
return {
vin,
make: getVar('Make'),
model: getVar('Model'),
year: getVar('Model Year'),
body: getVar('Body Class') || '',
manufacturer: getVar('Manufacturer Name') || ''
};
}
// Helper: fetch Carfax report from CarSimulcast using your API key + secret
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
// --------------- Public lookup endpoint (shows make/model before payment)
app.get('/api/lookup/:vin', async (req, res) => {
try {
const vin = (req.params.vin || '').trim();
if (!vin) return res.status(400).json({ success: false, error: 'vin
required' });
const decode = await decodeVinFree(vin);
res.json({ success: true, vin, decode });
} catch (err) {
console.error('lookup error', err.message || err);
res.status(500).json({ success: false, error: err.message || 'lookup
failed' });
}
});
// --------------- Create Stripe Checkout session
app.post('/api/create-checkout', async (req, res) => {
3
try {
const { vin, email } = req.body;
if (!vin || !email) return res.status(400).json({ error: 'vin and email
required' });
// Create Checkout session
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
console.error('create-checkout error', err.message || err);
res.status(500).json({ error: err.message || 'checkout failed' });
}
});
// --------------- Stripe webhook handler
// NOTE: Stripe webhooks should verify signatures in production. We support
verification if STRIPE_WEBHOOK_SECRET is set.
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async
(req, res) => {
const sig = req.headers['stripe-signature'];
let event;
try {
if (STRIPE_WEBHOOK_SECRET) {
event = stripe.webhooks.constructEvent(req.body, sig,
STRIPE_WEBHOOK_SECRET);
} else {
event = JSON.parse(req.body.toString());
}
} catch (err) {
console.error('webhook signature failed', err.message || err);
return res.status(400).send(`Webhook Error: ${err.message}`);
}
if (event.type === 'checkout.session.completed') {
const session = event.data.object;
const vin = session.metadata?.vin || session.client_reference_id ||
'unknown';
const email = session.metadata?.email || session.customer_email ||
'unknown@example.com';
console.log('Payment success — generating Carfax report for', vin,
'email:', email);
4
try {
// Fetch the Carfax report (this consumes credits in your CarSimulcast
account)
const report = await fetchCarfaxReport(vin);
// Build email HTML
const html = `
 <p>Hi,</p>
 <p>Thanks for your payment. Your Carfax-style VIN report for
<strong>${vin}</strong> is attached below.</p>
 <p>Below is the JSON response from CarSimulcast:</p>
 <pre style="white-space:pre-wrap">${JSON.stringify(report, null, 2)}
</pre>
 <p>Thanks,<br/>Vindata</p>
 `;
// Send email using Resend
await axios.post('https://api.resend.com/emails', {
from: `no-reply@${DOMAIN.replace(/^https?:\/\//, '')}`,
to: [email],
subject: `Your VIN Carfax report for ${vin}`,
html
}, {
headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
});
console.log('Report emailed to', email);
} catch (err) {
console.error('Error fetching/sending Carfax report:', err.message ||
err);
// Optionally notify admin or retry — omitted for brevity
}
}
res.json({ received: true });
});
// health
app.get('/_health', (req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));