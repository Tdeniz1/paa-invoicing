const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Color palette — dark professional theme
const COLORS = {
  bgDark: '#1B1F3B',
  bgMedium: '#242849',
  bgLight: '#2E3358',
  accent: '#4ADE80',
  accentDark: '#22C55E',
  textWhite: '#FFFFFF',
  textLight: '#CBD5E1',
  textMuted: '#94A3B8',
  tableBorder: '#3B4070',
  payButton: '#22C55E',
};

/**
 * Generate a branded dark-themed PDF invoice using pdfkit.
 * Returns a Buffer containing the PDF.
 */
async function generateInvoicePdf(invoice) {
  const lineItems = typeof invoice.line_items === 'string'
    ? JSON.parse(invoice.line_items)
    : invoice.line_items;

  // Invoice dates
  const createdDate = new Date(invoice.created_at);
  const dueDate = new Date(createdDate);
  dueDate.setDate(dueDate.getDate() + 7); // NET 7

  // Parse customer address
  let addressLines = [];
  if (invoice.customer_address) {
    try {
      const addr = typeof invoice.customer_address === 'string'
        ? JSON.parse(invoice.customer_address)
        : invoice.customer_address;
      if (typeof addr === 'object') {
        addressLines = [
          addr.address1,
          addr.address2,
          [addr.city, addr.province, addr.zip].filter(Boolean).join(', '),
          addr.country,
        ].filter(Boolean);
      } else {
        addressLines = [String(addr)];
      }
    } catch (e) {
      // Plain string address
      addressLines = [String(invoice.customer_address)];
    }
  }

  const paymentUrl = invoice.stripe_payment_link || '#';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 612; // Letter width in points
    const H = 792; // Letter height in points
    const M = 40;  // Margin

    // ── Full-page dark background ──
    doc.rect(0, 0, W, H).fill(COLORS.bgDark);

    // ── Header band ──
    doc.rect(0, 0, W, 120).fill(COLORS.bgMedium);

    // Logo
    const logoPath = path.join(__dirname, '..', '..', 'assets', 'palmetto-peptides-logo.jpg');
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      doc.image(logoBuffer, M, 20, { height: 80 });
    }

    // Invoice title — right side of header
    doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.textWhite);
    doc.text('INVOICE', M, 35, { width: W - M * 2, align: 'right' });

    doc.font('Helvetica').fontSize(10).fillColor(COLORS.accent);
    doc.text(invoice.invoice_number, M, 68, { width: W - M * 2, align: 'right' });

    // ── Invoice meta row ──
    const metaY = 140;
    doc.rect(M, metaY, W - M * 2, 60).fill(COLORS.bgLight);

    const metaCol1 = M + 15;
    const metaCol2 = M + 190;
    const metaCol3 = M + 370;

    doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted);
    doc.text('INVOICE DATE', metaCol1, metaY + 12);
    doc.text('DUE DATE (NET 7)', metaCol2, metaY + 12);
    doc.text('STATUS', metaCol3, metaY + 12);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.textWhite);
    doc.text(formatDate(createdDate), metaCol1, metaY + 28);
    doc.text(formatDate(dueDate), metaCol2, metaY + 28);

    const statusText = (invoice.status || 'pending').toUpperCase();
    const statusColor = statusText === 'PAID' ? COLORS.accent : '#FBBF24';
    doc.font('Helvetica-Bold').fontSize(11).fillColor(statusColor);
    doc.text(statusText, metaCol3, metaY + 28);

    // ── Bill To section ──
    const billY = 225;
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.accent);
    doc.text('BILL TO', M, billY);

    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.textWhite);
    doc.text(invoice.customer_name || '', M, billY + 16);

    doc.font('Helvetica').fontSize(10).fillColor(COLORS.textLight);
    let addrY = billY + 34;
    if (invoice.customer_email) {
      doc.text(invoice.customer_email, M, addrY);
      addrY += 14;
    }
    for (const line of addressLines) {
      doc.text(line, M, addrY);
      addrY += 14;
    }

    // ── Line items table ──
    const tableTop = 320;
    const colX = {
      name: M,
      qty: 350,
      price: 420,
      subtotal: 500,
    };
    const tableW = W - M * 2;

    // Table header
    doc.rect(M, tableTop, tableW, 28).fill(COLORS.bgLight);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.textMuted);
    doc.text('PRODUCT', colX.name + 12, tableTop + 9);
    doc.text('QTY', colX.qty, tableTop + 9, { width: 50, align: 'center' });
    doc.text('UNIT PRICE', colX.price, tableTop + 9, { width: 70, align: 'right' });
    doc.text('SUBTOTAL', colX.subtotal, tableTop + 9, { width: 72, align: 'right' });

    // Table rows
    let rowY = tableTop + 28;
    lineItems.forEach((li, i) => {
      const rowH = 32;
      if (i % 2 === 0) {
        doc.rect(M, rowY, tableW, rowH).fill(COLORS.bgMedium);
      } else {
        doc.rect(M, rowY, tableW, rowH).fill(COLORS.bgDark);
      }

      doc.font('Helvetica').fontSize(10).fillColor(COLORS.textWhite);
      doc.text(li.name || '', colX.name + 12, rowY + 10, { width: 290 });

      doc.fillColor(COLORS.textLight);
      doc.text(String(li.quantity), colX.qty, rowY + 10, { width: 50, align: 'center' });
      doc.text(`$${Number(li.price).toFixed(2)}`, colX.price, rowY + 10, { width: 70, align: 'right' });

      doc.font('Helvetica-Bold').fillColor(COLORS.textWhite);
      doc.text(`$${(li.quantity * li.price).toFixed(2)}`, colX.subtotal, rowY + 10, { width: 72, align: 'right' });

      rowY += rowH;
    });

    // Separator line
    doc.moveTo(M, rowY).lineTo(W - M, rowY).strokeColor(COLORS.tableBorder).lineWidth(1).stroke();

    // ── Totals section ──
    const totalsX = 400;
    const totalsW = W - M - totalsX;
    let totY = rowY + 18;

    const drawTotalLine = (label, value, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 13 : 10)
        .fillColor(bold ? COLORS.textWhite : COLORS.textLight);
      doc.text(label, totalsX, totY);
      doc.text(value, totalsX, totY, { width: totalsW, align: 'right' });
      totY += bold ? 28 : 22;
    };

    drawTotalLine('Subtotal', `$${Number(invoice.subtotal).toFixed(2)}`, false);
    drawTotalLine('Shipping', `$${Number(invoice.shipping || 0).toFixed(2)}`, false);
    drawTotalLine('Tax', `$${Number(invoice.tax || 0).toFixed(2)}`, false);

    // Total highlight bar
    doc.rect(totalsX - 10, totY - 4, totalsW + 20, 32).fill(COLORS.bgLight);
    drawTotalLine('TOTAL', `$${Number(invoice.total).toFixed(2)}`, true);

    // ── Pay Now button ──
    const btnW = 180;
    const btnH = 40;
    const btnX = (W - btnW) / 2;
    const btnY = totY + 20;

    doc.roundedRect(btnX, btnY, btnW, btnH, 6).fill(COLORS.payButton);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.bgDark);
    doc.text('PAY NOW', btnX, btnY + 12, { width: btnW, align: 'center' });

    // Payment link text below button
    if (paymentUrl && paymentUrl !== '#') {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.textMuted);
      doc.text(paymentUrl, M, btnY + btnH + 8, { width: W - M * 2, align: 'center', link: paymentUrl });
    }

    // ── Footer ──
    const footerY = H - 50;
    doc.rect(0, footerY - 10, W, 60).fill(COLORS.bgMedium);

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.textMuted);
    doc.text(
      'Palmetto Peptides  |  palmettopeptides.com  |  support@palmettopeptides.com',
      M,
      footerY + 5,
      { width: W - M * 2, align: 'center' }
    );

    doc.end();
  });
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

module.exports = {
  generateInvoicePdf,
};
