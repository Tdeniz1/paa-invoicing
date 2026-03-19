# Palmetto Invoicing System — Build Spec

## Overview
A Node.js web application that generates branded invoices, sends them via email, and processes payments via Stripe. Phase 1 focuses exclusively on Palmetto Peptides (Shopify integration). Phase 2 (PAA clients) is out of scope for now.

---

## Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Email:** Nodemailer (SMTP or SendGrid)
- **Payments:** Stripe (Checkout or Payment Links)
- **PDF Generation:** Puppeteer or pdfkit (for invoice PDF)
- **Shopify Integration:** Shopify REST Admin API (webhooks + order update)
- **Database:** SQLite (via better-sqlite3) — lightweight, no server needed
- **Frontend:** Simple HTML/CSS admin dashboard (no framework needed)

---

## Directory Structure
```
invoicing/
├── assets/
│   ├── palmetto-peptides-logo.jpg
│   └── palmetto-ai-automation-logo.png
├── src/
│   ├── server.js              # Express app entry point
│   ├── routes/
│   │   ├── invoices.js        # Invoice CRUD + send
│   │   ├── webhooks.js        # Shopify webhook handler
│   │   └── stripe.js          # Stripe webhook + payment links
│   ├── services/
│   │   ├── invoiceService.js  # Invoice generation logic
│   │   ├── emailService.js    # Send invoice emails
│   │   ├── pdfService.js      # Generate invoice PDF
│   │   ├── shopifyService.js  # Shopify API calls
│   │   └── stripeService.js   # Stripe API calls
│   ├── templates/
│   │   ├── invoice-peptides.html  # Palmetto Peptides branded invoice template
│   │   └── email-peptides.html    # Email body template
│   ├── db/
│   │   └── database.js        # SQLite setup + queries
│   └── admin/
│       └── index.html         # Simple admin dashboard
├── .env.example
├── package.json
└── README.md
```

---

## Phase 1: Palmetto Peptides Flow

### The Complete Flow
1. Customer on palmettopeptides.com chooses "Pay by Invoice" at checkout
2. Shopify sends a webhook to our server (order created, payment pending)
3. Server creates an invoice record in SQLite
4. Server generates a branded PDF invoice (Palmetto Peptides logo, order details, total)
5. Server sends email to customer with PDF attached + "Pay Now" button
6. Customer clicks "Pay Now" → Stripe Checkout page
7. Customer pays → Stripe sends webhook to our server
8. Server marks invoice as PAID in SQLite
9. Server calls Shopify API to mark the order as paid
10. Tony sees the order as paid in Shopify → ships it

### Shopify Integration
- **Webhook:** `orders/create` — fires when a new order is placed
- Filter: only process orders where `payment_gateway` = `"pay-by-invoice"` (custom payment method we set up)
- **API Call to mark paid:** `POST /admin/api/2024-01/orders/{order_id}/transactions.json`
  - body: `{ transaction: { kind: "capture", status: "success", amount: "{total}" } }`

### Stripe Integration
- Use **Stripe Payment Links** or **Stripe Checkout Sessions**
- Create a one-time payment link per invoice
- Webhook: `checkout.session.completed` → mark invoice paid

### Invoice PDF Design (Palmetto Peptides)
- Logo: `assets/palmetto-peptides-logo.jpg` — top left
- Brand colors: match palmettopeptides.com (dark/green aesthetic)
- Fields:
  - Invoice #, Date, Due Date (NET 7)
  - Bill To: customer name, email, shipping address
  - Line items: product name, qty, unit price, subtotal
  - Subtotal, Shipping, Tax, **Total**
  - Payment link / QR code
  - Footer: "Palmetto Peptides | palmettopeptides.com | Support@palmettopeps.com"

---

## Database Schema (SQLite)

```sql
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,  -- e.g. "PP-2026-0001"
  brand TEXT NOT NULL,                   -- "palmetto-peptides" | "paa"
  shopify_order_id TEXT,
  shopify_order_number TEXT,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_address TEXT,
  line_items TEXT NOT NULL,              -- JSON array
  subtotal REAL NOT NULL,
  shipping REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL NOT NULL,
  stripe_payment_link TEXT,
  stripe_session_id TEXT,
  status TEXT DEFAULT 'pending',         -- pending | paid | cancelled
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME
);
```

---

## Admin Dashboard (Simple)
A minimal HTML page at `/admin` (password protected via env var) showing:
- List of all invoices (invoice #, customer, total, status, date)
- Filter by: status (pending/paid), date range
- Per invoice: view details, resend email, mark paid manually
- Basic stats: total pending $, total paid $, # invoices this month

---

## Environment Variables (.env)
```
PORT=3001
ADMIN_PASSWORD=changeme

# Shopify
SHOPIFY_STORE=hz30rs-js.myshopify.com
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Email (use SendGrid or SMTP)
EMAIL_FROM=invoices@palmettopeptides.com
SENDGRID_API_KEY=
# OR SMTP:
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# App
APP_URL=https://invoices.palmettoaiautomation.com
```

---

## Shopify "Pay by Invoice" Payment Method Setup
- In Shopify Admin → Settings → Payments → Manual payment methods
- Add: "Pay by Invoice" with instructions: "You will receive an invoice via email within a few minutes. Complete payment online to confirm your order."
- This sets `payment_gateway` = "pay-by-invoice" on the order

---

## Deployment
- Run on Tony's Mac Mini initially (Node.js, port 3001)
- Use ngrok or Cloudflare Tunnel to expose for Stripe/Shopify webhooks during dev
- Production: deploy to a VPS or Railway.app behind a subdomain (e.g. invoices.palmettoaiautomation.com)

---

## Out of Scope (Phase 2)
- PAA client invoicing (monthly retainers, project invoices)
- PAA branded invoice template
- QuickBooks/accounting sync
- Multi-user admin access
- Recurring invoice automation

---

## Success Criteria
- [ ] Customer can place a Shopify order with "Pay by Invoice"
- [ ] Invoice email arrives within 2 minutes with PDF attached
- [ ] Customer can pay via Stripe from the email link
- [ ] Shopify order auto-marks as paid after Stripe payment
- [ ] Admin dashboard shows paid vs pending invoices
- [ ] Tony can manually resend or mark an invoice paid from the dashboard
