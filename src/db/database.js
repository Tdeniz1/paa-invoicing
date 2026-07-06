const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

let initialized = false;

async function initSchema() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      brand TEXT NOT NULL DEFAULT 'palmetto-ai-automation',
      shopify_order_id TEXT,
      shopify_order_number TEXT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_address TEXT,
      line_items TEXT NOT NULL,
      subtotal REAL NOT NULL,
      shipping REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total REAL NOT NULL,
      stripe_payment_link TEXT,
      stripe_session_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP,
      email_sent_at TIMESTAMP,
      email_attempts INT DEFAULT 0,
      last_email_error TEXT
    );

    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_attempts INT DEFAULT 0;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_email_error TEXT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id INT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS parent_invoice_id INT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type TEXT DEFAULT 'one_time';
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period TEXT;

    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      monthly_amount REAL NOT NULL,
      service_title TEXT NOT NULL,
      service_description TEXT,
      active BOOLEAN DEFAULT TRUE,
      seo_paused BOOLEAN DEFAULT FALSE,
      seo_paused_reason TEXT,
      seo_paused_at TIMESTAMP,
      last_invoice_at TIMESTAMP,
      last_invoice_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_day INT;

    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_shopify_order_id ON invoices(shopify_order_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_stripe_session_id ON invoices(stripe_session_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_email_sent_at ON invoices(email_sent_at);
    CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_type ON invoices(invoice_type);
    CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);
    CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(active);
  `);
  initialized = true;
}

async function listUnsentInvoices({ olderThanMinutes = 3, maxAttempts = 5, limit = 50 } = {}) {
  await initSchema();
  const { rows } = await pool.query(
    `SELECT * FROM invoices
     WHERE status = 'pending'
       AND email_sent_at IS NULL
       AND COALESCE(email_attempts, 0) < $1
       AND created_at < NOW() - ($2 || ' minutes')::interval
     ORDER BY created_at ASC
     LIMIT $3`,
    [maxAttempts, String(olderThanMinutes), limit]
  );
  return rows;
}

async function markEmailSent(id) {
  await initSchema();
  const { rows } = await pool.query(
    `UPDATE invoices
     SET email_sent_at = NOW(),
         email_attempts = COALESCE(email_attempts, 0) + 1,
         last_email_error = NULL
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function markEmailFailed(id, errorMessage) {
  await initSchema();
  const { rows } = await pool.query(
    `UPDATE invoices
     SET email_attempts = COALESCE(email_attempts, 0) + 1,
         last_email_error = $2
     WHERE id = $1
     RETURNING *`,
    [id, String(errorMessage || '').slice(0, 1000)]
  );
  return rows[0] || null;
}

// --- Invoice Queries ---

async function nextInvoiceNumber(shopifyOrderNumber, opts = {}) {
  // If we have a Shopify order number (e.g. "#1027"), use PAA-1027
  if (shopifyOrderNumber) {
    const num = shopifyOrderNumber.replace(/^#/, '').trim();
    return `PAA-${num}`;
  }
  // Sequential prefixed-YYYY-NNNN using a sequence table that never resets on delete
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_sequence (
      id SERIAL PRIMARY KEY,
      year INT NOT NULL,
      last_seq INT NOT NULL DEFAULT 0,
      UNIQUE(year)
    )
  `);
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `INSERT INTO invoice_sequence (year, last_seq) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_seq = invoice_sequence.last_seq + 1
     RETURNING last_seq`,
    [year]
  );
  const seq = rows[0].last_seq;
  const prefix = opts.prefix || 'PAA';
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

async function createInvoice(data) {
  await initSchema();
  const numberPrefix = data.invoice_type === 'past_due' ? 'PAA-PD'
    : data.invoice_type === 'monthly' ? 'PAA'
    : null;
  const invoiceNumber = await nextInvoiceNumber(
    data.shopify_order_number,
    numberPrefix ? { prefix: numberPrefix } : {}
  );
  const lineItems = typeof data.line_items === 'string' ? data.line_items : JSON.stringify(data.line_items);

  const { rows } = await pool.query(
    `INSERT INTO invoices (
      invoice_number, brand, shopify_order_id, shopify_order_number,
      customer_name, customer_email, customer_address,
      line_items, subtotal, shipping, tax, total,
      stripe_payment_link, stripe_session_id, status,
      client_id, parent_invoice_id, invoice_type, due_date, billing_period
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
              $16, $17, $18, $19, $20)
    RETURNING *`,
    [
      invoiceNumber,
      data.brand || 'palmetto-ai-automation',
      data.shopify_order_id || null,
      data.shopify_order_number || null,
      data.customer_name,
      data.customer_email,
      data.customer_address || null,
      lineItems,
      data.subtotal,
      data.shipping || 0,
      data.tax || 0,
      data.total,
      data.stripe_payment_link || null,
      data.stripe_session_id || null,
      data.status || 'pending',
      data.client_id || null,
      data.parent_invoice_id || null,
      data.invoice_type || 'one_time',
      data.due_date || null,
      data.billing_period || null,
    ]
  );

  return rows[0];
}

async function getInvoiceById(id) {
  await initSchema();
  const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getInvoiceByNumber(invoiceNumber) {
  await initSchema();
  const { rows } = await pool.query('SELECT * FROM invoices WHERE invoice_number = $1', [invoiceNumber]);
  return rows[0] || null;
}

async function getInvoiceByShopifyOrderId(orderId) {
  await initSchema();
  const { rows } = await pool.query('SELECT * FROM invoices WHERE shopify_order_id = $1', [orderId]);
  return rows[0] || null;
}

async function getInvoiceByStripeSessionId(sessionId) {
  await initSchema();
  const { rows } = await pool.query('SELECT * FROM invoices WHERE stripe_session_id = $1', [sessionId]);
  return rows[0] || null;
}

async function listInvoices({ status, limit = 100, offset = 0 } = {}) {
  await initSchema();
  if (status) {
    const { rows } = await pool.query(
      'SELECT * FROM invoices WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [status, limit, offset]
    );
    return rows;
  }
  const { rows } = await pool.query(
    'SELECT * FROM invoices ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return rows;
}

async function updateInvoice(id, fields) {
  await initSchema();
  const allowed = [
    'stripe_payment_link', 'stripe_session_id', 'status', 'paid_at',
    'customer_name', 'customer_email', 'customer_address',
  ];
  const sets = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${paramIndex}`);
      values.push(val);
      paramIndex++;
    }
  }
  if (sets.length === 0) return null;

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function markPaid(id) {
  return updateInvoice(id, { status: 'paid', paid_at: new Date().toISOString() });
}

async function markCancelled(id) {
  return updateInvoice(id, { status: 'cancelled' });
}

async function deleteInvoice(id) {
  await initSchema();
  const { rows } = await pool.query('DELETE FROM invoices WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

async function getStats() {
  await initSchema();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const [totalPending, totalPaid, countThisMonth, countPending, countPaid] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total), 0) as v FROM invoices WHERE status = 'pending'"),
    pool.query("SELECT COALESCE(SUM(total), 0) as v FROM invoices WHERE status = 'paid'"),
    pool.query("SELECT COUNT(*) as v FROM invoices WHERE created_at >= $1", [monthStart]),
    pool.query("SELECT COUNT(*) as v FROM invoices WHERE status = 'pending'"),
    pool.query("SELECT COUNT(*) as v FROM invoices WHERE status = 'paid'"),
  ]);

  return {
    totalPending: parseFloat(totalPending.rows[0].v),
    totalPaid: parseFloat(totalPaid.rows[0].v),
    countThisMonth: parseInt(countThisMonth.rows[0].v, 10),
    countPending: parseInt(countPending.rows[0].v, 10),
    countPaid: parseInt(countPaid.rows[0].v, 10),
  };
}

// --- Client Queries ---

function slugify(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function createClient(data) {
  await initSchema();
  let slug = data.slug || slugify(data.name);
  if (!slug) throw new Error('client slug could not be derived from name');

  const { rows: existing } = await pool.query('SELECT id FROM clients WHERE slug = $1', [slug]);
  if (existing.length) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const { rows } = await pool.query(
    `INSERT INTO clients (slug, name, email, monthly_amount, service_title, service_description, active, billing_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      slug,
      data.name,
      data.email,
      Number(data.monthly_amount),
      data.service_title,
      data.service_description || null,
      data.active !== false,
      data.billing_day != null ? Number(data.billing_day) : null,
    ]
  );
  return rows[0];
}

async function getClientById(id) {
  await initSchema();
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getClientBySlug(slug) {
  await initSchema();
  const { rows } = await pool.query('SELECT * FROM clients WHERE slug = $1', [slug]);
  return rows[0] || null;
}

async function listClients({ active } = {}) {
  await initSchema();
  if (active === true) {
    const { rows } = await pool.query('SELECT * FROM clients WHERE active = TRUE ORDER BY name ASC');
    return rows;
  }
  if (active === false) {
    const { rows } = await pool.query('SELECT * FROM clients WHERE active = FALSE ORDER BY name ASC');
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM clients ORDER BY name ASC');
  return rows;
}

async function updateClient(id, fields) {
  await initSchema();
  const allowed = [
    'name', 'email', 'monthly_amount', 'service_title', 'service_description',
    'active', 'billing_day', 'seo_paused', 'seo_paused_reason', 'seo_paused_at',
    'last_invoice_at', 'last_invoice_id',
  ];
  const sets = [];
  const values = [];
  let p = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = $${p}`);
      values.push(v);
      p++;
    }
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function pauseClientSeo(id, reason) {
  return updateClient(id, {
    seo_paused: true,
    seo_paused_reason: reason || 'past_due',
    seo_paused_at: new Date().toISOString(),
  });
}

async function unpauseClientSeo(id) {
  return updateClient(id, {
    seo_paused: false,
    seo_paused_reason: null,
    seo_paused_at: null,
  });
}

async function deleteClient(id) {
  await initSchema();
  const { rows } = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [id]);
  return rows[0] || null;
}

// --- Recurring invoice queries ---

/**
 * Most recent monthly/past_due invoice for a client (regardless of status).
 */
async function getLatestRecurringInvoiceForClient(clientId) {
  await initSchema();
  const { rows } = await pool.query(
    `SELECT * FROM invoices
     WHERE client_id = $1 AND invoice_type IN ('monthly', 'past_due')
     ORDER BY created_at DESC LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

/**
 * Pending PAA recurring invoices (monthly or past_due) older than N days.
 * Used by the past-due sweeper.
 */
async function listOverdueRecurringInvoices(thresholdDays = 3) {
  await initSchema();
  const { rows } = await pool.query(
    `SELECT * FROM invoices
     WHERE status = 'pending'
       AND invoice_type IN ('monthly', 'past_due')
       AND created_at < NOW() - ($1 || ' days')::interval
     ORDER BY created_at ASC`,
    [String(thresholdDays)]
  );
  return rows;
}

/**
 * Has this client received any monthly invoice during the given billing_period?
 */
async function clientHasInvoiceForPeriod(clientId, billingPeriod) {
  await initSchema();
  const { rows } = await pool.query(
    `SELECT id FROM invoices
     WHERE client_id = $1 AND billing_period = $2 AND invoice_type = 'monthly'
     LIMIT 1`,
    [clientId, billingPeriod]
  );
  return rows.length > 0;
}

module.exports = {
  initSchema,
  pool,
  createInvoice,
  getInvoiceById,
  getInvoiceByNumber,
  getInvoiceByShopifyOrderId,
  getInvoiceByStripeSessionId,
  listInvoices,
  listUnsentInvoices,
  updateInvoice,
  markPaid,
  markCancelled,
  markEmailSent,
  markEmailFailed,
  deleteInvoice,
  getStats,
  // clients
  slugify,
  createClient,
  getClientById,
  getClientBySlug,
  listClients,
  updateClient,
  pauseClientSeo,
  unpauseClientSeo,
  deleteClient,
  // recurring
  getLatestRecurringInvoiceForClient,
  listOverdueRecurringInvoices,
  clientHasInvoiceForPeriod,
};
