#!/usr/bin/env node
/**
 * Periodic sweep: find invoices that were created but never emailed
 * (status=pending, email_sent_at IS NULL, older than grace window,
 * under max-attempts) and resend them. Meant to run every 10 minutes
 * as a Railway cron service.
 */

const db = require('../src/db/database');
const { resendInvoice } = require('../src/services/invoiceService');

const OLDER_THAN_MINUTES = parseInt(process.env.UNSENT_GRACE_MINUTES || '3', 10);
const MAX_ATTEMPTS = parseInt(process.env.UNSENT_MAX_ATTEMPTS || '5', 10);
const BATCH_LIMIT = parseInt(process.env.UNSENT_BATCH_LIMIT || '25', 10);

async function main() {
  const startedAt = new Date();
  console.log(`[unsent-sweep] Starting at ${startedAt.toISOString()}`);
  console.log(`[unsent-sweep] Grace: ${OLDER_THAN_MINUTES}m  maxAttempts: ${MAX_ATTEMPTS}  limit: ${BATCH_LIMIT}`);

  await db.initSchema();

  const candidates = await db.listUnsentInvoices({
    olderThanMinutes: OLDER_THAN_MINUTES,
    maxAttempts: MAX_ATTEMPTS,
    limit: BATCH_LIMIT,
  });

  console.log(`[unsent-sweep] Found ${candidates.length} unsent invoice(s).`);

  let ok = 0;
  let fail = 0;
  for (const inv of candidates) {
    console.log(`[unsent-sweep] Resending ${inv.invoice_number} (id=${inv.id}, attempts=${inv.email_attempts || 0}) → ${inv.customer_email}`);
    try {
      await resendInvoice(inv.id);
      ok++;
    } catch (err) {
      fail++;
      console.error(`[unsent-sweep] FAILED ${inv.invoice_number}: ${err && err.message}`);
    }
  }

  const ms = Date.now() - startedAt.getTime();
  console.log(`[unsent-sweep] Done in ${ms}ms. sent=${ok} failed=${fail}`);
}

main()
  .then(() => db.pool.end().catch(() => {}))
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[unsent-sweep] FATAL:', err);
    db.pool.end().catch(() => {});
    process.exit(1);
  });
