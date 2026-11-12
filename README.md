# Elevate Home Improvements — website + admin portal

A Node/Express server that serves the site and stores content, gallery photos,
and leads in a real Postgres database (Neon), so it can be deployed as a
proper always-on website instead of relying on Claude's artifact storage.

## What's in here

```
elevate-home-improvements-app/
├── server.js        Express server + API (content, gallery, leads)
├── package.json
├── schema.sql        Run this once against your Neon database
├── .env.example       Copy to .env for local dev (never commit .env)
└── public/
    └── index.html     The site + admin portal (same file as before, now
                         talking to /api/* instead of window.storage)
```

## 1. Push it to GitHub

1. Create a new empty repository on GitHub (e.g. `elevate-home-improvements-site`).
2. In this folder:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/elevate-home-improvements-site.git
   git push -u origin main
   ```
   (`.env` is already excluded via `.gitignore` — don't remove that.)

## 2. Create the database on Neon

1. Go to https://neon.tech, sign up/log in, and create a new project (any
   region close to you, e.g. Sydney/Singapore).
2. Once created, open the **SQL Editor** for your project, paste in the
   contents of `schema.sql`, and run it. This creates the three tables.
3. Go to your project's **Connection Details** and copy the **connection
   string** (it looks like
   `postgresql://user:password@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`).
   Keep this handy for the next step.

## 3. Deploy to Render

1. Go to https://render.com and sign in (you can sign in with GitHub).
2. **New +** → **Web Service** → connect your GitHub account → select the
   `elevate-home-improvements-site` repo.
3. Configure it:
   - **Name**: `elevate-home-improvements` (or anything)
   - **Region**: closest to you
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (or paid, if you want no cold-start delay at all)
4. Under **Environment Variables**, add:
   - `DATABASE_URL` = the Neon connection string from step 2
   - `ADMIN_PASSWORD` = a password of your choice (replaces the default
     `OutdoorCraftCo2026`)
5. Click **Create Web Service**. Render will build and deploy — after a
   couple of minutes you'll get a live URL like
   `https://elevate-home-improvements.onrender.com`.
6. Visit it. Visit `/#admin` and log in with your `ADMIN_PASSWORD` to check
   the dashboard loads.

Any time you push new commits to `main` on GitHub, Render automatically
rebuilds and redeploys.

## 4. Stop it from sleeping, using UptimeRobot

Render's **free** tier spins the service down after ~15 minutes of no
traffic, so the next visitor waits ~30–50 seconds for it to wake up. To
avoid that:

1. Go to https://uptimerobot.com and create a free account.
2. **+ Add New Monitor**:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: Elevate Home Improvements
   - **URL**: `https://elevate-home-improvements.onrender.com/healthz`
     (the server has a `/healthz` route built in for exactly this)
   - **Monitoring Interval**: 5 minutes
3. Save. UptimeRobot will now ping your site every 5 minutes, which keeps
   Render's free instance awake around the clock.

Note: this is a well-known workaround, not an official Render feature — it
works because Render only sleeps services with no incoming requests. If you
later upgrade to a paid Render instance, this isn't needed (paid instances
don't sleep).

## 5. Set up Stripe (for real card payments in Australia)

Stripe supports Australian businesses directly — AUD, Visa/Mastercard/Amex,
Apple Pay/Google Pay all work out of the box.

1. Go to https://dashboard.stripe.com/register and create an account
   (business details, ABN if you have one, and bank account for payouts —
   you can finish some of this later, test mode works immediately).
2. In the Stripe Dashboard, make sure you're in **Test mode** first (toggle
   top-right) and go to **Developers → API keys**. Copy the **Secret key**
   (starts with `sk_test_...`).
3. On Render, go to your service → **Environment** and add:
   - `STRIPE_SECRET_KEY` = the secret key you just copied
4. Redeploy (Render does this automatically when you save env vars). Now, in
   the admin **Jobs & quotes** tab, each unpaid lead has a "Generate payment
   link" button — enter a deposit amount, click it, and you'll get a real
   Stripe Checkout link to copy and send to the customer (email, SMS,
   whatever you use). When they pay, the lead automatically flips to
   "Deposit paid".
5. **Going live**: once you've tested a payment or two, flip Stripe's
   dashboard to **Live mode**, grab the `sk_live_...` key, complete Stripe's
   business verification if prompted, and swap `STRIPE_SECRET_KEY` on Render
   to the live key.

### Optional: Stripe webhook (more reliable payment confirmation)

By default, a lead is marked "Paid" when the customer's browser redirects
back to your site after paying. That covers the vast majority of cases, but
if their browser closes before the redirect completes, it can be missed.
A webhook fixes this by having Stripe notify your server directly:

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://your-app.onrender.com/api/stripe/webhook`
3. Event to send: `checkout.session.completed`
4. Copy the **Signing secret** (starts with `whsec_...`) and add it on
   Render as `STRIPE_WEBHOOK_SECRET`.

Without this set up, everything still works via the redirect method above —
this is a "nice to have," not a requirement.

## About the new job pipeline, deposits, and stock tracker

- **Jobs & quotes tab**: statuses now follow a real job pipeline — New →
  Contacted → Quoted → Booked → In Progress → Complete (or Lost). Each lead
  also shows its deposit amount and payment status, with the "Generate
  payment link" button described above.
- **Stock tab**: a simple internal materials tracker — add items with a
  quantity on hand and a reorder level; anything at or below its reorder
  level is flagged "Low stock". This is admin-only and never shown on the
  public site.

## Local development (optional)

```
npm install
cp .env.example .env     # then fill in your real DATABASE_URL (and Stripe key if testing payments)
npm start
```
Visit `http://localhost:3000`.

## Notes on the admin password

`ADMIN_PASSWORD` gates the write endpoints (saving content/gallery, viewing
and editing leads/stock) via a simple header check — enough to keep casual
visitors out, but not real authentication (no hashing, no sessions, no rate
limiting). Fine for a small local business site; if this ever needs to
protect genuinely sensitive data, it should be upgraded to proper auth.
