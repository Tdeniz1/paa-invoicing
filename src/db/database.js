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

    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_shopify_order_id ON invoices(shopify_order_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_stripe_session_id ON invoices(stripe_session_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_email_sent_at ON invoices(email_sent_at);
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

async function nextInvoiceNumber(shopifyOrderNumber) {
  // If we have a Shopify order number (e.g. "#1027"), use PAA-1027
  if (shopifyOrderNumber) {
    const num = shopifyOrderNumber.replace(/^#/, '').trim();
    return `PAA-${num}`;
  }
  // Sequential PAA-YYYY-NNNN using a sequence table that never resets on delete
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
  return `PAA-${year}-${String(seq).padStart(4, '0')}`;
}

async function createInvoice(data) {
  await initSchema();
  const invoiceNumber = await nextInvoiceNumber(data.shopify_order_number);
  const lineItems = typeof data.line_items === 'string' ? data.line_items : JSON.stringify(data.line_items);

  const { rows } = await pool.query(
    `INSERT INTO invoices (
      invoice_number, brand, shopify_order_id, shopify_order_number,
      customer_name, customer_email, customer_address,
      line_items, subtotal, shipping, tax, total,
      stripe_payment_link, stripe_session_id, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
};
