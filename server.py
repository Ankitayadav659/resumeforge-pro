"""
ResumeForge Pro — web server and REST API.

Run:   python server.py            -> http://localhost:8000
       python server.py --open     -> also opens the browser
Config: environment variables or a `.env` file (see .env.example).

Core features use only the Python standard library. AI features additionally need
`pip install -r requirements.txt` and an Anthropic API key.
"""
import base64
import gzip
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
import traceback
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from backend import ai, billing, config, db, importer, mailer, plans, security
from backend.db import now_ms

APP_VERSION = "3.0.0"
STARTED = int(time.time())
ASSET_V = f"{APP_VERSION}-{STARTED}"

SESSION_COOKIE = "rf_session"
SESSION_TTL = 30 * 24 * 3600
RESET_TTL_MS = 30 * 60 * 1000
MAX_BODY = 2 * 1024 * 1024
MAX_IMPORT_BODY = 9 * 1024 * 1024
MAX_IMPORT_FILE = 6 * 1024 * 1024
VERSION_EVERY_MS = 10 * 60 * 1000
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

# ---- pages ------------------------------------------------------------------------
SEO_PAGES = {
    "/ai-resume-builder": "seo/ai-resume-builder.html",
    "/ats-resume-checker": "seo/ats-resume-checker.html",
    "/resume-for-freshers": "seo/resume-for-freshers.html",
    "/cover-letter-generator": "seo/cover-letter-generator.html",
    "/resume-templates": "seo/resume-templates.html",
    "/guides/how-to-write-a-resume": "seo/how-to-write-a-resume.html",
    "/guides/resume-action-verbs": "seo/resume-action-verbs.html",
    "/guides/ats-friendly-resume": "seo/ats-friendly-resume.html",
}
PUBLIC_PAGES = {
    "/": "index.html",
    "/pricing": "pricing.html",
    "/contact": "contact.html",
    "/terms": "legal/terms.html",
    "/privacy": "legal/privacy.html",
    "/refund": "legal/refund.html",
    **SEO_PAGES,
}
APP_PAGES = {  # never indexed by search engines
    "/login": "auth.html",
    "/signup": "auth.html",
    "/forgot": "auth.html",
    "/reset": "auth.html",
    "/dashboard": "dashboard.html",
    "/editor": "editor.html",
    "/settings": "settings.html",
    "/admin": "admin.html",
}
PAGES = {**PUBLIC_PAGES, **APP_PAGES, "/favicon.ico": "img/logo.svg"}
SITEMAP_PRIORITY = {"/": "1.0", "/pricing": "0.9", "/ai-resume-builder": "0.9", "/ats-resume-checker": "0.9",
                    "/resume-for-freshers": "0.9", "/resume-templates": "0.8", "/cover-letter-generator": "0.8"}

CSP = (
    "default-src 'self'; "
    "script-src 'self' https://cdnjs.cloudflare.com https://checkout.razorpay.com; "
    "worker-src 'self' blob: https://cdnjs.cloudflare.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; "
    "connect-src 'self' https://lumberjack.razorpay.com; "
    "frame-src https://api.razorpay.com https://checkout.razorpay.com; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)
COMPRESSIBLE = ("text/", "application/javascript", "application/json", "image/svg+xml", "application/xml", "application/manifest+json")


class ApiError(Exception):
    def __init__(self, status, msg, **extra):
        super().__init__(msg)
        self.status, self.msg, self.extra = status, msg, extra


# =============================================================================== helpers

def is_admin(user):
    return bool(user) and user["email"].lower() in config.ADMIN_EMAILS


def public_user(row):
    plan = plans.effective_plan(row)
    return {
        "id": row["id"], "name": row["name"], "email": row["email"], "created_at": row["created_at"],
        "plan": plan, "plan_expires_at": row["plan_expires_at"] if plan == "pro" else None,
        "limits": plans.LIMITS[plan], "is_admin": is_admin(row),
    }


def resume_out(row, with_data=True):
    out = {k: row[k] for k in ("id", "name", "mode", "share_slug", "share_views", "created_at", "updated_at")}
    if with_data:
        out["data"] = json.loads(row["data"])
    return out


def clean_text(value, field, max_len, required=True):
    value = str(value or "").strip()
    if required and not value:
        raise ApiError(400, f"{field} is required")
    if len(value) > max_len:
        raise ApiError(400, f"{field} must be at most {max_len} characters")
    return value


def clean_email(value):
    email = str(value or "").strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise ApiError(400, "Enter a valid email address")
    return email


def check_resume_data(data):
    if not isinstance(data, dict):
        raise ApiError(400, "Resume data must be an object")
    if len(json.dumps(data)) > 500_000:
        raise ApiError(413, "Resume is too large")
    mode = data.get("mode")
    return mode if mode in ("fresher", "experienced", "executive") else "experienced"


def start_session(ctx, user_id):
    token = security.new_token()
    ctx.conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (security.token_hash(token), user_id, now_ms() + SESSION_TTL * 1000),
    )
    ctx.conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_ms(), user_id))
    ctx.set_cookie(token, SESSION_TTL)


def get_owned(ctx, rid):
    row = ctx.conn.execute("SELECT * FROM resumes WHERE id = ? AND user_id = ?", (rid, ctx.user["id"])).fetchone()
    if not row:
        raise ApiError(404, "Resume not found")
    return row


def snapshot(ctx, row, reason):
    keep = plans.limits_for(ctx.user)["versions"]
    ctx.conn.execute(
        "INSERT INTO resume_versions (resume_id, name, data, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        (row["id"], row["name"], row["data"], reason, now_ms()),
    )
    ctx.conn.execute(
        "DELETE FROM resume_versions WHERE resume_id = ? AND id NOT IN "
        "(SELECT id FROM resume_versions WHERE resume_id = ? ORDER BY created_at DESC LIMIT ?)",
        (row["id"], row["id"], keep),
    )


def ai_quota(ctx):
    since = now_ms() - 24 * 3600 * 1000
    used = ctx.conn.execute("SELECT COUNT(*) FROM ai_usage WHERE user_id = ? AND created_at > ?", (ctx.user["id"], since)).fetchone()[0]
    limit = plans.limits_for(ctx.user)["ai_daily"]
    return {"used": used, "limit": limit, "remaining": max(0, limit - used), "plan": plans.effective_plan(ctx.user)}


def upgrade_error(message):
    return ApiError(402, message, upgrade=True)


# =============================================================================== auth

def api_signup(ctx):
    if security.signup_limiter.blocked(ctx.ip):
        raise ApiError(429, "Too many accounts created from this network. Try again later.")
    b = ctx.body
    name = clean_text(b.get("name"), "Name", 80)
    email = clean_email(b.get("email"))
    pw = str(b.get("password") or "")
    if problem := security.password_problem(pw):
        raise ApiError(400, problem)
    if ctx.conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise ApiError(409, "An account with this email already exists — log in instead")
    cur = ctx.conn.execute(
        "INSERT INTO users (name, email, pw_hash, created_at) VALUES (?, ?, ?, ?)",
        (name, email, security.hash_password(pw), now_ms()),
    )
    security.signup_limiter.hit(ctx.ip)
    start_session(ctx, cur.lastrowid)
    user = ctx.conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return 201, {"user": public_user(user)}


def api_login(ctx):
    email = str(ctx.body.get("email") or "").strip().lower()
    pw = str(ctx.body.get("password") or "")
    key = (ctx.ip, email)
    if security.login_limiter.blocked(key):
        raise ApiError(429, "Too many failed attempts. Try again in a few minutes, or reset your password.")
    user = ctx.conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not security.verify_password(pw, user["pw_hash"]):
        security.login_limiter.hit(key)
        raise ApiError(401, "Incorrect email or password")
    security.login_limiter.reset(key)
    start_session(ctx, user["id"])
    return 200, {"user": public_user(user)}


def api_logout(ctx):
    if ctx.token:
        ctx.conn.execute("DELETE FROM sessions WHERE token_hash = ?", (security.token_hash(ctx.token),))
    ctx.set_cookie("", 0)
    return 200, {"ok": True}


def api_me(ctx):
    return 200, {"user": public_user(ctx.user)}


def api_forgot(ctx):
    email = clean_email(ctx.body.get("email"))
    if security.forgot_limiter.blocked(ctx.ip):
        raise ApiError(429, "Too many reset requests. Try again later.")
    security.forgot_limiter.hit(ctx.ip)
    user = ctx.conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user:
        token = security.new_token()
        ctx.conn.execute("DELETE FROM password_resets WHERE user_id = ?", (user["id"],))
        ctx.conn.execute(
            "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (security.token_hash(token), user["id"], now_ms() + RESET_TTL_MS),
        )
        mailer.send_password_reset(user["email"], user["name"], f"{config.APP_URL}/reset?token={token}")
    # Same answer whether or not the account exists, so emails cannot be enumerated.
    return 200, {"ok": True, "email_enabled": config.EMAIL_ENABLED}


def api_reset(ctx):
    token = str(ctx.body.get("token") or "")
    pw = str(ctx.body.get("password") or "")
    if problem := security.password_problem(pw):
        raise ApiError(400, problem)
    row = ctx.conn.execute(
        "SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
        (security.token_hash(token), now_ms()),
    ).fetchone()
    if not row:
        raise ApiError(400, "This reset link is invalid or has expired. Request a new one.")
    ctx.conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (security.hash_password(pw), row["user_id"]))
    ctx.conn.execute("UPDATE password_resets SET used_at = ? WHERE token_hash = ?", (now_ms(), row["token_hash"]))
    ctx.conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))
    start_session(ctx, row["user_id"])
    user = ctx.conn.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
    return 200, {"user": public_user(user)}


# =============================================================================== account

def api_update_account(ctx):
    name = clean_text(ctx.body.get("name", ctx.user["name"]), "Name", 80)
    email = clean_email(ctx.body.get("email", ctx.user["email"]))
    if email != ctx.user["email"].lower():
        if not security.verify_password(str(ctx.body.get("password") or ""), ctx.user["pw_hash"]):
            raise ApiError(403, "Enter your current password to change your email")
        if ctx.conn.execute("SELECT 1 FROM users WHERE email = ? AND id != ?", (email, ctx.user["id"])).fetchone():
            raise ApiError(409, "Another account already uses this email")
    ctx.conn.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", (name, email, ctx.user["id"]))
    user = ctx.conn.execute("SELECT * FROM users WHERE id = ?", (ctx.user["id"],)).fetchone()
    return 200, {"user": public_user(user)}


def api_change_password(ctx):
    if not security.verify_password(str(ctx.body.get("current") or ""), ctx.user["pw_hash"]):
        raise ApiError(403, "Your current password is incorrect")
    pw = str(ctx.body.get("password") or "")
    if problem := security.password_problem(pw):
        raise ApiError(400, problem)
    ctx.conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (security.hash_password(pw), ctx.user["id"]))
    # Sign out every other device; keep this one signed in with a fresh session.
    ctx.conn.execute("DELETE FROM sessions WHERE user_id = ?", (ctx.user["id"],))
    start_session(ctx, ctx.user["id"])
    return 200, {"ok": True}


def api_delete_account(ctx):
    if not security.verify_password(str(ctx.body.get("password") or ""), ctx.user["pw_hash"]):
        raise ApiError(403, "Incorrect password")
    ctx.conn.execute("DELETE FROM users WHERE id = ?", (ctx.user["id"],))
    ctx.set_cookie("", 0)
    return 200, {"ok": True}


def api_export_account(ctx):
    rows = ctx.conn.execute("SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC", (ctx.user["id"],)).fetchall()
    pays = ctx.conn.execute("SELECT plan_code, amount, currency, status, created_at, paid_at FROM payments WHERE user_id = ?",
                            (ctx.user["id"],)).fetchall()
    return 200, {
        "exported_at": now_ms(),
        "account": public_user(ctx.user),
        "resumes": [resume_out(r) for r in rows],
        "payments": [dict(p) for p in pays],
    }


def api_config(ctx):
    out = {
        "ai": ai.status(),
        "email_enabled": config.EMAIL_ENABLED,
        "plans": plans.public_plans(),
        "payments": {"enabled": billing.enabled(), "test_mode": billing.test_mode()},
        "site": {"name": config.SITE_NAME, "support_email": config.SUPPORT_EMAIL},
    }
    if ctx.user:
        out["usage"] = {
            "resumes": ctx.conn.execute("SELECT COUNT(*) FROM resumes WHERE user_id = ?", (ctx.user["id"],)).fetchone()[0],
            "ai": ai_quota(ctx),
        }
        if out["ai"]["enabled"]:
            out["ai"]["quota"] = out["usage"]["ai"]
    return 200, out


# =============================================================================== resumes

def api_list_resumes(ctx):
    rows = ctx.conn.execute("SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC", (ctx.user["id"],)).fetchall()
    return 200, {"resumes": [resume_out(r) for r in rows]}


def api_create_resume(ctx):
    count = ctx.conn.execute("SELECT COUNT(*) FROM resumes WHERE user_id = ?", (ctx.user["id"],)).fetchone()[0]
    limit = plans.limits_for(ctx.user)["resumes"]
    if count >= limit:
        if plans.effective_plan(ctx.user) == "free":
            raise upgrade_error(f"The Free plan includes {limit} resumes. Upgrade to Pro for up to {plans.LIMITS['pro']['resumes']} resumes, or delete one you no longer need.")
        raise ApiError(400, f"You can keep up to {limit} resumes. Delete one to create another.")
    data = ctx.body.get("data") or {}
    mode = check_resume_data(data)
    name = clean_text(ctx.body.get("name") or data.get("name") or "My Resume", "Resume name", 120)
    rid = secrets.token_hex(8)
    data["id"], data["name"] = rid, name
    ts = now_ms()
    ctx.conn.execute(
        "INSERT INTO resumes (id, user_id, name, mode, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (rid, ctx.user["id"], name, mode, json.dumps(data), ts, ts),
    )
    return 201, {"resume": resume_out(get_owned(ctx, rid))}


def api_get_resume(ctx):
    return 200, {"resume": resume_out(get_owned(ctx, ctx.params[0]))}


def api_update_resume(ctx):
    row = get_owned(ctx, ctx.params[0])
    name, mode, data = row["name"], row["mode"], json.loads(row["data"])
    if "name" in ctx.body:
        name = clean_text(ctx.body["name"], "Resume name", 120)
    if "data" in ctx.body:
        data = ctx.body["data"]
        mode = check_resume_data(data)
    data["id"], data["name"] = row["id"], name
    new_json = json.dumps(data)
    ts = now_ms()
    if new_json != row["data"]:
        last = ctx.conn.execute("SELECT MAX(created_at) FROM resume_versions WHERE resume_id = ?", (row["id"],)).fetchone()[0]
        if not last or ts - last >= VERSION_EVERY_MS:
            snapshot(ctx, row, "autosave")
    ctx.conn.execute(
        "UPDATE resumes SET name = ?, mode = ?, data = ?, updated_at = ? WHERE id = ?",
        (name, mode, new_json, ts, row["id"]),
    )
    return 200, {"resume": {"id": row["id"], "name": name, "updated_at": ts}}


def api_delete_resume(ctx):
    row = get_owned(ctx, ctx.params[0])
    ctx.conn.execute("DELETE FROM resumes WHERE id = ?", (row["id"],))
    return 200, {"ok": True}


def api_duplicate_resume(ctx):
    row = get_owned(ctx, ctx.params[0])
    ctx.body = {"name": (row["name"] + " (copy)")[:120], "data": json.loads(row["data"])}
    return api_create_resume(ctx)


def api_share_resume(ctx):
    row = get_owned(ctx, ctx.params[0])
    enabled = bool(ctx.body.get("enabled", True))
    slug = row["share_slug"]
    if enabled and not slug:
        slug = secrets.token_urlsafe(9)
    elif not enabled:
        slug = None
    ctx.conn.execute(
        "UPDATE resumes SET share_slug = ?, share_views = CASE WHEN ? IS NULL THEN 0 ELSE share_views END WHERE id = ?",
        (slug, slug, row["id"]),
    )
    return 200, {"share_slug": slug}


def api_public_resume(ctx):
    row = ctx.conn.execute(
        "SELECT r.*, u.plan, u.plan_expires_at FROM resumes r JOIN users u ON u.id = r.user_id WHERE r.share_slug = ?",
        (ctx.params[0],),
    ).fetchone()
    if not row:
        raise ApiError(404, "This resume link is invalid or has been turned off")
    ctx.conn.execute("UPDATE resumes SET share_views = share_views + 1 WHERE id = ?", (row["id"],))
    data = json.loads(row["data"])
    data.pop("jd", None)            # the owner's private notes stay private
    data.pop("coverLetter", None)
    branding = plans.LIMITS[plans.effective_plan(row)]["branding"]
    return 200, {"resume": {"name": row["name"], "data": data, "updated_at": row["updated_at"], "branding": branding}}


# =============================================================================== versions

def api_list_versions(ctx):
    row = get_owned(ctx, ctx.params[0])
    rows = ctx.conn.execute(
        "SELECT id, name, reason, created_at, length(data) AS size FROM resume_versions WHERE resume_id = ? ORDER BY created_at DESC",
        (row["id"],),
    ).fetchall()
    return 200, {"versions": [dict(r) for r in rows], "keep": plans.limits_for(ctx.user)["versions"]}


def _get_version(ctx):
    row = get_owned(ctx, ctx.params[0])
    v = ctx.conn.execute("SELECT * FROM resume_versions WHERE id = ? AND resume_id = ?", (int(ctx.params[1]), row["id"])).fetchone()
    if not v:
        raise ApiError(404, "Version not found")
    return row, v


def api_get_version(ctx):
    _row, v = _get_version(ctx)
    return 200, {"version": {"id": v["id"], "name": v["name"], "reason": v["reason"], "created_at": v["created_at"], "data": json.loads(v["data"])}}


def api_create_version(ctx):
    row = get_owned(ctx, ctx.params[0])
    reason = clean_text(ctx.body.get("reason") or "Saved manually", "Label", 80)
    snapshot(ctx, row, reason)
    return 201, {"ok": True}


def api_restore_version(ctx):
    row, v = _get_version(ctx)
    snapshot(ctx, row, "Before restoring an older version")
    data = json.loads(v["data"])
    data["id"], data["name"] = row["id"], row["name"]
    ts = now_ms()
    ctx.conn.execute(
        "UPDATE resumes SET mode = ?, data = ?, updated_at = ? WHERE id = ?",
        (check_resume_data(data), json.dumps(data), ts, row["id"]),
    )
    return 200, {"resume": resume_out(get_owned(ctx, row["id"]))}


# =============================================================================== import

def api_import(ctx):
    filename = str(ctx.body.get("filename") or "resume").lower()
    text = str(ctx.body.get("text") or "")[:200_000]
    raw = None
    if ctx.body.get("data_b64"):
        try:
            raw = base64.b64decode(ctx.body["data_b64"], validate=True)
        except ValueError:
            raise ApiError(400, "The uploaded file could not be read")
        if len(raw) > MAX_IMPORT_FILE:
            raise ApiError(413, "File is too large (max 6 MB)")

    is_pdf = filename.endswith(".pdf") or (raw is not None and raw[:5] == b"%PDF-")
    is_docx = filename.endswith(".docx")
    if filename.endswith(".doc") and not is_docx:
        raise ApiError(400, "Old .doc files are not supported. Open it in Word and save as .docx or PDF.")
    try:
        if is_docx:
            if raw is None:
                raise ApiError(400, "No file received")
            text = importer.docx_to_text(raw)

        use_ai = ai.available() and ctx.body.get("use_ai", True) and ai_quota(ctx)["remaining"] > 0
        if use_ai:
            pdf_b64 = base64.b64encode(raw).decode() if (is_pdf and raw) else None
            if not pdf_b64 and not text.strip():
                raise ApiError(400, "No text could be read from this file.")
            parsed, usage = ai.parse_resume(text=text, pdf_b64=pdf_b64)
            record_ai(ctx, "import", usage)
            method = "ai"
        else:
            if not text.strip():
                raise ApiError(400, "No text could be read from this file. If it is a scanned PDF, upload a .docx version instead.")
            parsed = importer.heuristic_parse(text)
            method = "basic"
    except importer.ImportError_ as e:
        raise ApiError(400, e.msg)
    except ai.AIError as e:
        raise ApiError(e.status, e.message)
    return 200, {"data": importer.to_resume_fields(parsed), "method": method}


# =============================================================================== AI

def record_ai(ctx, kind, usage):
    ctx.conn.execute(
        "INSERT INTO ai_usage (user_id, kind, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?)",
        (ctx.user["id"], kind, usage.get("input_tokens", 0), usage.get("output_tokens", 0), now_ms()),
    )


def ai_endpoint(kind, fn):
    def handler(ctx):
        if not ai.available():
            raise ApiError(503, ai.status()["reason"])
        q = ai_quota(ctx)
        if q["remaining"] <= 0:
            if q["plan"] == "free":
                raise upgrade_error(f"You have used today's {q['limit']} free AI actions. Upgrade to Pro for {plans.LIMITS['pro']['ai_daily']} AI actions a day.")
            raise ApiError(429, f"You have used today's {q['limit']} AI actions. The limit resets within 24 hours.")
        resume = ctx.body.get("resume")
        if not isinstance(resume, dict):
            raise ApiError(400, "Missing resume")
        check_resume_data(resume)
        try:
            result, usage = fn(ctx.body, resume)
        except ai.AIError as e:
            raise ApiError(e.status, e.message)
        record_ai(ctx, kind, usage)
        return 200, {"result": result, "quota": ai_quota(ctx)}
    return handler


def _need(body, key, label, max_len=20000):
    v = str(body.get(key) or "").strip()
    if not v:
        raise ApiError(400, f"{label} is required")
    return v[:max_len]


api_ai_summary = ai_endpoint("summary", lambda b, r: ai.write_summary(r, b.get("jd") or ""))
api_ai_bullets = ai_endpoint("bullets", lambda b, r: ai.rewrite_bullets(
    r, _need(b, "entry", "Entry text"), bool(b.get("current")), str(b.get("section") or "experience")))
api_ai_tailor = ai_endpoint("tailor", lambda b, r: ai.tailor(r, _need(b, "jd", "Job description")))
api_ai_review = ai_endpoint("review", lambda b, r: ai.review(r, str(b.get("target") or "")[:100]))
api_ai_cover = ai_endpoint("cover_letter", lambda b, r: ai.cover_letter(
    r, b.get("jd") or "", b.get("company"), b.get("role"), b.get("manager"), str(b.get("tone") or "professional")))


# =============================================================================== billing

def activate_payment(conn, order_id, payment_id):
    """Marks an order paid and grants Pro exactly once. Returns the payment row."""
    pay = conn.execute("SELECT * FROM payments WHERE order_id = ?", (order_id,)).fetchone()
    if not pay:
        return None
    if pay["status"] == "paid":
        return pay
    p = plans.PASSES.get(pay["plan_code"])
    if not p:
        return None
    conn.execute("UPDATE payments SET status = 'paid', payment_id = ?, paid_at = ? WHERE id = ? AND status != 'paid'",
                 (payment_id, now_ms(), pay["id"]))
    plans.extend(conn, pay["user_id"], p["days"])
    return conn.execute("SELECT * FROM payments WHERE id = ?", (pay["id"],)).fetchone()


def api_billing_order(ctx):
    code = str(ctx.body.get("plan") or "")
    p = plans.PASSES.get(code)
    if not p:
        raise ApiError(400, "Unknown plan")
    try:
        order = billing.create_order(p["amount"], plans.CURRENCY, f"u{ctx.user['id']}-{now_ms()}",
                                     {"user_id": str(ctx.user["id"]), "plan": code, "email": ctx.user["email"]})
    except billing.BillingError as e:
        raise ApiError(e.status, e.message)
    ctx.conn.execute(
        "INSERT INTO payments (user_id, order_id, plan_code, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, 'created', ?)",
        (ctx.user["id"], order["id"], code, p["amount"], plans.CURRENCY, now_ms()),
    )
    return 200, {
        "order_id": order["id"], "amount": p["amount"], "currency": plans.CURRENCY, "key_id": billing.key_id(),
        "name": config.SITE_NAME, "description": p["label"],
        "prefill": {"name": ctx.user["name"], "email": ctx.user["email"]},
    }


def api_billing_verify(ctx):
    order_id = str(ctx.body.get("razorpay_order_id") or "")
    payment_id = str(ctx.body.get("razorpay_payment_id") or "")
    signature = str(ctx.body.get("razorpay_signature") or "")
    pay = ctx.conn.execute("SELECT * FROM payments WHERE order_id = ? AND user_id = ?", (order_id, ctx.user["id"])).fetchone()
    if not pay:
        raise ApiError(404, "Order not found")
    if not billing.verify_checkout_signature(order_id, payment_id, signature):
        raise ApiError(400, "Payment could not be verified. If money was deducted, it will be confirmed automatically within a few minutes — or contact support.")
    activate_payment(ctx.conn, order_id, payment_id)
    user = ctx.conn.execute("SELECT * FROM users WHERE id = ?", (ctx.user["id"],)).fetchone()
    return 200, {"user": public_user(user)}


def handle_webhook(raw, signature):
    if not billing.verify_webhook_signature(raw, signature):
        return 400, {"error": "invalid signature"}
    try:
        event = json.loads(raw.decode("utf-8"))
    except ValueError:
        return 400, {"error": "bad json"}
    if event.get("event") in ("payment.captured", "order.paid"):
        payload = event.get("payload", {})
        payment = (payload.get("payment") or {}).get("entity") or {}
        order_id = payment.get("order_id") or ((payload.get("order") or {}).get("entity") or {}).get("id")
        if order_id:
            with db.connect() as conn:
                activate_payment(conn, order_id, payment.get("id"))
    return 200, {"ok": True}


def api_billing_history(ctx):
    rows = ctx.conn.execute(
        "SELECT plan_code, amount, currency, status, created_at, paid_at, payment_id FROM payments WHERE user_id = ? AND status = 'paid' ORDER BY created_at DESC",
        (ctx.user["id"],),
    ).fetchall()
    return 200, {"payments": [dict(r, label=plans.PASSES.get(r["plan_code"], {}).get("label", r["plan_code"])) for r in rows]}


# =============================================================================== contact & admin

def api_contact(ctx):
    if security.forgot_limiter.blocked(("contact", ctx.ip)):
        raise ApiError(429, "Too many messages. Please try again later.")
    name = clean_text(ctx.body.get("name"), "Name", 80)
    email = clean_email(ctx.body.get("email"))
    topic = clean_text(ctx.body.get("topic") or "General", "Topic", 40)
    message = clean_text(ctx.body.get("message"), "Message", 4000)
    security.forgot_limiter.hit(("contact", ctx.ip))
    ctx.conn.execute(
        "INSERT INTO contact_messages (name, email, topic, message, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (name, email, topic, message, ctx.user["id"] if ctx.user else None, now_ms()),
    )
    if config.SUPPORT_EMAIL:
        mailer.send(config.SUPPORT_EMAIL, f"[{config.SITE_NAME}] {topic} — {name}", f"From: {name} <{email}>\n\n{message}")
    return 201, {"ok": True}


def api_admin_stats(ctx):
    c = ctx.conn
    t = now_ms()
    d30 = t - 30 * 24 * 3600 * 1000
    one = lambda sql, *a: c.execute(sql, a).fetchone()[0]
    return 200, {
        "users": one("SELECT COUNT(*) FROM users"),
        "users_30d": one("SELECT COUNT(*) FROM users WHERE created_at > ?", d30),
        "active_30d": one("SELECT COUNT(*) FROM users WHERE last_login_at > ?", d30),
        "pro_active": one("SELECT COUNT(*) FROM users WHERE plan = 'pro' AND plan_expires_at > ?", t),
        "resumes": one("SELECT COUNT(*) FROM resumes"),
        "revenue_total": one("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid'"),
        "revenue_30d": one("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid' AND paid_at > ?", d30),
        "payments_30d": one("SELECT COUNT(*) FROM payments WHERE status = 'paid' AND paid_at > ?", d30),
        "ai_30d": one("SELECT COUNT(*) FROM ai_usage WHERE created_at > ?", d30),
        "messages_open": one("SELECT COUNT(*) FROM contact_messages WHERE handled = 0"),
        "signups_by_day": [dict(r) for r in c.execute(
            "SELECT date(created_at/1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE created_at > ? GROUP BY day ORDER BY day", (d30,))],
    }


def api_admin_users(ctx):
    q = str((ctx.query.get("q") or [""])[0]).strip().lower()
    rows = ctx.conn.execute(
        "SELECT u.*, (SELECT COUNT(*) FROM resumes r WHERE r.user_id = u.id) AS resume_count, "
        "(SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.user_id = u.id AND p.status='paid') AS paid_total "
        "FROM users u WHERE (? = '' OR lower(u.email) LIKE ? OR lower(u.name) LIKE ?) ORDER BY u.created_at DESC LIMIT 200",
        (q, f"%{q}%", f"%{q}%"),
    ).fetchall()
    return 200, {"users": [dict(public_user(r), resume_count=r["resume_count"], paid_total=r["paid_total"],
                                last_login_at=r["last_login_at"]) for r in rows]}


def api_admin_set_plan(ctx):
    uid = int(ctx.params[0])
    if not ctx.conn.execute("SELECT 1 FROM users WHERE id = ?", (uid,)).fetchone():
        raise ApiError(404, "User not found")
    action = ctx.body.get("action")
    if action == "grant":
        days = max(1, min(3660, int(ctx.body.get("days") or 30)))
        plans.extend(ctx.conn, uid, days)
    elif action == "revoke":
        ctx.conn.execute("UPDATE users SET plan = 'free', plan_expires_at = NULL WHERE id = ?", (uid,))
    else:
        raise ApiError(400, "Unknown action")
    row = ctx.conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return 200, {"user": public_user(row)}


def api_admin_messages(ctx):
    rows = ctx.conn.execute("SELECT * FROM contact_messages ORDER BY handled, created_at DESC LIMIT 200").fetchall()
    return 200, {"messages": [dict(r) for r in rows]}


def api_admin_message_done(ctx):
    ctx.conn.execute("UPDATE contact_messages SET handled = 1 WHERE id = ?", (int(ctx.params[0]),))
    return 200, {"ok": True}


def api_health(ctx):
    return 200, {"ok": True, "version": APP_VERSION, "time": now_ms()}


# (method, pattern, handler, access, max_body)   access: None | "user" | "admin"
RID = r"([a-f0-9]{16})"
ROUTES = [
    ("GET", r"^/api/health$", api_health, None, 0),
    ("GET", r"^/api/config$", api_config, None, 0),
    ("POST", r"^/api/auth/signup$", api_signup, None, MAX_BODY),
    ("POST", r"^/api/auth/login$", api_login, None, MAX_BODY),
    ("POST", r"^/api/auth/logout$", api_logout, None, MAX_BODY),
    ("POST", r"^/api/auth/forgot$", api_forgot, None, MAX_BODY),
    ("POST", r"^/api/auth/reset$", api_reset, None, MAX_BODY),
    ("GET", r"^/api/auth/me$", api_me, "user", 0),
    ("PUT", r"^/api/account$", api_update_account, "user", MAX_BODY),
    ("POST", r"^/api/account/password$", api_change_password, "user", MAX_BODY),
    ("POST", r"^/api/account/delete$", api_delete_account, "user", MAX_BODY),
    ("GET", r"^/api/account/export$", api_export_account, "user", 0),
    ("GET", r"^/api/resumes$", api_list_resumes, "user", 0),
    ("POST", r"^/api/resumes$", api_create_resume, "user", MAX_BODY),
    ("GET", rf"^/api/resumes/{RID}$", api_get_resume, "user", 0),
    ("PUT", rf"^/api/resumes/{RID}$", api_update_resume, "user", MAX_BODY),
    ("DELETE", rf"^/api/resumes/{RID}$", api_delete_resume, "user", 0),
    ("POST", rf"^/api/resumes/{RID}/duplicate$", api_duplicate_resume, "user", MAX_BODY),
    ("POST", rf"^/api/resumes/{RID}/share$", api_share_resume, "user", MAX_BODY),
    ("GET", rf"^/api/resumes/{RID}/versions$", api_list_versions, "user", 0),
    ("POST", rf"^/api/resumes/{RID}/versions$", api_create_version, "user", MAX_BODY),
    ("GET", rf"^/api/resumes/{RID}/versions/(\d+)$", api_get_version, "user", 0),
    ("POST", rf"^/api/resumes/{RID}/versions/(\d+)/restore$", api_restore_version, "user", MAX_BODY),
    ("POST", r"^/api/import$", api_import, "user", MAX_IMPORT_BODY),
    ("POST", r"^/api/ai/summary$", api_ai_summary, "user", MAX_BODY),
    ("POST", r"^/api/ai/bullets$", api_ai_bullets, "user", MAX_BODY),
    ("POST", r"^/api/ai/tailor$", api_ai_tailor, "user", MAX_BODY),
    ("POST", r"^/api/ai/review$", api_ai_review, "user", MAX_BODY),
    ("POST", r"^/api/ai/cover-letter$", api_ai_cover, "user", MAX_BODY),
    ("POST", r"^/api/billing/order$", api_billing_order, "user", MAX_BODY),
    ("POST", r"^/api/billing/verify$", api_billing_verify, "user", MAX_BODY),
    ("GET", r"^/api/billing/history$", api_billing_history, "user", 0),
    ("POST", r"^/api/contact$", api_contact, None, MAX_BODY),
    ("GET", r"^/api/admin/stats$", api_admin_stats, "admin", 0),
    ("GET", r"^/api/admin/users$", api_admin_users, "admin", 0),
    ("POST", r"^/api/admin/users/(\d+)/plan$", api_admin_set_plan, "admin", MAX_BODY),
    ("GET", r"^/api/admin/messages$", api_admin_messages, "admin", 0),
    ("POST", r"^/api/admin/messages/(\d+)/done$", api_admin_message_done, "admin", MAX_BODY),
    ("GET", r"^/api/public/([A-Za-z0-9_-]{6,32})$", api_public_resume, None, 0),
]
COMPILED = [(m, re.compile(p), fn, access, mb) for m, p, fn, access, mb in ROUTES]


# =============================================================================== SEO

def robots_txt():
    return (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n" + "".join(f"Disallow: {p}\n" for p in APP_PAGES) + "Disallow: /r/\n\n"
        f"Sitemap: {config.APP_URL}/sitemap.xml\n"
    )


def sitemap_xml():
    day = time.strftime("%Y-%m-%d", time.gmtime(STARTED))
    urls = "".join(
        f"  <url><loc>{config.APP_URL}{path if path != '/' else '/'}</loc><lastmod>{day}</lastmod>"
        f"<changefreq>{'weekly' if path in ('/', '/pricing') else 'monthly'}</changefreq>"
        f"<priority>{SITEMAP_PRIORITY.get(path, '0.6' if path.startswith('/guides') else '0.3')}</priority></url>\n"
        for path in PUBLIC_PAGES
    )
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n'


def render_html(body, path):
    """Fills {{PLACEHOLDERS}} in HTML so canonical URLs, asset versions and the year are always right."""
    canonical = config.APP_URL + (path if path in PUBLIC_PAGES else "/")
    repl = {
        "{{APP_URL}}": config.APP_URL, "{{CANONICAL}}": canonical, "{{V}}": ASSET_V,
        "{{YEAR}}": time.strftime("%Y"), "{{SITE}}": config.SITE_NAME,
        "{{BUSINESS}}": config.BUSINESS_NAME, "{{SUPPORT_EMAIL}}": config.SUPPORT_EMAIL or "support@" + urlparse(config.APP_URL).hostname,
        "{{PRICE_1M}}": f"{plans.PASSES['pro_1m']['amount'] // 100}",
        "{{PRICE_3M}}": f"{plans.PASSES['pro_3m']['amount'] // 100}",
        "{{PRICE_12M}}": f"{plans.PASSES['pro_12m']['amount'] // 100}",
    }
    text = body.decode("utf-8")
    for k, v in repl.items():
        text = text.replace(k, v)
    return text.encode("utf-8")


# =============================================================================== HTTP layer

class Ctx:
    def __init__(self, handler, conn, user, token, body, params, ip, query):
        self.handler, self.conn, self.user, self.token = handler, conn, user, token
        self.body, self.params, self.ip, self.query = body, params, ip, query
        self.cookies = []

    def set_cookie(self, value, max_age):
        secure = "; Secure" if config.COOKIE_SECURE else ""
        self.cookies.append(f"{SESSION_COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")


class Handler(BaseHTTPRequestHandler):
    server_version = "ResumeForge"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    # -- helpers
    def client_ip(self):
        if config.TRUST_PROXY:
            fwd = self.headers.get("X-Forwarded-For")
            if fwd:
                return fwd.split(",")[0].strip()
        return self.client_address[0]

    def security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\")")
        if config.COOKIE_SECURE:
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

    def send_body(self, status, body, ctype, cache="no-store", extra=()):
        if len(body) > 1024 and any(ctype.startswith(c) for c in COMPRESSIBLE) and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, 6)
            extra = list(extra) + [("Content-Encoding", "gzip")]
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("Vary", "Accept-Encoding")
        for k, v in extra:
            self.send_header(k, v)
        self.security_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, payload, cookies=()):
        self.send_body(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8",
                       extra=[("Set-Cookie", c) for c in cookies])

    def read_raw(self, max_body):
        length = int(self.headers.get("Content-Length") or 0)
        if length > max_body:
            raise ApiError(413, "Request too large")
        return self.rfile.read(length) if length else b""

    def read_json(self, max_body):
        raw = self.read_raw(max_body)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "Invalid JSON body")
        if not isinstance(data, dict):
            raise ApiError(400, "JSON body must be an object")
        return data

    def session(self, conn):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie") or "")
        except Exception:
            return None, None
        morsel = cookie.get(SESSION_COOKIE)
        if not morsel or not morsel.value:
            return None, None
        token = morsel.value
        user = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
            (security.token_hash(token), now_ms()),
        ).fetchone()
        return user, token

    # -- routing
    def dispatch(self, method):
        url = urlparse(self.path)
        path = url.path
        if path != "/" and path.endswith("/") and not path.startswith("/api/"):
            return self.redirect(path.rstrip("/"))
        if path.startswith("/api/"):
            return self.handle_api(method, path, parse_qs(url.query))
        if method != "GET":
            return self.send_json(405, {"error": "Method not allowed"})
        if path == "/robots.txt":
            return self.send_body(200, robots_txt().encode(), "text/plain; charset=utf-8", "public, max-age=3600")
        if path == "/sitemap.xml":
            return self.send_body(200, sitemap_xml().encode(), "application/xml; charset=utf-8", "public, max-age=3600")
        return self.serve_static(path, url.query)

    def redirect(self, location):
        self.send_response(301)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def handle_api(self, method, path, query):
        if path == "/api/billing/webhook" and method == "POST":
            try:
                status, payload = handle_webhook(self.read_raw(MAX_BODY), self.headers.get("X-Razorpay-Signature"))
            except Exception:
                traceback.print_exc()
                status, payload = 500, {"error": "webhook failed"}
            return self.send_json(status, payload)
        path_known = False
        for m, rx, fn, access, max_body in COMPILED:
            match = rx.match(path)
            if not match:
                continue
            path_known = True
            if m != method:
                continue
            # A custom header forces a CORS preflight, which we never grant -> blocks cross-site forgery.
            if method != "GET" and self.headers.get("X-RF") != "1":
                return self.send_json(403, {"error": "Forbidden"})
            try:
                body = self.read_json(max_body) if method in ("POST", "PUT") else {}
                with db.connect() as conn:
                    user, token = self.session(conn)
                    if access and not user:
                        raise ApiError(401, "Please log in to continue")
                    if access == "admin" and not is_admin(user):
                        raise ApiError(403, "Admins only")
                    ctx = Ctx(self, conn, user, token, body, match.groups(), self.client_ip(), query)
                    status, payload = fn(ctx)
                return self.send_json(status, payload, ctx.cookies)
            except ApiError as e:
                return self.send_json(e.status, dict({"error": e.msg}, **e.extra))
            except (BrokenPipeError, ConnectionResetError):
                return None
            except Exception:
                traceback.print_exc()
                return self.send_json(500, {"error": "Something went wrong on the server"})
        if path_known:
            return self.send_json(405, {"error": "Method not allowed"})
        return self.send_json(404, {"error": "Not found"})

    def serve_static(self, path, query):
        if path in PAGES:
            rel = PAGES[path]
        elif re.match(r"^/r/[A-Za-z0-9_-]{6,32}$", path):
            rel = "view.html"
        else:
            rel = path.lstrip("/")
        full = os.path.realpath(os.path.join(config.PUBLIC_DIR, rel))
        status = 200
        if not full.startswith(config.PUBLIC_DIR + os.sep) or not os.path.isfile(full):
            full, status = os.path.join(config.PUBLIC_DIR, "404.html"), 404
        with open(full, "rb") as f:
            body = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        extra = []
        if ctype == "text/html":
            body = render_html(body, path)
            cache = "no-cache"
            if path not in PUBLIC_PAGES or status == 404:
                extra.append(("X-Robots-Tag", "noindex, nofollow"))
        elif "v=" in query:
            cache = "public, max-age=31536000, immutable"
        else:
            cache = "public, max-age=3600"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "application/manifest+json"):
            ctype += "; charset=utf-8"
        self.send_body(status, body, ctype, cache, extra)


def main():
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    db.init()
    url = f"http://{'localhost' if config.HOST in ('127.0.0.1', '0.0.0.0') else config.HOST}:{config.PORT}"
    try:
        httpd = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    except OSError:
        print(f"\n  Port {config.PORT} is already in use - ResumeForge Pro is probably already running.")
        print(f"  Opening {url} ...\n")
        webbrowser.open(url)
        return
    httpd.daemon_threads = True
    st = ai.status()
    print(f"\n  {config.SITE_NAME} v{APP_VERSION} is running at {url}")
    print(f"  Public URL : {config.APP_URL}")
    print(f"  Database   : {config.DB_PATH}")
    print(f"  AI         : {'ON (' + st['model'] + ')' if st['enabled'] else 'off - ' + st['reason']}")
    print(f"  Payments   : {('Razorpay TEST mode' if billing.test_mode() else 'Razorpay LIVE') if billing.enabled() else 'off - set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET'}")
    print(f"  Email      : {'SMTP ' + config.SMTP_HOST if config.EMAIL_ENABLED else 'off - password-reset links are printed in this window'}")
    print(f"  Admins     : {', '.join(sorted(config.ADMIN_EMAILS)) or 'none - set ADMIN_EMAILS'}")
    print("  Press Ctrl+C to stop.\n")
    if "--open" in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
