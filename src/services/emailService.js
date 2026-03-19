const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');

/**
 * Build the HTML email body from the template.
 */
function buildEmailHtml(invoice) {
  const templatePath = path.join(__dirname, '..', 'templates', 'email-peptides.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  const lineItems = typeof invoice.line_items === 'string'
    ? JSON.parse(invoice.line_items)
    : invoice.line_items;

  const itemRows = lineItems.map(li =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;">${escapeHtml(li.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:center;">${li.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:right;">$${Number(li.price).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #2a2a2a;text-align:right;">$${(li.quantity * li.price).toFixed(2)}</td>
    </tr>`
  ).join('\n');

  const logoPath = path.join(__dirname, '..', '..', 'assets', 'palmetto-peptides-logo.jpg');
  let logoBase64 = '';
  if (fs.existsSync(logoPath)) {
    logoBase64 = `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString('base64')}`;
  }

  const replacements = {
    '{{invoice_number}}': invoice.invoice_number,
    '{{customer_name}}': escapeHtml(invoice.customer_name),
    '{{total}}': Number(invoice.total).toFixed(2),
    '{{subtotal}}': Number(invoice.subtotal).toFixed(2),
    '{{shipping}}': Number(invoice.shipping || 0).toFixed(2),
    '{{tax}}': Number(invoice.tax || 0).toFixed(2),
    '{{line_items_rows}}': itemRows,
    '{{payment_link}}': invoice.stripe_payment_link || '#',
    '{{date}}': new Date(invoice.created_at).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    '{{logo_url}}': logoBase64 || 'https://palmettopeptides.com/cdn/shop/files/logo.png',
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

  const fromName = process.env.EMAIL_FROM_NAME || 'Palmetto Peptides';
  const fromEmail = process.env.EMAIL_FROM || 'support@palmettopeptides.com';

  const msg = {
    to: invoice.customer_email,
    from: { email: fromEmail, name: fromName },
    subject: `Invoice ${invoice.invoice_number} — Palmetto Peptides`,
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
