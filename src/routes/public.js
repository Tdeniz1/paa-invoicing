const express = require('express');
const router = express.Router();
const db = require('../db/database');

/**
 * Public endpoint for client SEO crons to self-pause when their account
 * has an unpaid past-due invoice. Returns a minimal stable shape:
 *
 *   { slug, active, seo_paused, reason }
 *
 * Designed to be called from blog-cron / audit-cron / refresh-cron jobs
 * before they run. If seo_paused === true, the cron should exit 0.
 */
router.get('/seo-status/:slug', async (req, res) => {
  try {
    const client = await db.getClientBySlug(req.params.slug);
    if (!client) {
      return res.status(404).json({ error: 'client not found', slug: req.params.slug });
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      slug: client.slug,
      active: !!client.active,
      seo_paused: !!client.seo_paused,
      reason: client.seo_paused_reason || null,
      paused_at: client.seo_paused_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
