const express = require('express');
const router = express.Router();
const { verifyWebhook } = require('../services/shopifyService');
const { createInvoiceFromShopifyOrder, processAndSendInvoice } = require('../services/invoiceService');
const db = require('../db/database');

/**
 * Shopify orders/create webhook handler.
 * Only processes orders where payment_gateway_names includes "pay-by-invoice"
 * (the custom manual payment method).
 */
router.post('/shopify/orders', express.raw({ type: 'application/json' }), async (req, res) => {
  // Verify HMAC signature
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (hmac && process.env.SHOPIFY_WEBHOOK_SECRET) {
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
    if (!verifyWebhook(rawBody, hmac)) {
      console.error('[webhook] Invalid Shopify HMAC signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const order = typeof req.body === 'string' ? JSON.parse(req.body) : JSON.parse(req.body.toString('utf8'));

    console.log(`[webhook] Received Shopify order ${order.name || order.id} — gateways: ${(order.payment_gateway_names || []).join(', ')}`);

    // Only process "pay by invoice" orders
    const gateways = (order.payment_gateway_names || []).map(g => g.toLowerCase().replace(/[\s_-]+/g, ''));
    const isPayByInvoice = gateways.some(g =>
      g.includes('paybyinvoice') || g.includes('manual') || g.includes('invoice')
    );

    if (!isPayByInvoice) {
      console.log(`[webhook] Skipping order ${order.name} — not a pay-by-invoice order`);
      return res.status(200).json({ status: 'skipped', reason: 'not pay-by-invoice' });
    }

    // Check for duplicate
    const existing = await db.getInvoiceByShopifyOrderId(String(order.id));
    if (existing) {
      console.log(`[webhook] Invoice already exists for order ${order.id}: ${existing.invoice_number}`);
      return res.status(200).json({ status: 'duplicate', invoice_number: existing.invoice_number });
    }

    // Create invoice record
    const invoice = await createInvoiceFromShopifyOrder(order);
    console.log(`[webhook] Created invoice ${invoice.invoice_number} for order ${order.name}`);

    // Process and send (Stripe session + PDF + email) — async, don't block the webhook response
    processAndSendInvoice(invoice.id).catch(err => {
      console.error(`[webhook] Failed to process/send invoice ${invoice.invoice_number}:`, err);
    });

    res.status(200).json({ status: 'accepted', invoice_number: invoice.invoice_number });
  } catch (err) {
    console.error('[webhook] Shopify order processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
