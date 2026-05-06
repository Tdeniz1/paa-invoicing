const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { createMonthlyInvoiceForClient, processAndSendInvoice } = require('../services/invoiceService');

// List all clients
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    const filter = {};
    if (active === 'true') filter.active = true;
    else if (active === 'false') filter.active = false;
    const clients = await db.listClients(filter);
    res.json({ clients });
  } catch (err) {
    console.error('[clients] List error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get one client
router.get('/:id', async (req, res) => {
  try {
    const client = await db.getClientById(parseInt(req.params.id));
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create client
router.post('/', async (req, res) => {
  try {
    const { name, email, monthly_amount, service_title, service_description, active } = req.body || {};
    if (!name || !email || monthly_amount == null || !service_title) {
      return res.status(400).json({ error: 'name, email, monthly_amount, service_title are required' });
    }
    const client = await db.createClient({
      name, email, monthly_amount, service_title, service_description, active,
    });
    res.status(201).json({ client });
  } catch (err) {
    console.error('[clients] Create error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Update client
router.put('/:id', async (req, res) => {
  try {
    const client = await db.updateClient(parseInt(req.params.id), req.body || {});
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause SEO for a client
router.post('/:id/pause-seo', async (req, res) => {
  try {
    const reason = (req.body && req.body.reason) || 'manual';
    const client = await db.pauseClientSeo(parseInt(req.params.id), reason);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unpause SEO for a client
router.post('/:id/unpause-seo', async (req, res) => {
  try {
    const client = await db.unpauseClientSeo(parseInt(req.params.id));
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger this client's monthly invoice (any period; default = current month)
router.post('/:id/invoice-now', async (req, res) => {
  try {
    const client = await db.getClientById(parseInt(req.params.id));
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.active) return res.status(400).json({ error: 'Client is inactive' });

    const billingPeriod = (req.body && req.body.billing_period) || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    const invoice = await createMonthlyInvoiceForClient(client, billingPeriod);
    if (!invoice) {
      return res.status(409).json({ error: `client already has an invoice for ${billingPeriod}` });
    }
    const sent = await processAndSendInvoice(invoice.id);
    res.status(201).json({ invoice: sent });
  } catch (err) {
    console.error('[clients] invoice-now error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete client
router.delete('/:id', async (req, res) => {
  try {
    const result = await db.deleteClient(parseInt(req.params.id));
    if (!result) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
