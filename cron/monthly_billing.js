#!/usr/bin/env node
/**
 * Monthly billing cron.
 *
 * Schedule: every Monday morning (Railway cron schedule on the service).
 * Behavior: only generates + sends invoices on the FIRST Monday of each month.
 *           Other Mondays it exits cleanly with a no-op log line.
 *
 * Idempotent: createMonthlyInvoiceForClient checks for an existing invoice
 * with the same billing_period (YYYY-MM), so re-runs on the same day skip.
 */

const db = require('../src/db/database');
const { createMonthlyInvoiceForClient, processAndSendInvoice } = require('../src/services/invoiceService');

function isFirstMondayOfMonth(d) {
  // Monday = 1. First Monday means the date is between 1 and 7.
  return d.getDay() === 1 && d.getDate() >= 1 && d.getDate() <= 7;
}

function currentBillingPeriod(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const startedAt = new Date();
  const force = process.env.FORCE_MONTHLY_BILLING === '1';
  console.log(`[monthly-billing] Starting at ${startedAt.toISOString()} (force=${force})`);

  if (!force && !isFirstMondayOfMonth(startedAt)) {
    console.log(`[monthly-billing] Today is not the first Monday of the month — exiting no-op.`);
    return;
  }

  await db.initSchema();

  const clients = await db.listClients({ active: true });
  console.log(`[monthly-billing] ${clients.length} active client(s).`);

  const period = currentBillingPeriod(startedAt);
  let created = 0, sent = 0, skipped = 0, failed = 0;

  for (const client of clients) {
    try {
      const invoice = await createMonthlyInvoiceForClient(client, period);
      if (!invoice) {
        skipped++;
        continue;
      }
      created++;
      console.log(`[monthly-billing] Created ${invoice.invoice_number} for ${client.slug} ($${invoice.total})`);
      await processAndSendInvoice(invoice.id);
      sent++;
      console.log(`[monthly-billing] Sent ${invoice.invoice_number} → ${client.email}`);
    } catch (err) {
      failed++;
      console.error(`[monthly-billing] FAILED for ${client.slug}: ${err && err.message}`);
    }
  }

  const ms = Date.now() - startedAt.getTime();
  console.log(`[monthly-billing] Done in ${ms}ms. period=${period} created=${created} sent=${sent} skipped=${skipped} failed=${failed}`);
}

main()
  .then(() => db.pool.end().catch(() => {}))
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[monthly-billing] FATAL:', err);
    db.pool.end().catch(() => {});
    process.exit(1);
  });
