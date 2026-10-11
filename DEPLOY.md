# Going live — ResumeForge Pro

This is the complete launch checklist: hosting, domain, payments, email, AI and Google (SEO).
Budget roughly **₹1,500–2,500 / month** to start: Render Starter about $7 plus a disk, a domain about ₹800–1,000 a year, and Claude API usage based on how many people use AI.

---

## Step 1 — Put the code on GitHub (private)

The code has to be in a GitHub repository so the host can deploy it. Keep the repository **private**.
`.gitignore` already keeps out `.env` (your secret keys) and `data/` (your users' database).

Easiest way on Windows:
1. Install **GitHub Desktop** from https://desktop.github.com and sign in.
2. *File → Add local repository →* choose this folder → *create a repository* → **Publish repository**, with **Keep this code private** ticked.

## Step 2 — Deploy on Render (HTTPS included)

1. Go to https://render.com → **Sign in with GitHub**.
2. **New → Blueprint** → choose your repository. Render reads `render.yaml`.
3. Fill in the values it asks for:

| Variable | What to put |
|---|---|
| `APP_URL` | For now `https://resumeforge-pro.onrender.com` (the URL Render shows). Later your own domain. |
| `ADMIN_EMAILS` | The email you will sign up with. This unlocks `/admin`. |
| `SUPPORT_EMAIL` | Your support email address |
| `BUSINESS_NAME` | Your name or registered business name, shown in Terms, Privacy and the footer |
| `ANTHROPIC_API_KEY` | From https://console.anthropic.com. Also set a monthly spend limit there. |
| `RAZORPAY_*` | Leave empty for now (Step 4) |
| `SMTP_*` | Gmail app password (Step 5) |

4. Click **Apply**. The first build takes 3–5 minutes. Open the URL, sign up with your `ADMIN_EMAILS` address, and check that `/admin` opens.

> The *Starter* plan is required because the free plan has no disk, and your database would be wiped on every deploy.

## Step 3 — Your own domain (important for SEO and trust)

1. Buy a domain (GoDaddy, Hostinger, Namecheap, Cloudflare). Something short, e.g. `resumeforge.in`.
2. Render → your service → **Settings → Custom Domains** → add `www.yourdomain.com` and `yourdomain.com`. Follow the DNS records Render shows.
3. Change `APP_URL` to `https://www.yourdomain.com` and save. Render redeploys, and canonical URLs, the sitemap and emails all switch to your domain.

## Step 4 — Accept payments (Razorpay)

1. Sign up at https://razorpay.com and complete **KYC / account activation**. You need PAN, a bank account, and the website with its policy pages. Your site already has `/terms`, `/privacy`, `/refund`, `/contact` and `/pricing`.
   - Before you submit, open the three legal pages, read them, fill in your real business details and **have them reviewed by a lawyer or CA**.
2. While activation is pending, use **Test mode** keys: Settings → API Keys → `rzp_test_…`. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Render.
3. **Webhook**: Razorpay → Settings → Webhooks → Add
   - URL: `https://www.yourdomain.com/api/billing/webhook`
   - Secret: any long random text. Put the same text in `RAZORPAY_WEBHOOK_SECRET` on Render.
   - Events: `payment.captured` and `order.paid`
4. Test a purchase on `/pricing` with a Razorpay test card. Your plan should become **Pro**, and the payment should appear in Settings → Billing and in `/admin`.
5. After activation, replace the keys with `rzp_live_…` keys. The site switches to real payments; the test-mode banner on `/pricing` disappears.

Prices live in `backend/plans.py`: ₹199 / ₹449 / ₹1,199. You can change them without code changes using `PRICE_PRO_1M`, `PRICE_PRO_3M` and `PRICE_PRO_12M` (in paise).

## Step 5 — Email (password resets + contact form)

Gmail: turn on 2-step verification → https://myaccount.google.com/apppasswords → create an app password → set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` on Render.
For larger volume, use Zoho Mail, Brevo or Amazon SES with the same settings.

## Step 6 — Get found on Google (SEO)

What is already built in:
- **Fast pages:** gzip compression, long-term asset caching and pages that load without a build step.
- **Unique titles and descriptions:** every page has its own title, description, canonical URL, and Open Graph and Twitter cards with a share image.
- **Structured data (JSON-LD):** Organization, WebSite, SoftwareApplication with prices, FAQPage, Article and Breadcrumbs.
- **`/sitemap.xml` and `/robots.txt`:** generated from `APP_URL`. Private app pages are `noindex`.
- **Keyword pages:**
  - /ai-resume-builder
  - /ats-resume-checker
  - /resume-for-freshers
  - /resume-templates
  - /cover-letter-generator
- **Guides:**
  - /guides/how-to-write-a-resume
  - /guides/resume-action-verbs
  - /guides/ats-friendly-resume
- **Mobile-friendly and installable**

What you must do (this is what actually moves rankings):
1. **Google Search Console**: https://search.google.com/search-console → add your domain → verify with the DNS TXT record → **Sitemaps** → submit `https://www.yourdomain.com/sitemap.xml`. Then use *URL Inspection → Request indexing* on the homepage and key pages.
2. **Bing Webmaster Tools**: https://www.bing.com/webmasters → import from Search Console in one click.
3. **Content, consistently**: publish 2–4 genuinely helpful guides a month. Examples: "resume for software engineer freshers", "resume for MBA students", "how to explain a career gap", "Naukri resume headline examples". Long-tail topics like these rank before broad ones.
4. **Backlinks**: list the product on Product Hunt, Indie Hackers, SaaSHub and AlternativeTo. Share guides on LinkedIn, Reddit (r/developersIndia, r/Indian_Academia) and Quora. Partner with college placement cells and offer them free Pro passes from `/admin`.
5. **Measure**: watch impressions and clicks in Search Console. Improve the titles of pages that get impressions but few clicks.

Be realistic: a brand-new domain usually takes **3–6 months** to rank for competitive terms like "resume builder". Sites such as Naukri, Canva and Zety already hold those positions. Long-tail guides can bring traffic much sooner. No one can guarantee a #1 position.

## Step 7 — Before you announce it

- [ ] `/api/health` returns `{"ok": true}`
- [ ] Sign up, build a resume and download the PDF on your phone
- [ ] A test payment works, and a refund through the Razorpay dashboard works
- [ ] A password-reset email arrives
- [ ] The contact form arrives in your inbox and in `/admin`
- [ ] The legal pages contain your real details and have been reviewed
- [ ] Spend limits are set in the Anthropic Console and alerts in Razorpay
- [ ] Backups are taken (see below)

## Backups

On Render: Dashboard → your service → **Disks → Snapshots**. Render takes daily snapshots automatically.
Also download a copy from the Shell tab now and then:
```
python -c "import sqlite3; s=sqlite3.connect('/data/resumeforge.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d)"
```

## Updating the live site

Change code → GitHub Desktop → **Commit → Push**. Render redeploys automatically in about 3 minutes.
Run the tests first: `python -m unittest discover -s tests`.

## Alternative: your own VPS (Docker + automatic HTTPS)

See `deploy/docker-compose.yml` and `deploy/Caddyfile`:
```bash
curl -fsSL https://get.docker.com | sh
cp .env.example .env && nano .env        # APP_URL, keys …
nano deploy/Caddyfile                     # your domain
cd deploy && docker compose up -d --build
```
