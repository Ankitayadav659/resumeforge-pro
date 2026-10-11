"""
Configuration, read from environment variables and an optional `.env` file
in the project root (KEY=value lines). Real environment variables win.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv(path):
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv(os.path.join(ROOT, ".env"))


def _bool(name, default=False):
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


PUBLIC_DIR = os.path.realpath(os.path.join(ROOT, "public"))
DB_PATH = os.environ.get("RESUMEFORGE_DB") or os.path.join(ROOT, "data", "resumeforge.db")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = _int("PORT", 8000)

# Public base URL, used in password-reset emails. Defaults to the local address.
APP_URL = (os.environ.get("APP_URL") or f"http://localhost:{PORT}").rstrip("/")

# Set COOKIE_SECURE=1 when the site is served over HTTPS (required in production).
COOKIE_SECURE = _bool("COOKIE_SECURE", APP_URL.startswith("https://"))
# Set TRUST_PROXY=1 only behind a reverse proxy (nginx, Caddy, Render) that sets X-Forwarded-For.
TRUST_PROXY = _bool("TRUST_PROXY", False)

# --- Brand / business ---
SITE_NAME = os.environ.get("SITE_NAME", "ResumeForge Pro")
SUPPORT_EMAIL = os.environ.get("SUPPORT_EMAIL", "")
BUSINESS_NAME = os.environ.get("BUSINESS_NAME", "") or SITE_NAME   # legal name shown in Terms / Refund policy
# Comma-separated emails that get the /admin panel
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}

# --- AI (Claude) ---  (daily AI limits per plan live in backend/plans.py)
AI_MODEL = os.environ.get("AI_MODEL", "claude-opus-5-5")
AI_TIMEOUT = _int("AI_TIMEOUT", 180)                 # seconds

# --- Email (SMTP) for password resets ---
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = _int("SMTP_PORT", 587)
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "") or SMTP_USER
SMTP_SSL = _bool("SMTP_SSL", SMTP_PORT == 465)

EMAIL_ENABLED = bool(SMTP_HOST and SMTP_FROM)
