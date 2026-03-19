const db = require('../db/database');
const { createCheckoutSession } = require('./stripeService');
const { generateInvoicePdf } = require('./pdfService');
const { sendInvoiceEmail } = require('./emailService');

/**
 * Create an invoice from a Shopify order payload.
 * Extracts line items, customer info, and totals.
 */
function createInvoiceFromShopifyOrder(order) {
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

  return db.createInvoice({
    brand: 'palmetto-peptides',
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
function createManualInvoice(data) {
  return db.createInvoice({
    brand: data.brand || 'palmetto-peptides',
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
  let invoice = db.getInvoiceById(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  // 1. Create Stripe Checkout Session
  console.log(`[invoice] Creating Stripe session for ${invoice.invoice_number}...`);
  const session = await createCheckoutSession(invoice);
  console.log(`[invoice] Stripe session created: ${session.id}`);
  invoice = db.updateInvoice(invoice.id, {
    stripe_payment_link: session.url,
    stripe_session_id: session.id,
  });

  // 2. Generate PDF
  console.log(`[invoice] Generating PDF...`);
  const pdfBuffer = await generateInvoicePdf(invoice);
  console.log(`[invoice] PDF generated: ${pdfBuffer.length} bytes`);

  // 3. Send email
  console.log(`[invoice] Sending email to ${invoice.customer_email}...`);
  await sendInvoiceEmail(invoice, pdfBuffer);
  console.log(`[invoice] Email sent.`);

  console.log(`[invoice] Processed and sent ${invoice.invoice_number} to ${invoice.customer_email}`);
  return invoice;
}

/**
 * Resend an existing invoice email (regenerates PDF with current data).
 */
async function resendInvoice(invoiceId) {
  const invoice = db.getInvoiceById(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  // If no Stripe link exists yet, create one
  if (!invoice.stripe_payment_link) {
    const session = await createCheckoutSession(invoice);
    db.updateInvoice(invoice.id, {
      stripe_payment_link: session.url,
      stripe_session_id: session.id,
    });
    invoice.stripe_payment_link = session.url;
  }

  const pdfBuffer = await generateInvoicePdf(invoice);
  await sendInvoiceEmail(invoice, pdfBuffer);
  console.log(`[invoice] Resent ${invoice.invoice_number} to ${invoice.customer_email}`);
  return invoice;
}

module.exports = {
  createInvoiceFromShopifyOrder,
  createManualInvoice,
  processAndSendInvoice,
  resendInvoice,
};
