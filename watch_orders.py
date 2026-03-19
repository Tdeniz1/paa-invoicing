#!/usr/bin/env python3
"""
watch_orders.py - Polls Shopify for pending "manual" payment orders

Designed to run every 15 minutes via cron:
    */15 * * * * cd /Users/prozak/.openclaw/workspace/invoicing && python3 watch_orders.py

Flow:
1. Poll Shopify for orders with payment_gateway="manual" and financial_status="pending"
2. Skip orders already tracked in /tmp/invoices/processed_orders.json
3. For each NEW pending invoice order:
   - Generate invoice (calls generate_invoice.py)
   - Save order data to /tmp/invoices/pending_approval/{order_number}.json
   - Send Tony a notification (via message tool or stdout for Telegram)
   - Add order ID to processed_orders.json
"""

import json
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
OUTPUT_DIR       = Path("/tmp/invoices")
PENDING_DIR      = OUTPUT_DIR / "pending_approval"
SENT_DIR         = OUTPUT_DIR / "sent"
PROCESSED_FILE   = OUTPUT_DIR / "processed_orders.json"

# ── Shopify ───────────────────────────────────────────────────────────────────
SHOPIFY_STORE    = "hz30rs-js.myshopify.com"
SHOPIFY_API      = f"https://{SHOPIFY_STORE}/admin/api/2024-01"
SECRETS_DIR      = Path.home() / ".openclaw/workspace/.secrets"
TOKEN_FILE       = SECRETS_DIR / "shopify_token.txt"

# ── Helpers ───────────────────────────────────────────────────────────────────

def ensure_dirs():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    SENT_DIR.mkdir(parents=True, exist_ok=True)


def load_shopify_token() -> str:
    if not TOKEN_FILE.exists():
        raise FileNotFoundError(
            f"Shopify token not found at {TOKEN_FILE}\n"
            "Create that file with your Admin API access token."
        )
    return TOKEN_FILE.read_text().strip()


def load_processed() -> set:
    if not PROCESSED_FILE.exists():
        return set()
    try:
        data = json.loads(PROCESSED_FILE.read_text())
        return set(data.get("order_ids", []))
    except Exception:
        return set()


def save_processed(order_ids: set):
    data = {
        "order_ids": sorted(order_ids),
        "last_updated": datetime.utcnow().isoformat() + "Z",
    }
    PROCESSED_FILE.write_text(json.dumps(data, indent=2))


def send_notification(message: str):
    """
    Sends notification to Tony. Try to use the Telegram message tool if available,
    otherwise print to stdout (which can be captured by the main agent).
    """
    print(f"\n🔔 NOTIFICATION: {message}\n")

    # Try to use openclaw message tool via subprocess if configured
    try:
        import subprocess
        # This assumes a channel is configured; silently ignore failures
        subprocess.run(
            ["openclaw", "message", "send", "--target", "1557290767", "--message", message],
            capture_output=True,
            timeout=10,
        )
    except Exception:
        pass  # Fallback to stdout only


# ─────────────────────────────────────────────────────────────────────────────
# Shopify API
# ─────────────────────────────────────────────────────────────────────────────

def shopify_api_request(endpoint: str) -> dict:
    token = load_shopify_token()
    url   = f"{SHOPIFY_API}{endpoint}"
    req   = urllib.request.Request(
        url,
        headers={"X-Shopify-Access-Token": token},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get_pending_manual_orders(since_id: str = None) -> list:
    """
    Fetch orders with:
      - payment_gateway = "manual"
      - financial_status = "pending"
    Uses pagination via since_id for safety.
    """
    # Query parameters
    params = [
        "financial_status=pending",
        "limit=250",  # max page size
        "status=open",
    ]
    if since_id:
        params.append(f"since_id={since_id}")

    endpoint = f"/orders.json?{'&'.join(params)}"
    result   = shopify_api_request(endpoint)
    orders   = result.get("orders", [])

    # Filter to manual gateway only
    filtered = [
        o for o in orders
        if o.get("gateway") == "manual" or o.get("payment_gateway_names", []) == ["manual"]
    ]
    return filtered


# ─────────────────────────────────────────────────────────────────────────────
# Invoice generation wrapper
# ─────────────────────────────────────────────────────────────────────────────

def generate_invoice_for_order(order: dict) -> dict:
    """
    Import and call generate_invoice module.
    Returns dict with pdf/html paths.
    """
    # Import the generate_invoice module from same directory
    sys.path.insert(0, str(Path(__file__).parent))
    import generate_invoice as gi

    return gi.generate_invoice(order)


# ─────────────────────────────────────────────────────────────────────────────
# Main watch loop
# ─────────────────────────────────────────────────────────────────────────────

def main():
    ensure_dirs()
    processed = load_processed()

    print(f"[{datetime.utcnow().isoformat()}Z] Watching Shopify for pending manual orders...")

    try:
        orders = get_pending_manual_orders()
    except Exception as e:
        print(f"❌ Failed to fetch orders: {e}")
        sys.exit(1)

    new_orders = []
    for order in orders:
        oid = str(order.get("id", ""))
        if oid and oid not in processed:
            new_orders.append(order)

    if not new_orders:
        print("✅ No new pending orders.")
        return

    print(f"📋 Found {len(new_orders)} new pending order(s) to process.")

    for order in new_orders:
        oid    = str(order.get("id"))
        onum   = str(order.get("order_number", order.get("name", "unknown"))).lstrip("#")
        cname  = (order.get("customer") or {}).get("first_name", "Customer")
        clname = (order.get("customer") or {}).get("last_name", "")
        full_name = f"{cname} {clname}".strip()
        total  = float(order.get("total_price", 0))
        email  = order.get("email") or (order.get("customer") or {}).get("email", "")

        print(f"\n→ Processing order #{onum} — {full_name} — ${total:.2f}")

        # Generate invoice
        try:
            inv_result = generate_invoice_for_order(order)
            print(f"  Invoice generated: {inv_result['invoice_num']}")
            print(f"  PDF:  {inv_result.get('pdf') or '(none)'}")
            print(f"  HTML: {inv_result.get('html')}")
        except Exception as e:
            print(f"  ⚠️  Invoice generation failed: {e}")
            inv_result = {"pdf": None, "html": None, "invoice_num": f"INV-{onum}"}

        # Save pending approval file
        pending_file = PENDING_DIR / f"{onum}.json"
        pending_data = {
            "order_id":         oid,
            "order_number":     onum,
            "customer_name":    full_name,
            "customer_email":   email,
            "total":            total,
            "currency":         order.get("currency", "USD"),
            "invoice_pdf":      inv_result.get("pdf"),
            "invoice_html":     inv_result.get("html"),
            "detected_at":      datetime.utcnow().isoformat() + "Z",
            "status":           "pending_approval",
            "raw_order":        order,
        }
        pending_file.write_text(json.dumps(pending_data, indent=2))
        print(f"  Saved to: {pending_file}")

        # Send notification to Tony
        notif_msg = (
            f"📋 New invoice order #{onum} — {full_name} — ${total:.2f}\n"
            f"Reply 'send {onum}' to email invoice to {email}"
        )
        send_notification(notif_msg)

        # Mark as processed
        processed.add(oid)
        save_processed(processed)
        print(f"  Added to processed orders.")

    print(f"\n✅ Done. Processed {len(new_orders)} order(s).")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    main()
