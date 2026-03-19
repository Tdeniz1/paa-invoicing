#!/usr/bin/env python3
"""
generate_invoice.py - Palmetto Payments LLC Invoice Generator

Generates a professional PDF (or HTML fallback) invoice from a Shopify order.
Branded as Palmetto Payments LLC / Research Billing Services.

Usage:
    python3 generate_invoice.py <order_id>
    python3 generate_invoice.py  # runs with sample data

Output:
    /tmp/invoices/INV-{order_number}.pdf
    /tmp/invoices/INV-{order_number}.html
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ── Output directory ──────────────────────────────────────────────────────────
OUTPUT_DIR = Path("/tmp/invoices")

# ── Brand constants ───────────────────────────────────────────────────────────
COMPANY_NAME    = "Palmetto Payments LLC"
COMPANY_SUB     = "Research Billing Services"
COMPANY_EMAIL   = "support@palmettopeps.com"
COMPANY_WEBSITE = "palmettopeps.com"

DEFAULT_STRIPE_LINK = os.environ.get("STRIPE_PAYMENT_LINK", "https://buy.stripe.com/PLACEHOLDER")

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def ensure_output_dir():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def extract_invoice_data(order: dict) -> dict:
    """Normalise a Shopify order dict into the fields we need for the invoice."""
    sa = order.get("shipping_address") or order.get("billing_address") or {}
    customer = order.get("customer") or {}

    name_parts = [
        sa.get("first_name") or customer.get("first_name") or "",
        sa.get("last_name")  or customer.get("last_name")  or "",
    ]
    full_name = " ".join(p for p in name_parts if p).strip() or "Valued Customer"

    email = (
        order.get("email")
        or customer.get("email")
        or ""
    )

    address_lines = []
    for field in ("address1", "address2", "city"):
        v = sa.get(field, "")
        if v:
            address_lines.append(v)
    state_zip = " ".join(filter(None, [sa.get("province_code", ""), sa.get("zip", "")]))
    if state_zip:
        address_lines.append(state_zip)
    country = sa.get("country", "")
    if country:
        address_lines.append(country)

    issued = datetime.utcnow()
    due    = issued + timedelta(days=3)

    line_items = []
    for item in order.get("line_items", []):
        qty   = int(item.get("quantity", 1))
        price = float(item.get("price", "0"))
        line_items.append({
            "name":     item.get("title", "Product"),
            "sku":      item.get("sku", ""),
            "qty":      qty,
            "unit":     price,
            "subtotal": round(qty * price, 2),
        })

    subtotal  = float(order.get("subtotal_price", "0") or 0)
    total     = float(order.get("total_price",    "0") or 0)
    discount  = round(subtotal - (total - float(order.get("total_tax", "0") or 0) - float(order.get("total_shipping_price_set", {}).get("shop_money", {}).get("amount", "0") or 0)), 2)

    # simpler: use discount_codes sum
    discount_total = sum(
        float(d.get("amount", 0)) for d in order.get("discount_codes", [])
    )

    return {
        "order_number": str(order.get("order_number") or order.get("name", "0000")).lstrip("#"),
        "order_id":     order.get("id", ""),
        "invoice_num":  f"INV-{str(order.get('order_number', '0000')).lstrip('#')}",
        "issued":       issued.strftime("%B %d, %Y"),
        "due":          due.strftime("%B %d, %Y"),
        "customer_name":   full_name,
        "customer_email":  email,
        "address_lines":   address_lines,
        "line_items":      line_items,
        "subtotal":        subtotal,
        "discount":        discount_total,
        "total":           total,
        "stripe_link":     DEFAULT_STRIPE_LINK,
        "currency":        order.get("currency", "USD"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# HTML generation (always produced; used as PDF source or standalone fallback)
# ─────────────────────────────────────────────────────────────────────────────

def generate_html(data: dict) -> str:
    sym = "$" if data["currency"] == "USD" else data["currency"] + " "

    rows = ""
    for item in data["line_items"]:
        rows += f"""
        <tr>
          <td>{item['name']}{('<br><small style="color:#888">' + item['sku'] + '</small>') if item['sku'] else ''}</td>
          <td class="num">{item['qty']}</td>
          <td class="num">{sym}{item['unit']:.2f}</td>
          <td class="num">{sym}{item['subtotal']:.2f}</td>
        </tr>"""

    discount_row = ""
    if data["discount"] > 0:
        discount_row = f"""
        <tr class="discount">
          <td colspan="3" style="text-align:right">Discount</td>
          <td class="num">-{sym}{data['discount']:.2f}</td>
        </tr>"""

    addr_html = "<br>".join(data["address_lines"]) if data["address_lines"] else "—"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice {data['invoice_num']}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #1a1a2e;
    background: #fff;
    padding: 40px;
    max-width: 800px;
    margin: auto;
  }}
  .header {{
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #1a1a2e;
    padding-bottom: 20px;
    margin-bottom: 28px;
  }}
  .brand h1 {{
    font-size: 22px;
    font-weight: 800;
    color: #1a1a2e;
    letter-spacing: -0.5px;
  }}
  .brand p {{
    font-size: 11px;
    color: #666;
    margin-top: 3px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }}
  .invoice-meta {{ text-align: right; }}
  .invoice-meta .inv-num {{
    font-size: 18px;
    font-weight: 700;
    color: #1a1a2e;
  }}
  .invoice-meta p {{ color: #555; margin-top: 4px; font-size: 12px; }}

  .stamp {{
    position: relative;
    display: inline-block;
    border: 4px solid #d32f2f;
    color: #d32f2f;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 4px;
    padding: 6px 18px;
    transform: rotate(-15deg);
    opacity: 0.85;
    float: right;
    margin-top: -10px;
    text-transform: uppercase;
    font-family: 'Courier New', monospace;
  }}

  .grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 28px;
  }}
  .section-label {{
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: #888;
    margin-bottom: 6px;
  }}
  .bill-to p {{ line-height: 1.6; color: #333; }}

  table {{
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }}
  thead th {{
    background: #1a1a2e;
    color: #fff;
    padding: 10px 12px;
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }}
  thead th.num {{ text-align: right; }}
  tbody tr {{ border-bottom: 1px solid #eee; }}
  tbody tr:last-child {{ border-bottom: none; }}
  tbody td {{ padding: 10px 12px; color: #333; line-height: 1.4; }}
  td.num {{ text-align: right; }}
  tr.discount td {{ color: #c62828; }}

  .totals {{
    margin-left: auto;
    width: 280px;
    margin-bottom: 28px;
  }}
  .totals table {{ margin-bottom: 0; }}
  .totals td {{ padding: 6px 8px; color: #444; font-size: 13px; }}
  .totals td:last-child {{ text-align: right; }}
  .totals .total-row td {{
    font-size: 16px;
    font-weight: 700;
    color: #1a1a2e;
    border-top: 2px solid #1a1a2e;
    padding-top: 10px;
  }}

  .payment-box {{
    background: #f0f4ff;
    border-left: 4px solid #1a73e8;
    padding: 16px 20px;
    border-radius: 4px;
    margin-bottom: 28px;
  }}
  .payment-box p {{ color: #333; margin-bottom: 8px; }}
  .payment-box a {{
    display: inline-block;
    background: #1a73e8;
    color: #fff;
    text-decoration: none;
    padding: 10px 24px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 14px;
  }}

  .footer {{
    border-top: 1px solid #ddd;
    padding-top: 14px;
    font-size: 11px;
    color: #999;
    text-align: center;
  }}
</style>
</head>
<body>

<div class="header">
  <div class="brand">
    <h1>{COMPANY_NAME}</h1>
    <p>{COMPANY_SUB}</p>
  </div>
  <div class="invoice-meta">
    <div class="stamp">UNPAID</div>
    <div class="inv-num">{data['invoice_num']}</div>
    <p>Issued: {data['issued']}</p>
    <p>Due: {data['due']} (NET 3)</p>
  </div>
</div>

<div class="grid">
  <div class="bill-to">
    <div class="section-label">Bill To</div>
    <p><strong>{data['customer_name']}</strong></p>
    <p>{data['customer_email']}</p>
    <p>{addr_html}</p>
  </div>
  <div>
    <div class="section-label">From</div>
    <p><strong>{COMPANY_NAME}</strong></p>
    <p>{COMPANY_EMAIL}</p>
    <p>{COMPANY_WEBSITE}</p>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="num">Qty</th>
      <th class="num">Unit Price</th>
      <th class="num">Amount</th>
    </tr>
  </thead>
  <tbody>
    {rows}
    {discount_row}
  </tbody>
</table>

<div class="totals">
  <table>
    <tr><td>Subtotal</td><td>{sym}{data['subtotal']:.2f}</td></tr>
    {'<tr class="discount"><td>Discount</td><td>-' + sym + f"{data['discount']:.2f}</td></tr>" if data['discount'] > 0 else ''}
    <tr class="total-row"><td>Total Due</td><td>{sym}{data['total']:.2f}</td></tr>
  </table>
</div>

<div class="payment-box">
  <p><strong>Payment Required</strong> — Please pay by {data['due']} to confirm your order.</p>
  <a href="{data['stripe_link']}">💳 Pay Now — {sym}{data['total']:.2f}</a>
  <p style="margin-top:8px;font-size:11px;color:#555">Pay securely at: {data['stripe_link']}</p>
</div>

<div class="footer">
  {COMPANY_NAME} &nbsp;|&nbsp; {COMPANY_EMAIL} &nbsp;|&nbsp; {COMPANY_WEBSITE}<br>
  This invoice was generated automatically. Questions? Email {COMPANY_EMAIL}.
</div>

</body>
</html>
"""
    return html


# ─────────────────────────────────────────────────────────────────────────────
# PDF generation via ReportLab
# ─────────────────────────────────────────────────────────────────────────────

def _rl_color(hex_str):
    """Convert #rrggbb to ReportLab Color."""
    from reportlab.lib.colors import HexColor
    return HexColor(hex_str)


def generate_pdf_reportlab(data: dict, pdf_path: Path):
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT

    dark   = HexColor("#1a1a2e")
    blue   = HexColor("#1a73e8")
    red    = HexColor("#d32f2f")
    grey   = HexColor("#888888")
    ltgrey = HexColor("#f5f5f5")
    white  = colors.white

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=LETTER,
        rightMargin=0.65*inch,
        leftMargin=0.65*inch,
        topMargin=0.65*inch,
        bottomMargin=0.65*inch,
    )

    styles = getSampleStyleSheet()
    normal = ParagraphStyle("normal", fontName="Helvetica", fontSize=10, textColor=dark, leading=14)
    small  = ParagraphStyle("small",  fontName="Helvetica", fontSize=8,  textColor=grey, leading=11)
    bold   = ParagraphStyle("bold",   fontName="Helvetica-Bold", fontSize=10, textColor=dark)
    h1     = ParagraphStyle("h1",     fontName="Helvetica-Bold", fontSize=20, textColor=dark)
    h2     = ParagraphStyle("h2",     fontName="Helvetica-Bold", fontSize=13, textColor=dark)
    right  = ParagraphStyle("right",  fontName="Helvetica", fontSize=10, alignment=TA_RIGHT, textColor=dark)
    sym    = "$" if data["currency"] == "USD" else data["currency"] + " "

    story = []

    # ── Header ────────────────────────────────────────────────────────────────
    header_data = [[
        [Paragraph(COMPANY_NAME, h1), Paragraph(COMPANY_SUB.upper(), small)],
        [
            Paragraph(f'<font color="#d32f2f"><b>UNPAID</b></font>', ParagraphStyle(
                "stamp", fontName="Courier-Bold", fontSize=22,
                alignment=TA_RIGHT, textColor=red
            )),
            Spacer(1, 4),
            Paragraph(data["invoice_num"], ParagraphStyle(
                "invnum", fontName="Helvetica-Bold", fontSize=16,
                alignment=TA_RIGHT, textColor=dark
            )),
            Paragraph(f"Issued: {data['issued']}", ParagraphStyle(
                "meta", fontName="Helvetica", fontSize=9,
                alignment=TA_RIGHT, textColor=grey
            )),
            Paragraph(f"Due: {data['due']} (NET 3)", ParagraphStyle(
                "meta2", fontName="Helvetica", fontSize=9,
                alignment=TA_RIGHT, textColor=grey
            )),
        ]
    ]]
    header_tbl = Table(header_data, colWidths=["55%", "45%"])
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 2, dark),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 12),
    ]))
    story.append(header_tbl)
    story.append(Spacer(1, 16))

    # ── Bill To / From ────────────────────────────────────────────────────────
    addr = "\n".join(data["address_lines"]) if data["address_lines"] else "—"
    bill_content = [
        Paragraph("<b>BILL TO</b>", small),
        Paragraph(f"<b>{data['customer_name']}</b>", normal),
        Paragraph(data["customer_email"], normal),
    ]
    for line in data["address_lines"]:
        bill_content.append(Paragraph(line, normal))

    from_content = [
        Paragraph("<b>FROM</b>", small),
        Paragraph(f"<b>{COMPANY_NAME}</b>", normal),
        Paragraph(COMPANY_EMAIL, normal),
        Paragraph(COMPANY_WEBSITE, normal),
    ]

    billing_tbl = Table([[bill_content, from_content]], colWidths=["50%", "50%"])
    billing_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(billing_tbl)
    story.append(Spacer(1, 20))

    # ── Line items ────────────────────────────────────────────────────────────
    li_header = ["Description", "Qty", "Unit Price", "Amount"]
    li_rows   = [li_header]
    for item in data["line_items"]:
        desc = item["name"]
        if item["sku"]:
            desc += f"\n{item['sku']}"
        li_rows.append([
            Paragraph(desc, normal),
            str(item["qty"]),
            f"{sym}{item['unit']:.2f}",
            f"{sym}{item['subtotal']:.2f}",
        ])

    if data["discount"] > 0:
        li_rows.append([
            Paragraph("<i>Discount</i>", ParagraphStyle("disc", fontName="Helvetica-Oblique", fontSize=10, textColor=red)),
            "", "",
            Paragraph(f"-{sym}{data['discount']:.2f}", ParagraphStyle("discamt", fontName="Helvetica", fontSize=10, textColor=red)),
        ])

    col_w = [3.5*inch, 0.7*inch, 1.1*inch, 1.1*inch]
    li_tbl = Table(li_rows, colWidths=col_w, repeatRows=1)
    li_style = [
        ("BACKGROUND",    (0, 0), (-1, 0),  dark),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  white),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0),  9),
        ("ALIGN",         (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN",         (0, 0), (0, -1),  "LEFT"),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [white, ltgrey]),
        ("LINEBELOW",     (0, 0), (-1, -1), 0.5, HexColor("#dddddd")),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]
    li_tbl.setStyle(TableStyle(li_style))
    story.append(li_tbl)
    story.append(Spacer(1, 12))

    # ── Totals ────────────────────────────────────────────────────────────────
    tot_rows = [
        ["Subtotal", f"{sym}{data['subtotal']:.2f}"],
    ]
    if data["discount"] > 0:
        tot_rows.append(["Discount", f"-{sym}{data['discount']:.2f}"])
    tot_rows.append(["TOTAL DUE", f"{sym}{data['total']:.2f}"])

    tot_tbl = Table(tot_rows, colWidths=[1.5*inch, 1.2*inch], hAlign="RIGHT")
    tot_style = [
        ("FONTNAME",      (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 0), (-1, -1), 10),
        ("ALIGN",         (1, 0), (-1, -1), "RIGHT"),
        ("LINEABOVE",     (0, -1), (-1, -1), 1.5, dark),
        ("FONTNAME",      (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",      (0, -1), (-1, -1), 12),
        ("TOPPADDING",    (0, -1), (-1, -1), 8),
    ]
    tot_tbl.setStyle(TableStyle(tot_style))
    story.append(tot_tbl)
    story.append(Spacer(1, 20))

    # ── Payment box ───────────────────────────────────────────────────────────
    pay_data = [[
        Paragraph(
            f"<b>Payment Required</b> — Please pay by {data['due']} to confirm your order.<br/>"
            f"<font color='#1a73e8'>Pay securely at: {data['stripe_link']}</font>",
            ParagraphStyle("pay", fontName="Helvetica", fontSize=10, textColor=dark, leading=16)
        )
    ]]
    pay_tbl = Table(pay_data, colWidths=["100%"])
    pay_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), HexColor("#e8f0fe")),
        ("LINEAFTER",     (0, 0), (0, -1),  0, white),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
        ("TOPPADDING",    (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LINEATLEFT",    (0, 0), (0, -1),  4, blue),
    ]))
    story.append(pay_tbl)
    story.append(Spacer(1, 24))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=grey))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"{COMPANY_NAME} &nbsp;|&nbsp; {COMPANY_EMAIL} &nbsp;|&nbsp; {COMPANY_WEBSITE}",
        ParagraphStyle("footer", fontName="Helvetica", fontSize=8,
                       textColor=grey, alignment=TA_CENTER)
    ))

    doc.build(story)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def generate_invoice(order: dict, stripe_link: str = None) -> dict:
    """
    Generate invoice PDF + HTML from a Shopify order dict.

    Returns:
        { "pdf": str|None, "html": str, "invoice_num": str, "data": dict }
    """
    ensure_output_dir()
    data = extract_invoice_data(order)
    if stripe_link:
        data["stripe_link"] = stripe_link

    # ── HTML (always) ─────────────────────────────────────────────────────────
    html_path = OUTPUT_DIR / f"{data['invoice_num']}.html"
    html_content = generate_html(data)
    html_path.write_text(html_content, encoding="utf-8")
    print(f"✅ HTML invoice saved: {html_path}")

    # ── PDF ───────────────────────────────────────────────────────────────────
    pdf_path = OUTPUT_DIR / f"{data['invoice_num']}.pdf"
    pdf_out  = None

    try:
        generate_pdf_reportlab(data, pdf_path)
        print(f"✅ PDF invoice saved:  {pdf_path}")
        pdf_out = str(pdf_path)
    except ImportError:
        print("⚠️  reportlab not installed — PDF skipped (HTML only).")
        print("   Install with: pip3 install reportlab")
    except Exception as exc:
        print(f"⚠️  PDF generation failed ({exc}) — HTML only.")

    return {
        "pdf":         pdf_out,
        "html":        str(html_path),
        "invoice_num": data["invoice_num"],
        "data":        data,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Shopify fetch helper (used by watch_orders / send_approved)
# ─────────────────────────────────────────────────────────────────────────────

SHOPIFY_STORE = "hz30rs-js.myshopify.com"
SHOPIFY_API   = f"https://{SHOPIFY_STORE}/admin/api/2024-01"
SECRETS_DIR   = Path.home() / ".openclaw/workspace/.secrets"


def load_shopify_token() -> str:
    token_file = SECRETS_DIR / "shopify_token.txt"
    if not token_file.exists():
        raise FileNotFoundError(
            f"Shopify token not found at {token_file}\n"
            "Create the file with your Admin API token."
        )
    return token_file.read_text().strip()


def fetch_order_by_id(order_id: str) -> dict:
    import urllib.request
    token = load_shopify_token()
    url   = f"{SHOPIFY_API}/orders/{order_id}.json"
    req   = urllib.request.Request(url, headers={"X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["order"]


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry-point
# ─────────────────────────────────────────────────────────────────────────────

SAMPLE_ORDER = {
    "id":              9001,
    "order_number":    1001,
    "name":            "#1001",
    "email":           "customer@example.com",
    "currency":        "USD",
    "subtotal_price":  "128.00",
    "total_price":     "128.00",
    "total_tax":       "0.00",
    "financial_status":"pending",
    "payment_gateway": "manual",
    "discount_codes":  [],
    "customer": {"first_name": "Jane", "last_name": "Doe", "email": "customer@example.com"},
    "shipping_address": {
        "first_name":    "Jane",
        "last_name":     "Doe",
        "address1":      "123 Research Blvd",
        "address2":      "Suite 4",
        "city":          "Charleston",
        "province_code": "SC",
        "zip":           "29401",
        "country":       "United States",
    },
    "line_items": [
        {"title": "Glow Stack (BPC-157 + TB-500 + GHK-Cu)", "sku": "GLOW-001", "quantity": 1, "price": "128.00"},
    ],
}


if __name__ == "__main__":
    if len(sys.argv) > 1:
        order_id = sys.argv[1]
        print(f"Fetching Shopify order {order_id}…")
        try:
            order = fetch_order_by_id(order_id)
        except Exception as e:
            print(f"❌ Could not fetch order: {e}")
            sys.exit(1)
    else:
        print("No order ID supplied — using sample order.")
        order = SAMPLE_ORDER

    result = generate_invoice(order)
    print(f"\nInvoice:  {result['invoice_num']}")
    print(f"PDF:      {result['pdf'] or '(not generated)'}")
    print(f"HTML:     {result['html']}")
    print(f"Total:    ${result['data']['total']:.2f}")
