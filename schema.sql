-- Run this once against your Neon database (Neon SQL Editor, or `psql "$DATABASE_URL" -f schema.sql`)

CREATE TABLE IF NOT EXISTS site_content (
  id    INT PRIMARY KEY DEFAULT 1,
  data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS gallery (
  id     INT PRIMARY KEY DEFAULT 1,
  items  JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT single_row_gallery CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS leads (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  service           TEXT NOT NULL DEFAULT '',
  message           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'New',
  notes             TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL DEFAULT 'Website form',
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deposit_amount    NUMERIC NOT NULL DEFAULT 0,
  payment_status    TEXT NOT NULL DEFAULT 'Unpaid',
  stripe_session_id TEXT,
  paid_at           TIMESTAMPTZ
);

-- If you already created the `leads` table before this update, run these too
-- (safe to run even if the table is brand new — IF NOT EXISTS makes them no-ops):
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Unpaid';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Migrate old status values to the new job-pipeline names, if you used the
-- earlier version of this app (New/Contacted/Quoted/Won/Lost):
UPDATE leads SET status = 'Complete' WHERE status = 'Won';

CREATE TABLE IF NOT EXISTS stock_items (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  unit           TEXT NOT NULL DEFAULT '',
  quantity       NUMERIC NOT NULL DEFAULT 0,
  reorder_level  NUMERIC NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price        NUMERIC NOT NULL DEFAULT 0,
  image_url    TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                 SERIAL PRIMARY KEY,
  customer_name      TEXT NOT NULL DEFAULT '',
  phone              TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  fulfillment        TEXT NOT NULL DEFAULT 'Pickup',
  address            TEXT NOT NULL DEFAULT '',
  items              JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount       NUMERIC NOT NULL DEFAULT 0,
  payment_status     TEXT NOT NULL DEFAULT 'Unpaid',
  order_status       TEXT NOT NULL DEFAULT 'Pending',
  stripe_session_id  TEXT,
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at            TIMESTAMPTZ
);

-- seed the two singleton rows so the app can always UPSERT them
INSERT INTO site_content (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO gallery (id, items) VALUES (1, '[]'::jsonb) ON CONFLICT (id) DO NOTHING;
