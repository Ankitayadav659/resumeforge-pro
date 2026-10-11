# ResumeForge Pro

A recruiter-grade resume builder for **freshers**, **experienced professionals** and **senior executives**. It is a full-stack web app with accounts, a database, autosave, AI writing (Claude), resume import, cover letters, version history and share links.

---

## 1. Start the app (Windows)

1. Double-click **`start.bat`**.
2. Keep the black window open. That window is the server.
3. Your browser opens **http://localhost:8000**.

The core app needs only Python 3.9+, with nothing extra to install.

## 2. Turn on AI (optional, recommended)

The AI features use Claude from Anthropic. You pay Anthropic for what you use.

1. Create an API key at **https://console.anthropic.com** → *API Keys*.
2. Double-click **`setup.bat`**. It installs the `anthropic` package and opens a `.env` file in Notepad.
3. Paste your key after `ANTHROPIC_API_KEY=`, save the file and run `start.bat` again.

The server window shows `AI : ON (claude-opus-5-5)` when it works. Each user can run 40 AI actions a day by default (`AI_DAILY_LIMIT` in `.env`). This keeps your bill under control.

Without AI, every feature still works using the built-in rules: summary draft, quick bullet review, keyword matching, basic import and the cover-letter template.

## 3. Turn on password-reset emails (optional)

Without email settings, the reset link is printed in the server window. To send real emails, fill in the `SMTP_…` lines in `.env`. For Gmail, use an *App password* from https://myaccount.google.com/apppasswords.

## 4. Put it online

See **[DEPLOY.md](DEPLOY.md)**. It covers hosting, a custom domain, Razorpay, email, Google Search Console and the launch checklist.

## 5. Run the tests

```
python -m unittest discover -s tests -v
```
The suite starts the real server with a throwaway database. It checks:
- every public page's SEO tags, plus the sitemap and robots.txt
- auth and CSRF protection
- Free-plan limits
- Razorpay signature checks and the webhook (simulated, so no real money is involved)
- the admin panel, contact form, version history and import

---

## Features

| Area | What it does |
|---|---|
| **Career modes** | Fresher / Experienced / Executive. Section order, labels, tips and scoring adapt to each level. |
| **Upload & auto-fill** | Upload a PDF, DOCX or TXT resume. With AI on, Claude reads the PDF directly. Without AI, text is extracted (PDF.js / DOCX) and mapped to sections automatically. A preview appears before the resume is created. |
| **Recruiter Score** | A 14-point live audit covering contact details, headline, summary, action verbs, quantified impact, bullet length, clichés, pronouns, dates, skills, page count, level essentials and industry fit. |
| **AI writing (Claude)** | Writes your summary and headline, rewrites bullets, tailors the whole resume to a job description, gives a senior-recruiter review and writes cover letters. It never invents numbers; it leaves `[placeholders]` for you to fill. |
| **Cover letters** | Generated with AI or a smart template. You can edit them and export to PDF, Word or text. They are saved with each resume. |
| **Version history** | Automatic snapshots while you edit and before every AI change. You can name versions, preview them side by side and restore one in a click. |
| **Job-description match** | Shows keyword coverage against a pasted job posting, with matched and missing keywords. |
| **Templates & export** | 4 ATS-safe templates. One-click **PDF download with real, selectable text** (generated in the browser, so ATS systems can read it), plus print-to-PDF, Word, plain text, JSON backup, and a public share link with view counter. |
| **Mobile & design** | Fully responsive on phones: bottom tab bar in the editor, bottom-sheet dialogs, and inputs that don't zoom on iPhone. Light and dark mode (follows the phone/PC setting or a manual toggle). Custom logo and favicon. Installable as an app (web manifest). |
| **SaaS plans** | Free (3 resumes, 3 AI actions/day) and Pro passes (1/3/12 months, ₹199/₹449/₹1,199, no auto-renewal) with server-enforced limits and an upgrade dialog when a limit is reached. Prices and limits are configurable via env vars. |
| **Payments** | Razorpay Checkout (UPI, cards, netbanking, wallets) with server-side order creation, HMAC signature verification and an idempotent webhook. Payment history is in Settings → Billing. |
| **Admin panel** (`/admin`) | Users, Pro members, revenue (30-day and total), sign-up chart, AI usage, user search, grant/revoke Pro, contact-form inbox. Access via `ADMIN_EMAILS`. |
| **SEO** | Keyword landing pages and guides, pricing/contact/legal pages, per-page titles, descriptions, canonicals, Open Graph/Twitter cards, JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage, Article, Breadcrumbs), dynamic `sitemap.xml` and `robots.txt`, `noindex` on app pages, gzip and long-term caching. |
| **Accounts** | Signup and login, forgot/reset password, profile and email change, password change (signs out other devices), export all data, delete account. |

## Project structure

```
server.py              HTTP server, routing, REST API handlers
backend/
  config.py            settings from environment / .env
  db.py                SQLite schema + migrations
  security.py          PBKDF2 hashing, tokens, rate limits
  mailer.py            SMTP email (console fallback)
  ai.py                Claude integration (structured JSON outputs)
  importer.py          DOCX extraction + heuristic resume parser
public/                frontend (HTML/CSS/vanilla JS, no build step)
  index.html  auth.html  dashboard.html  editor.html  settings.html  view.html
deploy/                docker-compose.yml + Caddyfile for a VPS
Dockerfile  render.yaml  requirements.txt  .env.example
start.bat  setup.bat
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | AI / email availability, AI quota |
| POST | `/api/auth/signup` · `/login` · `/logout` | |
| POST | `/api/auth/forgot` · `/reset` | 30-minute single-use reset tokens |
| GET | `/api/auth/me` | |
| PUT | `/api/account` | name / email (email change needs password) |
| POST | `/api/account/password` · `/delete` | |
| GET | `/api/account/export` | |
| GET / POST | `/api/resumes` | |
| GET / PUT / DELETE | `/api/resumes/:id` | |
| POST | `/api/resumes/:id/duplicate` · `/share` | |
| GET / POST | `/api/resumes/:id/versions` | list / save a named version |
| GET | `/api/resumes/:id/versions/:vid` | |
| POST | `/api/resumes/:id/versions/:vid/restore` | |
| POST | `/api/import` | `{filename, data_b64?, text?}` |
| POST | `/api/ai/summary` · `/bullets` · `/tailor` · `/review` · `/cover-letter` | daily quota per user |
| GET | `/api/public/:slug` | shared resume (read-only) |

## Security

- Passwords are hashed with PBKDF2-SHA256 (310k iterations) and a per-user salt.
- Sessions use a random token in an `HttpOnly; SameSite=Lax` cookie, plus `Secure` on HTTPS. Only the token's SHA-256 hash is stored.
- Password-reset tokens are hashed, single-use and expire after 30 minutes. Reset requests never reveal whether an email exists.
- Rate limits apply to logins, signups and reset requests. AI actions have a daily quota per user.
- Every write request must carry an `X-RF: 1` header to block cross-site request forgery.
- Each resume can only be read or changed by its owner, and request bodies have size limits.
- Pages are served with a strict Content-Security-Policy, `nosniff`, frame-deny, Permissions-Policy and HSTS (on HTTPS), with path-traversal-safe static serving.
- Resume and job-description text sent to the AI is wrapped as data, and the model is told never to follow instructions inside it.
