#!/usr/bin/env python3
"""
send_invoice.py - Palmetto Payments LLC Invoice Emailer

Sends a branded invoice email with the PDF attached via SMTP.

Required environment variables:
    SMTP_HOST   SMTP server hostname
    SMTP_PORT   SMTP port (default 587)
    SMTP_USER   SMTP username
    SMTP_PASS   SMTP password
    SMTP_FROM   From address (e.g. "Palmetto Payments <billing@palmettopeps.com>")

Optional:
    STRIPE_PAYMENT_LINK   Stripe payment URL

Usage:
    python3 send_invoice.py <order_number> <customer_email> <customer_name> <pdf_path> [stripe_link]
    python3 send_invoice.py  # test mode with sample data (no real send)
"""

import json
import os
import smtplib
import sys
from email.mime.application import MIMEApplication
from email.mime.multipart  import MIMEMultipart
from email.mime.text        import MIMEText
from pathlib import Path

# ── Brand ─────────────────────────────────────────────────────────────────────
COMPANY_NAME    = "Palmetto Payments LLC"
COMPANY_EMAIL   = "support@palmettopeps.com"
COMPANY_WEBSITE = "palmettopeps.com"
REPLY_TO        = "support@palmettopeps.com"

DEFAULT_STRIPE  = os.environ.get("STRIPE_PAYMENT_LINK", "https://buy.stripe.com/PLACEHOLDER")

# ── SMTP config from env ───────────────────────────────────────────────────────
def get_smtp_config() -> dict:
    required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]
    missing  = [k for k in required if not os.environ.get(k)]
    if missing:
        raise EnvironmentError(
            f"Missing required env vars: {', '.join(missing)}\n"
            "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM."
        )
    return {
        "host": os.environ["SMTP_HOST"],
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": os.environ["SMTP_USER"],
        "pass": os.environ["SMTP_PASS"],
        "from": os.environ["SMTP_FROM"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Email template
# ─────────────────────────────────────────────────────────────────────────────

def build_html_body(
    customer_name: str,
    order_number: str,
    items: list,
    total: float,
    due_date: str,
    stripe_link: str,
    currency: str = "USD",
) -> str:
    sym = "$" if currency == "USD" else currency + " "

    rows = ""
    for item in items:
        rows += f"""
            <tr>
              <td style="padding:10px 8px;border-bottom:1px solid #333;color:#e0e0e0">{item['name']}</td>
              <td style="padding:10px 8px;border-bottom:1px solid #333;text-align:center;color:#bbb">{item['qty']}</td>
              <td style="padding:10px 8px;border-bottom:1px solid #333;text-align:right;color:#e0e0e0">{sym}{item['unit']:.2f}</td>
              <td style="padding:10px 8px;border-bottom:1px solid #333;text-align:right;color:#e0e0e0">{sym}{item['subtotal']:.2f}</td>
            </tr>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d1a;padding:32px 0">
    <tr><td align="center">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#161625;border-radius:8px;overflow:hidden;max-width:600px;width:100%">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a2e;padding:28px 32px;border-bottom:3px solid #1a73e8">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800">{COMPANY_NAME}</h1>
            <p style="margin:4px 0 0;color:#8888aa;font-size:11px;letter-spacing:1.5px;text-transform:uppercase">
              Research Billing Services
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px">

            <!-- Greeting -->
            <p style="color:#e0e0e0;font-size:16px;line-height:1.6;margin:0 0 16px">
              Hi <strong style="color:#ffffff">{customer_name}</strong>,
            </p>
            <p style="color:#aaaacc;font-size:14px;line-height:1.7;margin:0 0 24px">
              Thank you for your order. Your invoice is ready — please complete payment to confirm
              your order and begin processing.
            </p>

            <!-- Invoice badge -->
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="background:#0d0d1a;border:1px solid #333;border-radius:4px;padding:12px 20px">
                  <span style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px">Invoice</span>
                  <span style="color:#ffffff;font-size:16px;font-weight:700;margin-left:10px">INV-{order_number}</span>
                  &nbsp;&nbsp;
                  <span style="color:#d32f2f;font-weight:800;font-size:12px;letter-spacing:2px;
                               border:2px solid #d32f2f;padding:2px 8px;border-radius:2px">UNPAID</span>
                  <br>
                  <span style="color:#888;font-size:11px">Due by: {due_date}</span>
                </td>
              </tr>
            </table>

            <!-- Line items -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
              <thead>
                <tr style="background:#1a1a2e">
                  <th style="padding:10px 8px;text-align:left;color:#aaa;font-size:11px;
                             text-transform:uppercase;letter-spacing:0.8px">Item</th>
                  <th style="padding:10px 8px;text-align:center;color:#aaa;font-size:11px;
                             text-transform:uppercase;letter-spacing:0.8px">Qty</th>
                  <th style="padding:10px 8px;text-align:right;color:#aaa;font-size:11px;
                             text-transform:uppercase;letter-spacing:0.8px">Price</th>
                  <th style="padding:10px 8px;text-align:right;color:#aaa;font-size:11px;
                             text-transform:uppercase;letter-spacing:0.8px">Total</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="padding:14px 8px 4px;text-align:right;color:#aaa;font-size:13px">
                    <strong>Total Due</strong>
                  </td>
                  <td style="padding:14px 8px 4px;text-align:right;font-size:18px;
                             font-weight:800;color:#ffffff;border-top:2px solid #444">
                    {sym}{total:.2f}
                  </td>
                </tr>
              </tfoot>
            </table>

            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px">
              <tr>
                <td align="center">
                  <a href="{stripe_link}"
                     style="display:inline-block;background:#1a73e8;color:#ffffff;
                            text-decoration:none;padding:16px 40px;border-radius:6px;
                            font-size:16px;font-weight:700;letter-spacing:0.3px">
                    💳 Pay Now — {sym}{total:.2f}
                  </a>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top:10px">
                  <a href="{stripe_link}" style="color:#1a73e8;font-size:12px;word-break:break-all">
                    {stripe_link}
                  </a>
                </td>
              </tr>
            </table>

            <!-- PDF note -->
            <p style="color:#888;font-size:13px;margin:0 0 24px;padding:12px;
                      background:#0d0d1a;border-radius:4px;border-left:3px solid #444">
              📎 Your invoice PDF is attached to this email for your records.
            </p>

            <!-- Questions -->
            <p style="color:#aaa;font-size:13px;margin:0">
              Questions? Just reply to this email and we'll get back to you promptly.
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0d0d1a;padding:18px 32px;border-top:1px solid #222;text-align:center">
            <p style="color:#555;font-size:11px;margin:0">
              {COMPANY_NAME} &nbsp;·&nbsp; {COMPANY_EMAIL} &nbsp;·&nbsp; {COMPANY_WEBSITE}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>"""


def build_plain_body(
    customer_name: str,
    order_number: str,
    items: list,
    total: float,
    due_date: str,
    stripe_link: str,
    currency: str = "USD",
) -> str:
    sym = "$" if currency == "USD" else currency + " "
    lines = [
        f"{COMPANY_NAME} — Research Billing Services",
        "=" * 50,
        "",
        f"Hi {customer_name},",
        "",
        "Thank you for your order. Please complete payment to confirm.",
        "",
        f"Invoice:   INV-{order_number}",
        f"Status:    UNPAID",
        f"Due:       {due_date}",
        "",
        "ITEMS",
        "-" * 40,
    ]
    for item in items:
        lines.append(f"  {item['name']}  x{item['qty']}  {sym}{item['subtotal']:.2f}")
    lines += [
        "-" * 40,
        f"  TOTAL:  {sym}{total:.2f}",
        "",
        f"PAY NOW: {stripe_link}",
        "",
        "Questions? Reply to this email.",
        "",
        f"{COMPANY_NAME} | {COMPANY_EMAIL} | {COMPANY_WEBSITE}",
    ]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Core send function
# ─────────────────────────────────────────────────────────────────────────────

def send_invoice(
    order_number: str,
    customer_email: str,
    customer_name:  str,
    invoice_pdf_path: str | None,
    stripe_link: str = None,
    items: list = None,
    total: float = 0.0,
    due_date: str = "",
    currency: str = "USD",
    dry_run: bool = False,
) -> bool:
    """
    Send the invoice email.

    Args:
        order_number:      Shopify order number (digits only)
        customer_email:    Recipient email
        customer_name:     Customer display name
        invoice_pdf_path:  Path to PDF file (None if HTML-only)
        stripe_link:       Stripe payment URL
        items:             List of line-item dicts {name, qty, unit, subtotal}
        total:             Invoice total (float)
        due_date:          Human-readable due date string
        currency:          "USD" or ISO code
        dry_run:           If True, print email instead of sending

    Returns:
        True on success, False on failure
    """
    stripe_link = stripe_link or DEFAULT_STRIPE
    items       = items or []
    subject     = f"Your Palmetto Research Invoice #INV-{order_number}"

    html_body  = build_html_body(customer_name, order_number, items, total, due_date, stripe_link, currency)
    plain_body = build_plain_body(customer_name, order_number, items, total, due_date, stripe_link, currency)

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["To"]      = customer_email
    msg["Reply-To"]= REPLY_TO

    # Prefer HTML, fallback to plain
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(plain_body, "plain", "utf-8"))
    alt.attach(MIMEText(html_body,  "html",  "utf-8"))
    msg.attach(alt)

    # Attach PDF if available
    if invoice_pdf_path and Path(invoice_pdf_path).exists():
        with open(invoice_pdf_path, "rb") as fh:
            pdf_part = MIMEApplication(fh.read(), _subtype="pdf")
            pdf_part.add_header(
                "Content-Disposition",
                "attachment",
                filename=f"INV-{order_number}.pdf",
            )
            msg.attach(pdf_part)
        print(f"📎 Attached PDF: {invoice_pdf_path}")
    else:
        print("⚠️  No PDF attached (file not found or not generated).")

    if dry_run:
        print("\n" + "=" * 60)
        print(f"DRY RUN — would send to: {customer_email}")
        print(f"Subject: {subject}")
        print("=" * 60)
        print(plain_body)
        return True

    try:
        cfg = get_smtp_config()
        msg["From"] = cfg["from"]

        with smtplib.SMTP(cfg["host"], cfg["port"]) as server:
            server.ehlo()
            server.starttls()
            server.login(cfg["user"], cfg["pass"])
            server.sendmail(cfg["from"], [customer_email], msg.as_string())

        print(f"✅ Invoice email sent to {customer_email}")
        return True

    except EnvironmentError as e:
        print(f"❌ Config error: {e}")
        return False
    except smtplib.SMTPException as e:
        print(f"❌ SMTP error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # send_invoice.py <order_number> <email> <name> <pdf_path> [stripe_link]
    if len(sys.argv) >= 4:
        order_num    = sys.argv[1]
        cust_email   = sys.argv[2]
        cust_name    = sys.argv[3]
        pdf_path     = sys.argv[4] if len(sys.argv) > 4 else None
        stripe       = sys.argv[5] if len(sys.argv) > 5 else DEFAULT_STRIPE

        send_invoice(
            order_number      = order_num,
            customer_email    = cust_email,
            customer_name     = cust_name,
            invoice_pdf_path  = pdf_path,
            stripe_link       = stripe,
            items             = [{"name": "Research Product", "qty": 1, "unit": 0, "subtotal": 0}],
            total             = 0.0,
            due_date          = "N/A",
        )
    else:
        print("Test mode (dry run — no SMTP required)")
        send_invoice(
            order_number      = "1001",
            customer_email    = "customer@example.com",
            customer_name     = "Jane Doe",
            invoice_pdf_path  = "/tmp/invoices/INV-1001.pdf",
            stripe_link       = "https://buy.stripe.com/PLACEHOLDER",
            items             = [
                {"name": "Glow Stack", "qty": 1, "unit": 128.00, "subtotal": 128.00},
            ],
            total             = 128.00,
            due_date          = "March 15, 2026",
            dry_run           = True,
        )
