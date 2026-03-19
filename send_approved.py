#!/usr/bin/env python3
"""
send_approved.py - Send approved invoice to customer

Usage:
    python3 send_approved.py <order_number>

Example:
    python3 send_approved.py 1234

Flow:
1. Find pending approval file: /tmp/invoices/pending_approval/{order_number}.json
2. Generate invoice if not already generated
3. Send invoice email to customer
4. Move order file to /tmp/invoices/sent/{order_number}.json
5. Confirm success
"""

import json
import os
import sys
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
OUTPUT_DIR    = Path("/tmp/invoices")
PENDING_DIR   = OUTPUT_DIR / "pending_approval"
SENT_DIR      = OUTPUT_DIR / "sent"

# ── Stripe link from env ───────────────────────────────────────────────────────
DEFAULT_STRIPE = os.environ.get("STRIPE_PAYMENT_LINK", "https://buy.stripe.com/PLACEHOLDER")


def find_pending_order(order_number: str) -> dict | None:
    """Load the pending order data file."""
    pending_file = PENDING_DIR / f"{order_number}.json"
    if not pending_file.exists():
        return None
    try:
        return json.loads(pending_file.read_text())
    except Exception as e:
        print(f"❌ Failed to read pending file: {e}")
        sys.exit(1)


def generate_invoice_for_order(order: dict, stripe_link: str = None) -> dict:
    """Call generate_invoice module."""
    sys.path.insert(0, str(Path(__file__).parent))
    import generate_invoice as gi

    return gi.generate_invoice(order, stripe_link=stripe_link)


def send_invoice_email(pending: dict, stripe_link: str = None) -> bool:
    """Call send_invoice module."""
    sys.path.insert(0, str(Path(__file__).parent))
    import send_invoice as si

    order_number   = pending["order_number"]
    customer_email = pending["customer_email"]
    customer_name  = pending["customer_name"]
    pdf_path       = pending.get("invoice_pdf")
    total          = pending["total"]
    currency       = pending.get("currency", "USD")
    raw_order      = pending.get("raw_order", {})

    # Build line items from raw order if available
    items = []
    for it in raw_order.get("line_items", []):
        qty   = int(it.get("quantity", 1))
        price = float(it.get("price", 0))
        items.append({
            "name":     it.get("title", "Product"),
            "qty":      qty,
            "unit":     price,
            "subtotal": round(qty * price, 2),
        })

    # Calculate due date (NET 3 from order created)
    due_date = ""
    try:
        from datetime import datetime, timedelta
        created = raw_order.get("created_at", "")
        if created:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            due_date = (dt + timedelta(days=3)).strftime("%B %d, %Y")
    except Exception:
        due_date = "within 3 days"

    return si.send_invoice(
        order_number     = order_number,
        customer_email   = customer_email,
        customer_name    = customer_name,
        invoice_pdf_path = pdf_path,
        stripe_link      = stripe_link or DEFAULT_STRIPE,
        items            = items,
        total            = total,
        due_date         = due_date,
        currency         = currency,
    )


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 send_approved.py <order_number>")
        print("Example: python3 send_approved.py 1234")
        sys.exit(1)

    order_number = sys.argv[1].strip()
    stripe_override = sys.argv[2] if len(sys.argv) > 2 else None

    # 1. Find pending order
    pending = find_pending_order(order_number)
    if not pending:
        print(f"❌ Pending order #{order_number} not found in {PENDING_DIR}")
        print(f"   Run watch_orders.py first to detect new orders.")
        sys.exit(1)

    print(f"✅ Found pending order #{order_number}")
    print(f"   Customer: {pending['customer_name']} <{pending['customer_email']}>")
    print(f"   Total:    ${pending['total']:.2f}")

    # 2. Generate invoice if missing
    pdf_path = pending.get("invoice_pdf")
    if not pdf_path or not Path(pdf_path).exists():
        print("\n📝 Generating invoice...")
        try:
            raw_order = pending.get("raw_order", {})
            result = generate_invoice_for_order(raw_order, stripe_link=stripe_override or DEFAULT_STRIPE)
            pdf_path = result.get("pdf")
            pending["invoice_pdf"] = pdf_path
            pending["invoice_html"] = result.get("html")
            print(f"   PDF:  {pdf_path or '(none)'}")
            print(f"   HTML: {result.get('html')}")
        except Exception as e:
            print(f"❌ Invoice generation failed: {e}")
            sys.exit(1)
    else:
        print(f"\n📎 Using existing PDF: {pdf_path}")

    # 3. Send email
    print("\n📤 Sending invoice email...")
    success = send_invoice_email(pending, stripe_link=stripe_override)

    if not success:
        print("❌ Failed to send invoice email.")
        sys.exit(1)

    # 4. Move to sent folder
    SENT_DIR.mkdir(parents=True, exist_ok=True)

    pending_file = PENDING_DIR / f"{order_number}.json"
    sent_file    = SENT_DIR / f"{order_number}.json"

    pending["status"]        = "sent"
    pending["sent_at"]       = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    pending["invoice_pdf"]   = pdf_path

    sent_file.write_text(json.dumps(pending, indent=2))
    pending_file.unlink()

    print(f"\n✅ Invoice sent to {pending['customer_email']}")
    print(f"   Moved to: {sent_file}")


if __name__ == "__main__":
    main()
