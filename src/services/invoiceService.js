const db = require('../db/database');
const { createCheckoutSession } = require('./stripeService');
const { generateInvoicePdf } = require('./pdfService');
const { sendInvoiceEmail } = require('./emailService');

/**
 * Create an invoice from a Shopify order payload.
 * Extracts line items, customer info, and totals.
 */
async function createInvoiceFromShopifyOrder(order) {
  const lineItems = (order.line_items || []).map(li => ({
    name: li.title || li.name,
    quantity: li.quantity,
    price: parseFloat(li.price),
    sku: li.sku || '',
  }));

  const shippingAddr = order.shipping_address || order.billing_address || {};
  const customerName = [shippingAddr.first_name, shippingAddr.last_name].filter(Boolean).join(' ')
    || order.customer?.first_name + ' ' + order.customer?.last_name
    || 'Customer';

  const customerEmail = order.contact_email || order.email || order.customer?.email || '';

  return await db.createInvoice({
    brand: 'palmetto-ai-automation',
    shopify_order_id: String(order.id),
    shopify_order_number: order.name || `#${order.order_number}`,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_address: JSON.stringify(shippingAddr),
    line_items: lineItems,
    subtotal: parseFloat(order.subtotal_price || 0),
    shipping: parseFloat(order.total_shipping_price_set?.shop_money?.amount || 0),
    tax: parseFloat(order.total_tax || 0),
    total: parseFloat(order.total_price || 0),
  });
}

/**
 * Create an invoice manually (from admin dashboard).
 */
async function createManualInvoice(data) {
  return await db.createInvoice({
    brand: data.brand || 'palmetto-ai-automation',
    customer_name: data.customer_name,
    customer_email: data.customer_email,
    customer_address: data.customer_address ? JSON.stringify(data.customer_address) : null,
    line_items: data.line_items,
    subtotal: data.subtotal,
    shipping: data.shipping || 0,
    tax: data.tax || 0,
    total: data.total,
  });
}

/**
 * Full flow: create Stripe session, generate PDF, send email.
 */
async function processAndSendInvoice(invoiceId) {
  let invoice = await db.getInvoiceById(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  // 1. Create Stripe Checkout Session
  console.log(`[invoice] Creating Stripe session for ${invoice.invoice_number}...`);
  const session = await createCheckoutSession(invoice);
  console.log(`[invoice] Stripe session created: ${session.id}`);
  invoice = await db.updateInvoice(invoice.id, {
    stripe_payment_link: session.url,
    stripe_session_id: session.id,
  });

  // 2. Generate PDF
  console.log(`[invoice] Generating PDF...`);
  const pdfBuffer = await generateInvoicePdf(invoice);
  console.log(`[invoice] PDF generated: ${pdfBuffer.length} bytes`);

  // 3. Send email
  console.log(`[invoice] Sending email to ${invoice.customer_email}...`);
  try {
    await sendInvoiceEmail(invoice, pdfBuffer);
    await db.markEmailSent(invoice.id);
    console.log(`[invoice] Email sent.`);
  } catch (err) {
    await db.markEmailFailed(invoice.id, err && err.message);
    throw err;
  }

  console.log(`[invoice] Processed and sent ${invoice.invoice_number} to ${invoice.customer_email}`);
  return invoice;
}

/**
 * Resend an existing invoice email (regenerates PDF with current data).
 */
async function resendInvoice(invoiceId) {
  const invoice = await db.getInvoiceById(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  // If no Stripe link exists yet, create one
  if (!invoice.stripe_payment_link) {
    const session = await createCheckoutSession(invoice);
    await db.updateInvoice(invoice.id, {
      stripe_payment_link: session.url,
      stripe_session_id: session.id,
    });
    invoice.stripe_payment_link = session.url;
  }

  const pdfBuffer = await generateInvoicePdf(invoice);
  try {
    await sendInvoiceEmail(invoice, pdfBuffer);
    await db.markEmailSent(invoice.id);
  } catch (err) {
    await db.markEmailFailed(invoice.id, err && err.message);
    throw err;
  }
  console.log(`[invoice] Resent ${invoice.invoice_number} to ${invoice.customer_email}`);
  return invoice;
}

/**
 * Create a recurring monthly invoice for a client. Idempotent per billing_period.
 * Returns the existing invoice if one already exists for this period.
 */
async function createMonthlyInvoiceForClient(client, billingPeriod) {
  if (!client) throw new Error('client required');
  if (!billingPeriod) throw new Error('billingPeriod required (YYYY-MM)');

  const exists = await db.clientHasInvoiceForPeriod(client.id, billingPeriod);
  if (exists) {
    console.log(`[invoice] ${client.slug} already has invoice for ${billingPeriod} — skipping`);
    return null;
  }

  const periodLabel = (() => {
    const [y, m] = billingPeriod.split('-');
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
      .toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  })();

  const lineItems = [{
    name: `${client.service_title} — ${periodLabel}`,
    quantity: 1,
    price: Number(client.monthly_amount),
  }];

  const today = new Date();
  const due = new Date(today.getTime() + 3 * 86400000);

  const invoice = await db.createInvoice({
    brand: 'palmetto-ai-automation',
    customer_name: client.name,
    customer_email: client.email,
    line_items: lineItems,
    subtotal: Number(client.monthly_amount),
    total: Number(client.monthly_amount),
    client_id: client.id,
    invoice_type: 'monthly',
    due_date: due.toISOString().slice(0, 10),
    billing_period: billingPeriod,
  });

  await db.updateClient(client.id, {
    last_invoice_at: new Date().toISOString(),
    last_invoice_id: invoice.id,
  });

  return invoice;
}

/**
 * Create a "past due" replacement invoice for an unpaid monthly invoice.
 * Cancels the original and pauses client SEO.
 */
async function createPastDueReplacement(originalInvoice) {
  if (!originalInvoice.client_id) {
    throw new Error(`invoice ${originalInvoice.invoice_number} has no client_id — cannot create past-due replacement`);
  }
  const client = await db.getClientById(originalInvoice.client_id);
  if (!client) throw new Error(`client ${originalInvoice.client_id} not found`);

  // Cancel the original (it becomes inactive)
  await db.markCancelled(originalInvoice.id);

  const today = new Date();
  const due = new Date(today.getTime() + 3 * 86400000);

  // Re-use original line items so the customer sees what they're being billed for
  const lineItems = typeof originalInvoice.line_items === 'string'
    ? JSON.parse(originalInvoice.line_items)
    : originalInvoice.line_items;

  const replacement = await db.createInvoice({
    brand: 'palmetto-ai-automation',
    customer_name: originalInvoice.customer_name,
    customer_email: originalInvoice.customer_email,
    line_items: lineItems,
    subtotal: Number(originalInvoice.subtotal),
    total: Number(originalInvoice.total),
    client_id: client.id,
    parent_invoice_id: originalInvoice.id,
    invoice_type: 'past_due',
    due_date: due.toISOString().slice(0, 10),
    billing_period: originalInvoice.billing_period,
  });

  await db.pauseClientSeo(client.id, `unpaid invoice ${originalInvoice.invoice_number}`);

  return { replacement, client, original: originalInvoice };
}

module.exports = {
  createInvoiceFromShopifyOrder,
  createManualInvoice,
  processAndSendInvoice,
  resendInvoice,
  createMonthlyInvoiceForClient,
  createPastDueReplacement,
};
