const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'OutdoorCraftCo2026';

// Base URL used to build Stripe success/cancel links. Render sets
// RENDER_EXTERNAL_URL automatically; for local dev, set PUBLIC_BASE_URL
// yourself (e.g. http://localhost:3000) in your .env file.
const BASE_URL = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable (your Neon connection string).');
}
if (!stripe) {
  console.warn('STRIPE_SECRET_KEY not set — payment links are disabled until it is configured.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
});

// ---------- Simple admin auth ----------
// Not high-security (a shared password over a header), but keeps casual
// visitors out of the admin API. Good enough for a small local business site.
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------- Stripe webhook ----------
// IMPORTANT: this route needs the *raw* request body to verify Stripe's
// signature, so it's registered before the global express.json() below.
// This is optional — see README. Without it configured, payments are still
// confirmed via the success-page redirect further down.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body); // no signing secret configured — trust it (dev only)
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const kind = session.metadata && session.metadata.kind;
      if (kind === 'order') {
        await pool.query(
          `UPDATE orders SET payment_status = 'Paid', paid_at = now() WHERE stripe_session_id = $1`,
          [session.id]
        );
      } else {
        await pool.query(
          `UPDATE leads SET payment_status = 'Paid', paid_at = now() WHERE stripe_session_id = $1`,
          [session.id]
        );
      }
    } catch (err) {
      console.error('Failed to mark paid from webhook', err);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

// ---------- Site content (hero, services, contact, areas) ----------
app.get('/api/content', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data FROM site_content WHERE id = 1');
    res.json(rows[0]?.data || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load content' });
  }
});

app.post('/api/content', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO site_content (id, data) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET data = $1`,
      [JSON.stringify(req.body || {})]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save content' });
  }
});

// ---------- Gallery ----------
app.get('/api/gallery', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT items FROM gallery WHERE id = 1');
    res.json(rows[0]?.items || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load gallery' });
  }
});

app.post('/api/gallery', requireAdmin, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    await pool.query(
      `INSERT INTO gallery (id, items) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET items = $1`,
      [JSON.stringify(items)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save gallery' });
  }
});

// ---------- Leads / quote requests / jobs ----------
// Public: visitors can create a lead by submitting the quote form.
app.post('/api/leads', async (req, res) => {
  try {
    const { name = '', phone = '', email = '', service = '', message = '', notes = '', source = 'Website form' } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO leads (name, phone, email, service, message, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, phone, email, service, message, notes, source]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// Admin only: view all leads/jobs.
app.get('/api/leads', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY submitted_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

// Admin only: update a lead's status/notes/deposit amount.
app.put('/api/leads/:id', requireAdmin, async (req, res) => {
  try {
    const { status, notes, deposit_amount } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE leads SET
         status         = COALESCE($1, status),
         notes          = COALESCE($2, notes),
         deposit_amount = COALESCE($3, deposit_amount)
       WHERE id = $4 RETURNING *`,
      [status, notes, deposit_amount, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// Admin only: delete a lead.
app.delete('/api/leads/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ---------- Deposit payments (Stripe Checkout) ----------
// Admin only: generate a payment link for a lead's deposit. The admin then
// copies this link and sends it to the customer themselves (email/SMS) —
// this app doesn't send emails on its own.
app.post('/api/leads/:id/create-payment', requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet (missing STRIPE_SECRET_KEY).' });
  try {
    const { amount } = req.body || {};
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents < 50) return res.status(400).json({ error: 'Enter a valid deposit amount (minimum $0.50).' });

    const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    const lead = rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'aud',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: cents,
          product_data: {
            name: `Outdoor Craft Co. — deposit${lead.service ? ' (' + lead.service + ')' : ''}`,
            description: `Job for ${lead.name || 'customer'}`,
          },
        },
        quantity: 1,
      }],
      metadata: { kind: 'lead_deposit', leadId: String(lead.id) },
      success_url: `${BASE_URL}/payment-success?kind=lead&id=${lead.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/#admin`,
    });

    await pool.query(
      `UPDATE leads SET deposit_amount = $1, payment_status = 'Unpaid', stripe_session_id = $2 WHERE id = $3`,
      [Number(amount), session.id, lead.id]
    );

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

// Public: the page a customer lands on after paying via Stripe Checkout
// (used for both job deposits and shop orders). Confirms the session
// server-side (never trust the redirect alone). Works even without
// webhooks configured.
app.get('/payment-success', async (req, res) => {
  const { session_id, kind, id } = req.query;
  let paid = false;
  try {
    if (stripe && session_id) {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        if (kind === 'order') {
          await pool.query(
            `UPDATE orders SET payment_status = 'Paid', paid_at = now() WHERE id = $1 AND stripe_session_id = $2`,
            [id, session_id]
          );
        } else {
          await pool.query(
            `UPDATE leads SET payment_status = 'Paid', paid_at = now() WHERE id = $1 AND stripe_session_id = $2`,
            [id, session_id]
          );
        }
        paid = true;
      }
    }
  } catch (err) {
    console.error('Payment confirmation failed', err);
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payment ${paid ? 'received' : 'status'}</title>
  <style>body{font-family:sans-serif;background:#EDE6D6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
  .card{background:#fff;padding:40px;border-radius:8px;max-width:420px;text-align:center;}
  h1{font-size:1.4rem;color:#1B1815;}p{color:#4A433C;}a{color:#8C4A2F;}</style></head>
  <body><div class="card"><h1>${paid ? '✓ Payment received — thank you!' : 'Payment status unavailable'}</h1>
  <p>${paid ? "We've recorded your payment. We'll be in touch shortly." : 'If you completed payment, please contact us and we will confirm it manually.'}</p>
  <p><a href="/">← Back to site</a></p>
  </div></body></html>`);
});

// ---------- Stock / materials tracker (internal, admin-only) ----------
app.get('/api/stock', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM stock_items ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stock' });
  }
});

app.post('/api/stock', requireAdmin, async (req, res) => {
  try {
    const { name = '', unit = '', quantity = 0, reorder_level = 0, notes = '' } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO stock_items (name, unit, quantity, reorder_level, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, unit, quantity, reorder_level, notes]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add stock item' });
  }
});

app.put('/api/stock/:id', requireAdmin, async (req, res) => {
  try {
    const { name, unit, quantity, reorder_level, notes } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE stock_items SET
         name          = COALESCE($1, name),
         unit          = COALESCE($2, unit),
         quantity      = COALESCE($3, quantity),
         reorder_level = COALESCE($4, reorder_level),
         notes         = COALESCE($5, notes),
         updated_at    = now()
       WHERE id = $6 RETURNING *`,
      [name, unit, quantity, reorder_level, notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update stock item' });
  }
});

app.delete('/api/stock/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM stock_items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete stock item' });
  }
});

// ---------- Shop: products ----------
// Public shoppers only ever see active products. Sending the correct admin
// header additionally includes inactive/hidden ones, for the admin catalog view.
app.get('/api/products', async (req, res) => {
  try {
    const isAdmin = req.headers['x-admin-password'] === ADMIN_PASSWORD;
    const { rows } = await pool.query(
      isAdmin
        ? 'SELECT * FROM products ORDER BY created_at DESC'
        : "SELECT * FROM products WHERE active = true ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const { name = '', description = '', price = 0, image_url = '', category = '', active = true } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO products (name, description, price, image_url, category, active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, description, price, image_url, category, active]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, price, image_url, category, active } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE products SET
         name        = COALESCE($1, name),
         description = COALESCE($2, description),
         price       = COALESCE($3, price),
         image_url   = COALESCE($4, image_url),
         category    = COALESCE($5, category),
         active      = COALESCE($6, active)
       WHERE id = $7 RETURNING *`,
      [name, description, price, image_url, category, active, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ---------- Shop: orders ----------
app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.put('/api/orders/:id', requireAdmin, async (req, res) => {
  try {
    const { order_status, notes } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE orders SET
         order_status = COALESCE($1, order_status),
         notes        = COALESCE($2, notes)
       WHERE id = $3 RETURNING *`,
      [order_status, notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// Public: cart checkout. NEVER trust prices from the browser — look up each
// product's real price server-side before building the Stripe session.
app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Online payment is not configured yet.' });
  try {
    const { items = [], customer = {} } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Cart is empty.' });

    const ids = items.map(i => Number(i.id)).filter(Boolean);
    const { rows: products } = await pool.query('SELECT * FROM products WHERE id = ANY($1) AND active = true', [ids]);
    if (!products.length) return res.status(400).json({ error: 'No valid products in cart.' });

    const lineItems = [];
    const orderItems = [];
    let total = 0;
    for (const cartItem of items) {
      const product = products.find(p => p.id === Number(cartItem.id));
      if (!product) continue;
      const qty = Math.max(1, Math.min(50, parseInt(cartItem.qty, 10) || 1));
      const unitCents = Math.round(Number(product.price) * 100);
      total += (unitCents * qty) / 100;
      lineItems.push({
        price_data: {
          currency: 'aud',
          unit_amount: unitCents,
          product_data: { name: product.name, description: product.category || undefined },
        },
        quantity: qty,
      });
      orderItems.push({ product_id: product.id, name: product.name, price: Number(product.price), qty });
    }
    if (!lineItems.length) return res.status(400).json({ error: 'No valid products in cart.' });

    const { rows: orderRows } = await pool.query(
      `INSERT INTO orders (customer_name, phone, email, fulfillment, address, items, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        customer.name || '', customer.phone || '', customer.email || '',
        customer.fulfillment || 'Pickup', customer.address || '',
        JSON.stringify(orderItems), total,
      ]
    );
    const order = orderRows[0];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'aud',
      payment_method_types: ['card'],
      line_items: lineItems,
      customer_email: customer.email || undefined,
      metadata: { kind: 'order', orderId: String(order.id) },
      success_url: `${BASE_URL}/payment-success?kind=order&id=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/#shop`,
    });

    await pool.query('UPDATE orders SET stripe_session_id = $1 WHERE id = $2', [session.id, order.id]);
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Checkout failed — please try again.' });
  }
});

// ---------- Health check (also what UptimeRobot pings) ----------
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Fallback to index.html for any other route (single-page app)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Outdoor Craft Co. server running on port ${PORT}`);
});
