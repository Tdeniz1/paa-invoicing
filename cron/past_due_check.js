#!/usr/bin/env node
/**
 * Past-due sweeper.
 *
 * Schedule: daily (Railway cron).
 *
 * For every PAA recurring invoice (monthly or past_due) that has been
 * pending for >3 days:
 *   1. Cancel the original invoice.
 *   2. Generate a "past_due" replacement invoice with a red banner.
 *   3. Pause the client's SEO (sets clients.seo_paused = TRUE).
 *   4. Send the past-due email + PDF + Stripe link.
 *   5. Optionally ping a webhook (PAST_DUE_WEBHOOK_URL) for external
 *      notification (e.g. PushNotification relay or Slack).
 *
 * If a past_due invoice is itself >3 days old and still unpaid, it does
 * not generate another past_due invoice — it just keeps the client paused
 * and re-pings the webhook so the operator knows it's still outstanding.
 */

const db = require('../src/db/database');
const { createPastDueReplacement, processAndSendInvoice } = require('../src/services/invoiceService');

const THRESHOLD_DAYS = parseInt(process.env.PAST_DUE_DAYS || '3', 10);
const WEBHOOK_URL = process.env.PAST_DUE_WEBHOOK_URL || '';

async function notifyWebhook(payload) {
  if (!WEBHOOK_URL) return;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`[past-due] webhook → ${res.status}`);
  } catch (err) {
    console.warn(`[past-due] webhook failed: ${err && err.message}`);
  }
}

async function main() {
  const startedAt = new Date();
  console.log(`[past-due] Starting at ${startedAt.toISOString()} (threshold=${THRESHOLD_DAYS} days)`);

  await db.initSchema();

  const overdue = await db.listOverdueRecurringInvoices(THRESHOLD_DAYS);
  console.log(`[past-due] Found ${overdue.length} overdue recurring invoice(s).`);

  let replaced = 0, repinged = 0, failed = 0;

  for (const inv of overdue) {
    try {
      if (inv.invoice_type === 'past_due') {
        // Already a past-due invoice that's STILL not paid. Don't replace it again,
        // but ensure the client stays paused and ping the webhook for follow-up.
        if (inv.client_id) {
          const client = await db.getClientById(inv.client_id);
          if (client && !client.seo_paused) {
            await db.pauseClientSeo(client.id, `unpaid past-due ${inv.invoice_number}`);
          }
          await notifyWebhook({
            event: 'past_due_still_unpaid',
            invoice_number: inv.invoice_number,
            client_slug: client && client.slug,
            client_name: client && client.name,
            client_email: client && client.email,
            total: inv.total,
            created_at: inv.created_at,
          });
          repinged++;
          console.log(`[past-due] Re-pinged ${inv.invoice_number} (still unpaid)`);
        }
        continue;
      }

      // monthly invoice >threshold days old, still pending → create past-due replacement
      const { replacement, client, original } = await createPastDueReplacement(inv);
      console.log(`[past-due] ${original.invoice_number} → cancelled. ${replacement.invoice_number} created for ${client.slug}.`);

      await processAndSendInvoice(replacement.id);
      console.log(`[past-due] Sent ${replacement.invoice_number} → ${client.email}. SEO paused for ${client.slug}.`);

      await notifyWebhook({
        event: 'past_due_created',
        original_invoice: original.invoice_number,
        past_due_invoice: replacement.invoice_number,
        client_slug: client.slug,
        client_name: client.name,
        client_email: client.email,
        total: replacement.total,
      });

      replaced++;
    } catch (err) {
      failed++;
      console.error(`[past-due] FAILED for ${inv.invoice_number}: ${err && err.message}`);
    }
  }

  const ms = Date.now() - startedAt.getTime();
  console.log(`[past-due] Done in ${ms}ms. replaced=${replaced} repinged=${repinged} failed=${failed}`);
}

main()
  .then(() => db.pool.end().catch(() => {}))
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[past-due] FATAL:', err);
    db.pool.end().catch(() => {});
    process.exit(1);
  });
