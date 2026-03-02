# BizBoost — Deployment Guide (Vercel + Supabase)

## Overview

This guide migrates BizBoost from PHP + MySQL (InfinityFree) to **Vercel** (Node.js serverless functions) + **Supabase** (Postgres database).

---

## Step 1 — Set Up Supabase Tables

1. Open [Supabase Dashboard](https://app.supabase.com) → your project
2. Go to **SQL Editor** → **New query**
3. Paste the contents of `supabase/schema.sql` and click **Run**
4. Verify all tables are created: `sellers`, `buyers`, `seller_details`, `seller_usage`, `leads`, `connections`, `seo_reports`, `competitor_data`, `external_listings`, `competitor_intel`

---

## Step 2 — Push Repo to GitHub

```bash
git add .
git commit -m "Migrate to Vercel + Supabase"
git push origin main
```

---

## Step 3 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Framework Preset: **Other** (static site)
4. Root Directory: `/` (leave as default)
5. Click **Deploy**

---

## Step 4 — Add Environment Variables in Vercel

In your Vercel project → **Settings** → **Environment Variables**, add:

| Variable              | Value                                              | Notes                                      |
|-----------------------|----------------------------------------------------|--------------------------------------------|
| `SUPABASE_URL`        | `https://vixjywcsmdcypltmll.supabase.co`           | Your Supabase project URL                  |
| `SUPABASE_SERVICE_KEY`| (get from Supabase → Settings → API → service_role key) | **Service role key** — NOT anon key   |
| `SERPER_KEY`          | Your Serper API key                                | For Google Search/Maps via Serper          |
| `GROQ_KEY`            | Your Groq API key                                  | For AI analysis (Llama 3.3 70B)            |
| `DISCORD_WEBHOOK`     | Your Discord webhook URL                           | For notifications (optional)               |
| `ADMIN_PASSWORD`      | A secure admin password                            | Used for `admin-api.js`                    |

> ⚠️ **Never** commit these values to Git. Always add them via the Vercel dashboard.

---

## Step 5 — Redeploy

After adding environment variables, trigger a redeploy:
- Vercel Dashboard → **Deployments** → **Redeploy** (latest deployment)
- Or push a new commit to trigger auto-deploy

---

## Step 6 — Verify

1. Visit `https://your-project.vercel.app/api/test` — should return:
   ```json
   {"node":"v18.x.x","status":"working","supabase":"configured",...}
   ```
2. Test registration at `https://your-project.vercel.app/seller/onboard.html`
3. Test the API directly: `POST /api/seller_register` with JSON body

---

## Architecture Notes

### API Routes
All API files in `api/` are served as Vercel Serverless Functions:
- `api/seller_register.js` → `POST /api/seller_register`
- `api/seller_login.js`    → `POST /api/seller_login`
- etc.

### Database
- Uses Supabase JS client (`@supabase/supabase-js`) with the **service_role** key
- This bypasses Row Level Security (RLS) for server-side operations
- All queries use the Supabase query builder (no raw SQL in API code)

### Auth
- Custom bcrypt-based auth (email + password)
- **No sessions** — seller_id/buyer_id are passed in request body (same as original frontend)
- PHP's `password_hash()` produces bcrypt hashes compatible with `bcryptjs.compare()` — existing user passwords will still work

### Old PHP Files
The original PHP files are kept intact. On Vercel, only `.js` files in `api/` are used as serverless functions. You can keep InfinityFree as a fallback while testing Vercel.

---

## Supabase Service Role Key Location

Dashboard → Project Settings → API → **service_role** (secret) key

> ⚠️ This key bypasses RLS. Keep it secret and only use server-side.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `SUPABASE_SERVICE_KEY` not set | Add env var in Vercel dashboard, redeploy |
| `bcryptjs` not found | Run `npm install` locally first, check `package.json` |
| GST lookup not working | On Vercel, outbound `fetch()` is unrestricted — should work. Check GSTIN format. |
| AI analysis fails | Check `GROQ_KEY` is set correctly. Groq free tier has rate limits. |
| Discord not notifying | Check `DISCORD_WEBHOOK` URL format: `https://discord.com/api/webhooks/...` |
