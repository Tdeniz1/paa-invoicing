const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');

function pickTemplate(invoice) {
  if (invoice.invoice_type === 'past_due') return 'email-paa-pastdue.html';
  if (invoice.invoice_type === 'monthly') return 'email-paa.html';
  // Shopify / one-off legacy invoices
  return 'email-peptides.html';
}

function formatPeriodLabel(billingPeriod) {
  if (!billingPeriod) return '';
  const [y, m] = billingPeriod.split('-');
  if (!y || !m) return billingPeriod;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

/**
 * Build the HTML email body from the right template for this invoice's type.
 */
function buildEmailHtml(invoice) {
  const templateName = pickTemplate(invoice);
  const templatePath = path.join(__dirname, '..', 'templates', templateName);
  let html = fs.readFileSync(templatePath, 'utf8');

  const lineItems = typeof invoice.line_items === 'string'
    ? JSON.parse(invoice.line_items)
    : invoice.line_items;

  const isRecurring = invoice.invoice_type === 'monthly' || invoice.invoice_type === 'past_due';

  // PAA recurring templates use a 2-column row (description / amount).
  // Peptides uses 4 columns (item / qty / price / total).
  const itemRows = isRecurring
    ? lineItems.map(li =>
        `<tr>
          <td style="padding:8px 0;color:#c9d1d9;font-size:13px;border-bottom:1px solid #21262d;">${escapeHtml(li.name)}</td>
          <td style="padding:8px 0;color:#c9d1d9;font-size:13px;text-align:right;border-bottom:1px solid #21262d;">$${(li.quantity * li.price).toFixed(2)}</td>
        </tr>`
      ).join('\n')
    : lineItems.map(li =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${escapeHtml(li.name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:center;">${li.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:right;">$${Number(li.price).toFixed(2)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:right;">$${(li.quantity * li.price).toFixed(2)}</td>
        </tr>`
      ).join('\n');

  const logoPath = path.join(__dirname, '..', '..', 'assets', 'palmetto-ai-automation-logo.jpg');
  let logoBase64 = '';
  if (fs.existsSync(logoPath)) {
    logoBase64 = `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString('base64')}`;
  }

  const createdDate = new Date(invoice.created_at);
  const dueDate = invoice.due_date
    ? new Date(invoice.due_date)
    : new Date(createdDate.getTime() + (isRecurring ? 3 : 7) * 86400000);

  const fmt = d => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Service title for PAA templates — derived from line items or invoice metadata
  const serviceTitle = lineItems[0]?.name || 'Monthly SEO Services';

  const replacements = {
    '{{invoice_number}}': invoice.invoice_number,
    '{{customer_name}}': escapeHtml(invoice.customer_name),
    '{{total}}': Number(invoice.total).toFixed(2),
    '{{subtotal}}': Number(invoice.subtotal).toFixed(2),
    '{{shipping}}': Number(invoice.shipping || 0).toFixed(2),
    '{{tax}}': Number(invoice.tax || 0).toFixed(2),
    '{{line_items_rows}}': itemRows,
    '{{payment_link}}': invoice.stripe_payment_link || '#',
    '{{date}}': fmt(createdDate),
    '{{due_date}}': fmt(dueDate),
    '{{service_title}}': escapeHtml(serviceTitle),
    '{{billing_period_label}}': formatPeriodLabel(invoice.billing_period),
    '{{logo_url}}': logoBase64 || 'https://palmettoaiautomation.com/cdn/shop/files/logo.png',
  };

  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }

  return html;
}

/**
 * Send the invoice email via SendGrid HTTP API.
 */
async function sendInvoiceEmail(invoice, pdfBuffer) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error('SENDGRID_API_KEY not set');

  sgMail.setApiKey(apiKey);

  const html = buildEmailHtml(invoice);

  const fromName = process.env.EMAIL_FROM_NAME || 'Palmetto AI Automation';
  const fromEmail = process.env.EMAIL_FROM || 'support@palmettoaiautomation.com';

  const subjectLine = invoice.invoice_type === 'past_due'
    ? `PAST DUE — Invoice ${invoice.invoice_number} — Palmetto AI Automation`
    : invoice.invoice_type === 'monthly'
      ? `Monthly Invoice ${invoice.invoice_number} — Palmetto AI Automation`
      : `Invoice ${invoice.invoice_number} — Palmetto AI Automation`;

  const msg = {
    to: invoice.customer_email,
    from: { email: fromEmail, name: fromName },
    subject: subjectLine,
    html,
    attachments: [],
  };

  if (pdfBuffer) {
    msg.attachments.push({
      filename: `${invoice.invoice_number}.pdf`,
      content: pdfBuffer.toString('base64'),
      type: 'application/pdf',
      disposition: 'attachment',
    });
  }

  const [response] = await sgMail.send(msg);
  console.log(`[email] Sent invoice ${invoice.invoice_number} to ${invoice.customer_email} — status: ${response.statusCode}`);
  return response;
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
  sendInvoiceEmail,
};
