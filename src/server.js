require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---

// Raw body for webhook signature verification (must come BEFORE json parser)
// Stripe and Shopify webhooks need the raw body
app.use('/webhooks', (req, res, next) => {
  // Let the route-level raw parser handle it
  next();
});
app.use('/stripe', (req, res, next) => {
  next();
});

// JSON parser for all other routes
app.use((req, res, next) => {
  if (req.path.startsWith('/webhooks') || req.path.startsWith('/stripe')) {
    return next();
  }
  express.json()(req, res, next);
});

// --- Admin auth middleware ---
function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();

  // Check Authorization header (Basic auth)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic') {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const [, pass] = decoded.split(':');
      if (pass === password) return next();
    }
  }

  // Check query param (for browser access)
  if (req.query.password === password) return next();

  // Check cookie
  if (req.headers.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(';').map(c => c.trim().split('='))
    );
    if (cookies.admin_auth === password) return next();
  }

  // If it's the admin page, show a login prompt
  if (req.path === '/admin' || req.path === '/admin/') {
    // Check if it's a login POST
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const params = new URLSearchParams(body);
        if (params.get('password') === password) {
          res.setHeader('Set-Cookie', `admin_auth=${password}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`);
          return res.redirect('/admin');
        }
        return res.status(401).send(loginPage('Invalid password'));
      });
      return;
    }
    return res.status(401).send(loginPage());
  }

  // API requests get 401
  res.status(401).json({ error: 'Unauthorized' });
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Palmetto Invoicing — Login</title>
<style>
  * { margin:0;padding:0;box-sizing:border-box; }
  body { background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh; }
  .login { background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;width:320px;text-align:center; }
  .login h1 { color:#4caf50;font-size:18px;margin-bottom:8px; }
  .login p { color:#8b949e;font-size:13px;margin-bottom:20px; }
  .login input { width:100%;background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:10px 14px;border-radius:6px;font-size:14px;margin-bottom:12px; }
  .login button { width:100%;background:#1b5e20;border:none;color:#fff;padding:10px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600; }
  .login button:hover { background:#2e7d32; }
  .error { color:#f85149;font-size:12px;margin-bottom:12px; }
</style></head>
<body>
  <form class="login" method="POST" action="/admin">
    <h1>Palmetto Invoicing</h1>
    <p>Enter admin password</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <input type="password" name="password" placeholder="Password" autofocus>
    <button type="submit">Sign In</button>
  </form>
</body></html>`;
}

// --- Routes ---

// Admin pages (password protected)
app.all('/admin', adminAuth);
app.all('/admin/*', adminAuth);
app.all('/api/*', adminAuth);

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// API routes
app.use('/api/invoices', require('./routes/invoices'));

// Webhook routes (no auth — verified by signature)
app.use('/webhooks', require('./routes/webhooks'));
app.use('/stripe', require('./routes/stripe'));

// Payment success/cancelled pages
app.get('/payment/success', (req, res) => {
  const invoiceNumber = req.query.invoice || '';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Successful</title>
<style>
  body { background:#0d1117;color:#c9d1d9;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0; }
  .card { background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;text-align:center;max-width:440px; }
  h1 { color:#4caf50;font-size:24px;margin-bottom:12px; }
  p { color:#8b949e;font-size:14px;line-height:1.6; }
  .invoice { color:#58a6ff;font-weight:600; }
</style></head>
<body>
  <div class="card">
    <h1>Payment Successful</h1>
    <p>Thank you! Your payment for invoice <span class="invoice">${invoiceNumber}</span> has been received.</p>
    <p style="margin-top:16px;">Your order will be processed and shipped shortly. You'll receive a confirmation email from Palmetto Peptides.</p>
  </div>
</body></html>`);
});

app.get('/payment/cancelled', (req, res) => {
  const invoiceNumber = req.query.invoice || '';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Cancelled</title>
<style>
  body { background:#0d1117;color:#c9d1d9;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0; }
  .card { background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;text-align:center;max-width:440px; }
  h1 { color:#f0883e;font-size:24px;margin-bottom:12px; }
  p { color:#8b949e;font-size:14px;line-height:1.6; }
  a { color:#58a6ff;text-decoration:none; }
</style></head>
<body>
  <div class="card">
    <h1>Payment Cancelled</h1>
    <p>Your payment for invoice <strong>${invoiceNumber}</strong> was not completed.</p>
    <p style="margin-top:16px;">If you'd like to complete your payment, check your email for the invoice link or contact <a href="mailto:Support@palmettopeps.com">Support@palmettopeps.com</a>.</p>
  </div>
</body></html>`);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    stripe: !!process.env.STRIPE_SECRET_KEY,
    sendgrid: !!process.env.SENDGRID_API_KEY,
    appUrl: process.env.APP_URL || 'NOT SET',
  });
});

// --- Start ---
const { initSchema } = require('./db/database');

initSchema()
  .then(() => {
    console.log('[server] Database schema initialized');
    app.listen(PORT, () => {
      console.log(`[server] Palmetto Invoicing running on port ${PORT}`);
      console.log(`[server] Admin dashboard: http://localhost:${PORT}/admin`);
      console.log(`[server] Health check: http://localhost:${PORT}/health`);
    });
  })
  .catch(err => {
    console.error('[server] Failed to initialize database:', err);
    process.exit(1);
  });
