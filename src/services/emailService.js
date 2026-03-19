const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SENDGRID_API_KEY) {
    // SendGrid via SMTP relay
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  } else if (process.env.SMTP_HOST) {
    // Generic SMTP
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    throw new Error('No email transport configured. Set SENDGRID_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS.');
  }

  return transporter;
}

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
    '{{logo_url}}': 'cid:palmetto-logo',
  };

  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }

  return html;
}

/**
 * Send the invoice email with PDF attachment.
 */
async function sendInvoiceEmail(invoice, pdfBuffer) {
  const html = buildEmailHtml(invoice);
  const transport = getTransporter();

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'invoices@palmettopeptides.com',
    to: invoice.customer_email,
    subject: `Invoice ${invoice.invoice_number} — Palmetto Peptides`,
    html,
    attachments: [],
  };

  // Inline logo
  const logoPath = path.join(__dirname, '..', '..', 'assets', 'palmetto-peptides-logo.jpg');
  if (fs.existsSync(logoPath)) {
    mailOptions.attachments.push({
      filename: 'palmetto-logo.jpg',
      path: logoPath,
      cid: 'palmetto-logo',
      contentType: 'image/jpeg',
    });
  }

  if (pdfBuffer) {
    mailOptions.attachments.push({
      filename: `${invoice.invoice_number}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    });
  }

  const info = await transport.sendMail(mailOptions);
  console.log(`[email] Sent invoice ${invoice.invoice_number} to ${invoice.customer_email} — messageId: ${info.messageId}`);
  return info;
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
