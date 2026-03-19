const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { createManualInvoice, processAndSendInvoice, resendInvoice } = require('../services/invoiceService');

// Stats for dashboard (must come before /:id to avoid matching "stats" as an id)
router.get('/stats/summary', (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ stats });
  } catch (err) {
    console.error('[invoices] Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List invoices (JSON API for admin dashboard)
router.get('/', (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const invoices = db.listInvoices({
      status: status || undefined,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });
    res.json({ invoices });
  } catch (err) {
    console.error('[invoices] List error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single invoice
router.get('/:id', (req, res) => {
  try {
    const invoice = db.getInvoiceById(parseInt(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice });
  } catch (err) {
    console.error('[invoices] Get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create invoice manually
router.post('/', async (req, res) => {
  try {
    const invoice = createManualInvoice(req.body);
    res.status(201).json({ invoice });
  } catch (err) {
    console.error('[invoices] Create error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Send invoice (generate PDF + email + Stripe link)
router.post('/:id/send', async (req, res) => {
  try {
    const invoice = await processAndSendInvoice(parseInt(req.params.id));
    res.json({ invoice, message: 'Invoice sent successfully' });
  } catch (err) {
    console.error('[invoices] Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Resend invoice email
router.post('/:id/resend', async (req, res) => {
  try {
    const invoice = await resendInvoice(parseInt(req.params.id));
    res.json({ invoice, message: 'Invoice resent successfully' });
  } catch (err) {
    console.error('[invoices] Resend error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mark invoice as paid manually
router.post('/:id/mark-paid', (req, res) => {
  try {
    const invoice = db.markPaid(parseInt(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice, message: 'Invoice marked as paid' });
  } catch (err) {
    console.error('[invoices] Mark paid error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cancel invoice
router.post('/:id/cancel', (req, res) => {
  try {
    const invoice = db.markCancelled(parseInt(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice, message: 'Invoice cancelled' });
  } catch (err) {
    console.error('[invoices] Cancel error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
