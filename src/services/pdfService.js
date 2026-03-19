const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Generate a branded PDF invoice from an invoice record.
 * Returns a Buffer containing the PDF.
 */
async function generateInvoicePdf(invoice) {
  const templatePath = path.join(__dirname, '..', 'templates', 'invoice-peptides.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  const lineItems = typeof invoice.line_items === 'string'
    ? JSON.parse(invoice.line_items)
    : invoice.line_items;

  // Build line item rows
  const itemRows = lineItems.map(li =>
    `<tr>
      <td>${escapeHtml(li.name)}</td>
      <td class="center">${li.quantity}</td>
      <td class="right">$${Number(li.price).toFixed(2)}</td>
      <td class="right">$${(li.quantity * li.price).toFixed(2)}</td>
    </tr>`
  ).join('\n');

  // Invoice dates
  const createdDate = new Date(invoice.created_at);
  const dueDate = new Date(createdDate);
  dueDate.setDate(dueDate.getDate() + 7); // NET 7

  // Logo as base64 data URI so it works in Puppeteer
  const logoPath = path.join(__dirname, '..', '..', 'assets', 'palmetto-peptides-logo.jpg');
  let logoDataUri = '';
  if (fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    logoDataUri = `data:image/jpeg;base64,${logoBuffer.toString('base64')}`;
  }

  // Parse customer address
  let addressHtml = '';
  if (invoice.customer_address) {
    const addr = typeof invoice.customer_address === 'string'
      ? JSON.parse(invoice.customer_address)
      : invoice.customer_address;
    const parts = [
      addr.address1,
      addr.address2,
      [addr.city, addr.province, addr.zip].filter(Boolean).join(', '),
      addr.country,
    ].filter(Boolean);
    addressHtml = parts.map(p => escapeHtml(p)).join('<br>');
  }

  const replacements = {
    '{{logo_src}}': logoDataUri,
    '{{invoice_number}}': invoice.invoice_number,
    '{{date}}': formatDate(createdDate),
    '{{due_date}}': formatDate(dueDate),
    '{{customer_name}}': escapeHtml(invoice.customer_name),
    '{{customer_email}}': escapeHtml(invoice.customer_email),
    '{{customer_address}}': addressHtml,
    '{{line_items_rows}}': itemRows,
    '{{subtotal}}': Number(invoice.subtotal).toFixed(2),
    '{{shipping}}': Number(invoice.shipping || 0).toFixed(2),
    '{{tax}}': Number(invoice.tax || 0).toFixed(2),
    '{{total}}': Number(invoice.total).toFixed(2),
    '{{payment_link}}': invoice.stripe_payment_link || '#',
    '{{shopify_order_number}}': invoice.shopify_order_number || '',
    '{{status}}': invoice.status || 'pending',
  };

  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }

  // Launch Puppeteer and render PDF
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  generateInvoicePdf,
};
