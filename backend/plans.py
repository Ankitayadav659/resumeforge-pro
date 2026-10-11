"""
Subscription plans and limits.

Pro is sold as prepaid passes (1 / 3 / 12 months) paid once via Razorpay — no
auto-debit mandates, which keeps checkout simple for Indian cards and UPI.
Buying again while Pro is active extends the expiry date.

Prices are in paise (₹1 = 100 paise) and can be overridden with environment
variables, e.g. PRICE_PRO_1M=24900.
"""
import os

from .db import now_ms

DAY_MS = 24 * 3600 * 1000


def _price(env, default):
    try:
        return int(os.environ.get(env, default))
    except ValueError:
        return default


LIMITS = {
    "free": {"resumes": _price("FREE_RESUMES", 3), "ai_daily": _price("FREE_AI_DAILY", 3), "versions": 10, "branding": True},
    "pro": {"resumes": _price("PRO_RESUMES", 50), "ai_daily": _price("PRO_AI_DAILY", 60), "versions": 40, "branding": False},
}

PASSES = {
    "pro_1m": {"label": "Pro — 1 month", "months": 1, "days": 31, "amount": _price("PRICE_PRO_1M", 19900)},
    "pro_3m": {"label": "Pro — 3 months", "months": 3, "days": 92, "amount": _price("PRICE_PRO_3M", 44900)},
    "pro_12m": {"label": "Pro — 12 months", "months": 12, "days": 366, "amount": _price("PRICE_PRO_12M", 119900)},
}
CURRENCY = "INR"


def effective_plan(user):
    """'pro' while a paid pass is active, otherwise 'free'."""
    try:
        if user["plan"] == "pro" and (user["plan_expires_at"] or 0) > now_ms():
            return "pro"
    except (IndexError, KeyError):
        pass
    return "free"


def limits_for(user):
    return LIMITS[effective_plan(user)]


def public_plans():
    return {
        "currency": CURRENCY,
        "limits": LIMITS,
        "passes": [
            {"code": code, "label": p["label"], "months": p["months"], "amount": p["amount"],
             "per_month": round(p["amount"] / p["months"])}
            for code, p in PASSES.items()
        ],
    }


def extend(conn, user_id, days):
    """Adds `days` of Pro, starting from the current expiry if still active."""
    row = conn.execute("SELECT plan, plan_expires_at FROM users WHERE id = ?", (user_id,)).fetchone()
    t = now_ms()
    start = row["plan_expires_at"] if row and row["plan"] == "pro" and (row["plan_expires_at"] or 0) > t else t
    expires = start + days * DAY_MS
    conn.execute("UPDATE users SET plan = 'pro', plan_expires_at = ? WHERE id = ?", (expires, user_id))
    return expires
