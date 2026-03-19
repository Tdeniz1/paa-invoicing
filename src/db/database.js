const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'invoicing.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      brand TEXT NOT NULL DEFAULT 'palmetto-peptides',
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_shopify_order_id ON invoices(shopify_order_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_stripe_session_id ON invoices(stripe_session_id);
  `);
}

// --- Invoice Queries ---

function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `PP-${year}-`;
  const row = db.prepare(`
    SELECT invoice_number FROM invoices
    WHERE invoice_number LIKE ?
    ORDER BY invoice_number DESC LIMIT 1
  `).get(`${prefix}%`);

  if (!row) return `${prefix}0001`;
  const seq = parseInt(row.invoice_number.split('-').pop(), 10) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function createInvoice(data) {
  const d = getDb();
  const invoiceNumber = nextInvoiceNumber();
  const stmt = d.prepare(`
    INSERT INTO invoices (
      invoice_number, brand, shopify_order_id, shopify_order_number,
      customer_name, customer_email, customer_address,
      line_items, subtotal, shipping, tax, total,
      stripe_payment_link, stripe_session_id, status
    ) VALUES (
      @invoice_number, @brand, @shopify_order_id, @shopify_order_number,
      @customer_name, @customer_email, @customer_address,
      @line_items, @subtotal, @shipping, @tax, @total,
      @stripe_payment_link, @stripe_session_id, @status
    )
  `);

  const info = stmt.run({
    invoice_number: invoiceNumber,
    brand: data.brand || 'palmetto-peptides',
    shopify_order_id: data.shopify_order_id || null,
    shopify_order_number: data.shopify_order_number || null,
    customer_name: data.customer_name,
    customer_email: data.customer_email,
    customer_address: data.customer_address || null,
    line_items: typeof data.line_items === 'string' ? data.line_items : JSON.stringify(data.line_items),
    subtotal: data.subtotal,
    shipping: data.shipping || 0,
    tax: data.tax || 0,
    total: data.total,
    stripe_payment_link: data.stripe_payment_link || null,
    stripe_session_id: data.stripe_session_id || null,
    status: data.status || 'pending',
  });

  return getInvoiceById(info.lastInsertRowid);
}

function getInvoiceById(id) {
  return getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

function getInvoiceByNumber(invoiceNumber) {
  return getDb().prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
}

function getInvoiceByShopifyOrderId(orderId) {
  return getDb().prepare('SELECT * FROM invoices WHERE shopify_order_id = ?').get(orderId);
}

function getInvoiceByStripeSessionId(sessionId) {
  return getDb().prepare('SELECT * FROM invoices WHERE stripe_session_id = ?').get(sessionId);
}

function listInvoices({ status, limit = 100, offset = 0 } = {}) {
  if (status) {
    return getDb().prepare(
      'SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(status, limit, offset);
  }
  return getDb().prepare(
    'SELECT * FROM invoices ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

function updateInvoice(id, fields) {
  const allowed = [
    'stripe_payment_link', 'stripe_session_id', 'status', 'paid_at',
    'customer_name', 'customer_email', 'customer_address',
  ];
  const sets = [];
  const values = {};
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = @${key}`);
      values[key] = val;
    }
  }
  if (sets.length === 0) return null;
  values.id = id;
  getDb().prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = @id`).run(values);
  return getInvoiceById(id);
}

function markPaid(id) {
  return updateInvoice(id, { status: 'paid', paid_at: new Date().toISOString() });
}

function markCancelled(id) {
  return updateInvoice(id, { status: 'cancelled' });
}

function getStats() {
  const d = getDb();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return {
    totalPending: d.prepare("SELECT COALESCE(SUM(total), 0) as v FROM invoices WHERE status = 'pending'").get().v,
    totalPaid: d.prepare("SELECT COALESCE(SUM(total), 0) as v FROM invoices WHERE status = 'paid'").get().v,
    countThisMonth: d.prepare("SELECT COUNT(*) as v FROM invoices WHERE created_at >= ?").get(monthStart).v,
    countPending: d.prepare("SELECT COUNT(*) as v FROM invoices WHERE status = 'pending'").get().v,
    countPaid: d.prepare("SELECT COUNT(*) as v FROM invoices WHERE status = 'paid'").get().v,
  };
}

module.exports = {
  getDb,
  createInvoice,
  getInvoiceById,
  getInvoiceByNumber,
  getInvoiceByShopifyOrderId,
  getInvoiceByStripeSessionId,
  listInvoices,
  updateInvoice,
  markPaid,
  markCancelled,
  getStats,
};
