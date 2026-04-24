
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── Daraja sandbox base URL ──────────────────────────────────────────────────
const DARAJA_BASE = 'https://sandbox.safaricom.co.ke';

// ── Generate OAuth token ─────────────────────────────────────────────────────
async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString('base64');

  const res = await axios.get(
    `${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return res.data.access_token;
}

// ── STK Push endpoint ────────────────────────────────────────────────────────
app.post('/stk-push', async (req, res) => {
  try {
    const { phone, amount, jobId, workerName } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: 'phone and amount are required' });
    }

    let cleanPhone = phone.toString().trim().replace(/\s|-/g, '');
    if (cleanPhone.startsWith('+'))  cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.startsWith('0'))  cleanPhone = `254${cleanPhone.substring(1)}`;
    if (!cleanPhone.startsWith('254')) cleanPhone = `254${cleanPhone}`;

    const token     = await getAccessToken();
    const shortCode = process.env.BUSINESS_SHORT_CODE; 
    const passkey   = process.env.PASSKEY;

    // Fixed Timestamp: Ensures YYYYMMDDHHmmss format
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);

    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: shortCode,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            Math.ceil(Number(amount)),
      PartyA:            cleanPhone,
      PartyB:            shortCode,
      PhoneNumber:       cleanPhone,
      CallBackURL:       process.env.CALLBACK_URL,
      AccountReference:  jobId || 'EasyFix',
      TransactionDesc:   `Payment to ${workerName || 'EasyFix Worker'}`,
    };

    const stkRes = await axios.post(
      `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return res.json({
      success:      true,
      checkoutRequestId: stkRes.data.CheckoutRequestID,
      responseDescription: stkRes.data.ResponseDescription,
    });

  } catch (err) {
    console.error('STK Push error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: err?.response?.data?.errorMessage || 'STK Push failed',
    });
  }
});

// ── M-Pesa callback ──────────────────────────────────────────────────────────
app.post('/mpesa-callback', (req, res) => {
  console.log('M-Pesa callback received');
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'EasyFix backend running ✅' }));

// ── Server Setup for Render ──────────────────────────────────────────────────
// Render automatically injects the PORT environment variable
const PORT = process.env.PORT || 3000;

// Binding to '0.0.0.0' allows the service to be reachable within Render's network
app.listen(PORT, '0.0.0.0', () => {
 console.log(`Server is listening on port ${PORT}`);
});