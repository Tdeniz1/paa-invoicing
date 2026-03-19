const Stripe = require('stripe');

let stripe;

function getStripe() {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Create a Stripe Checkout Session for a given invoice.
 * Returns the session object (use session.url for the payment link).
 */
async function createCheckoutSession(invoice) {
  const lineItems = JSON.parse(
    typeof invoice.line_items === 'string' ? invoice.line_items : JSON.stringify(invoice.line_items)
  );

  const session = await getStripe().checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    customer_email: invoice.customer_email,
    metadata: {
      invoice_id: String(invoice.id),
      invoice_number: invoice.invoice_number,
      shopify_order_id: invoice.shopify_order_id || '',
    },
    line_items: [
      // Single line item for the invoice total
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Invoice ${invoice.invoice_number}`,
            description: lineItems.map(li => `${li.name} x${li.quantity}`).join(', '),
          },
          unit_amount: Math.round(invoice.total * 100), // cents
        },
        quantity: 1,
      },
    ],
    success_url: `${process.env.APP_URL}/payment/success?invoice=${invoice.invoice_number}`,
    cancel_url: `${process.env.APP_URL}/payment/cancelled?invoice=${invoice.invoice_number}`,
  });

  return session;
}

/**
 * Verify a Stripe webhook signature and parse the event.
 */
function constructWebhookEvent(rawBody, signature) {
  return getStripe().webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = {
  createCheckoutSession,
  constructWebhookEvent,
};
