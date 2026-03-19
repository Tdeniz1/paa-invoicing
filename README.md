# Palmetto Invoicing System

Branded invoice generation, Stripe payment processing, and Shopify integration for Palmetto Peptides.

**Stack:** Node.js + Express, SQLite (better-sqlite3), Stripe Checkout, Shopify webhooks, Puppeteer PDF, Nodemailer

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your keys
cp .env.example .env

# 3. Start the server
npm start
# → http://localhost:3001/admin
```

---

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `ADMIN_PASSWORD` | Yes | Password for the admin dashboard |
| `SHOPIFY_STORE` | Yes | Your Shopify store domain (e.g. `hz30rs-js.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN` | Yes | Shopify Admin API access token |
| `SHOPIFY_WEBHOOK_SECRET` | Yes | Webhook HMAC secret from Shopify |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key (sk_live_... or sk_test_...) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret (whsec_...) |
| `EMAIL_FROM` | Yes | Sender email address |
| `SENDGRID_API_KEY` | Option A | SendGrid API key for email delivery |
| `SMTP_HOST` | Option B | SMTP server hostname |
| `SMTP_PORT` | Option B | SMTP port (587 for TLS, 465 for SSL) |
| `SMTP_USER` | Option B | SMTP username |
| `SMTP_PASS` | Option B | SMTP password (use app-specific password) |
| `APP_URL` | Yes | Public URL of this server (for Stripe redirects) |

### 2. Shopify Setup

**Create the "Pay by Invoice" payment method:**
1. Shopify Admin -> Settings -> Payments -> Manual payment methods
2. Add custom payment method: **"Pay by Invoice"**
3. Instructions: "You will receive an invoice via email within a few minutes."

**Register the webhook:**
1. Shopify Admin -> Settings -> Notifications -> Webhooks
2. Add webhook:
   - Event: `Order creation`
   - URL: `https://your-domain.com/webhooks/shopify/orders`
   - Format: JSON
3. Copy the webhook signing secret to `SHOPIFY_WEBHOOK_SECRET`

**Get API credentials:**
1. Shopify Admin -> Settings -> Apps -> Develop apps
2. Create app with scopes: `read_orders`, `write_orders`
3. Install app and copy the Admin API access token to `SHOPIFY_ACCESS_TOKEN`

### 3. Stripe Setup

1. Create a Stripe account at stripe.com
2. Get your API keys from the Dashboard -> Developers -> API keys
3. Set up webhooks:
   - URL: `https://your-domain.com/stripe/webhook`
   - Events: `checkout.session.completed`
4. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### 4. Email Setup

Choose **one** of:

**Option A — SendGrid:**
Set `SENDGRID_API_KEY` in your `.env` file.

**Option B — SMTP:**
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS`. For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833).

---

## How It Works

```
Customer chooses "Pay by Invoice" at checkout on palmettopeptides.com
    │
    ▼
Shopify sends order webhook → POST /webhooks/shopify/orders
    │
    ▼
Server creates invoice (PP-YYYY-XXXX) in SQLite
    │
    ▼
Server creates Stripe Checkout Session (one-time payment link)
    │
    ▼
Server generates branded PDF invoice (Puppeteer)
    │
    ▼
Server emails customer: PDF attached + "Pay Now" button
    │
    ▼
Customer clicks "Pay Now" → Stripe Checkout page
    │
    ▼
Customer pays → Stripe webhook → POST /stripe/webhook
    │
    ▼
Server marks invoice PAID in SQLite
    │
    ▼
Server calls Shopify API to mark order as paid
    │
    ▼
Tony sees paid order in Shopify → ships it
```

---

## Admin Dashboard

Access at `http://localhost:3001/admin` (password protected).

Features:
- View all invoices with status filtering (pending / paid / cancelled)
- Stats: total pending $, total paid $, invoices this month
- Create invoices manually
- Resend invoice emails
- Mark invoices as paid manually
- View invoice details (line items, Stripe link, Shopify order)

---

## API Endpoints

All `/api/*` routes require admin authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/invoices` | List invoices (query: `?status=pending`) |
| GET | `/api/invoices/:id` | Get single invoice |
| POST | `/api/invoices` | Create invoice manually |
| POST | `/api/invoices/:id/send` | Generate PDF + Stripe link + send email |
| POST | `/api/invoices/:id/resend` | Resend invoice email |
| POST | `/api/invoices/:id/mark-paid` | Mark as paid manually |
| POST | `/api/invoices/:id/cancel` | Cancel invoice |
| GET | `/api/invoices/stats/summary` | Dashboard stats |

Webhook endpoints (signature-verified, no auth):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/shopify/orders` | Shopify order created |
| POST | `/stripe/webhook` | Stripe checkout completed |

Other:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/payment/success` | Post-payment success page |
| GET | `/payment/cancelled` | Payment cancelled page |

---

## Invoice Format

- **Number format:** PP-YYYY-XXXX (e.g. PP-2026-0001)
- **Due date:** NET 7 (7 days from creation)
- **PDF:** Branded with Palmetto Peptides logo, green theme
- **Email:** Dark-themed HTML email with line items and "Pay Now" button

---

## Project Structure

```
invoicing/
├── assets/
│   ├── palmetto-peptides-logo.jpg
│   └── palmetto-ai-automation-logo.png
├── src/
│   ├── server.js              # Express app entry point
│   ├── routes/
│   │   ├── invoices.js        # Invoice CRUD + send API
│   │   ├── webhooks.js        # Shopify webhook handler
│   │   └── stripe.js          # Stripe webhook handler
│   ├── services/
│   │   ├── invoiceService.js  # Invoice creation + send orchestration
│   │   ├── emailService.js    # Nodemailer email delivery
│   │   ├── pdfService.js      # Puppeteer PDF generation
│   │   ├── shopifyService.js  # Shopify API + HMAC verification
│   │   └── stripeService.js   # Stripe Checkout Sessions
│   ├── templates/
│   │   ├── invoice-peptides.html  # PDF invoice template
│   │   └── email-peptides.html    # Email body template
│   ├── db/
│   │   └── database.js        # SQLite setup + queries
│   └── admin/
│       └── index.html         # Admin dashboard
├── data/                      # SQLite database (created at runtime)
├── .env.example
├── package.json
└── README.md
```

---

## Deployment

**Development:** Run locally on port 3001. Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) to expose webhooks.

```bash
# Terminal 1
npm start

# Terminal 2 (expose for Stripe/Shopify webhooks)
ngrok http 3001
```

**Production:** Deploy to a VPS or Railway.app behind `invoices.palmettoaiautomation.com`. Make sure Puppeteer dependencies are installed on the server (Chromium).

---

## Legacy Scripts

The original Python scripts (`generate_invoice.py`, `send_invoice.py`, `watch_orders.py`, `send_approved.py`) are from the previous polling-based pipeline. This Node.js system replaces them with real-time webhook processing.
