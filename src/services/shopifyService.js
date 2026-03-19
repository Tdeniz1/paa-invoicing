const crypto = require('crypto');
const https = require('https');

const SHOPIFY_API_VERSION = '2024-01';

function shopifyRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const store = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ACCESS_TOKEN;

    const options = {
      hostname: store,
      port: 443,
      path: `/admin/api/${SHOPIFY_API_VERSION}${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          reject(new Error(`Shopify ${method} ${path} returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Verify HMAC signature on incoming Shopify webhook.
 */
function verifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

/**
 * Mark an order as paid by creating a capture transaction.
 */
async function markOrderPaid(orderId, amount) {
  return shopifyRequest('POST', `/orders/${orderId}/transactions.json`, {
    transaction: {
      kind: 'capture',
      status: 'success',
      amount: String(amount),
    },
  });
}

/**
 * Get a single order by ID.
 */
async function getOrder(orderId) {
  const result = await shopifyRequest('GET', `/orders/${orderId}.json`);
  return result.order;
}

module.exports = {
  verifyWebhook,
  markOrderPaid,
  getOrder,
};
