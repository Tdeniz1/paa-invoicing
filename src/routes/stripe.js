const express = require('express');
const router = express.Router();
const { constructWebhookEvent } = require('../services/stripeService');
const { markOrderPaid } = require('../services/shopifyService');
const db = require('../db/database');

/**
 * Stripe webhook handler.
 * Listens for checkout.session.completed to mark invoices paid.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = typeof req.body === 'string' ? req.body : req.body;
    event = constructWebhookEvent(rawBody, sig);
  } catch (err) {
    console.error('[stripe] Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`[stripe] Checkout session completed: ${session.id}`);

    try {
      // Find the invoice by Stripe session ID
      const invoice = await db.getInvoiceByStripeSessionId(session.id);
      if (!invoice) {
        console.error(`[stripe] No invoice found for session ${session.id}`);
        return res.status(200).json({ received: true, warning: 'no matching invoice' });
      }

      // Mark invoice as paid
      await db.markPaid(invoice.id);
      console.log(`[stripe] Marked invoice ${invoice.invoice_number} as paid`);

      // Mark the Shopify order as paid
      if (invoice.shopify_order_id) {
        try {
          await markOrderPaid(invoice.shopify_order_id, invoice.total);
          console.log(`[stripe] Marked Shopify order ${invoice.shopify_order_id} as paid`);
        } catch (shopifyErr) {
          console.error(`[stripe] Failed to mark Shopify order as paid:`, shopifyErr);
          // Don't fail the webhook — invoice is already marked paid locally
        }
      }
    } catch (err) {
      console.error('[stripe] Error processing payment:', err);
    }
  }

  res.status(200).json({ received: true });
});

module.exports = router;
