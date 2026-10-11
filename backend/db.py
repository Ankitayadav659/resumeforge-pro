"""SQLite storage: schema, migrations and connection helper."""
import os
import sqlite3
import time
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS resumes (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL DEFAULT 'experienced',
  data         TEXT NOT NULL,
  share_slug   TEXT UNIQUE,
  share_views  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS resume_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resume_id   TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  data        TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT 'autosave',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'razorpay',
  order_id     TEXT NOT NULL UNIQUE,
  payment_id   TEXT UNIQUE,
  plan_code    TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'created',
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  topic       TEXT NOT NULL,
  message     TEXT NOT NULL,
  user_id     INTEGER,
  created_at  INTEGER NOT NULL,
  handled     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_resume ON resume_versions(resume_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at);
"""


def now_ms():
    return int(time.time() * 1000)


def init():
    os.makedirs(os.path.dirname(os.path.abspath(config.DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        _migrate(conn)
        t = now_ms()
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (t,))
        conn.execute("DELETE FROM password_resets WHERE expires_at < ?", (t,))
        conn.commit()
    finally:
        conn.close()


def _migrate(conn):
    """Adds columns introduced after the first release (safe to run repeatedly)."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
    for name, ddl in (
        ("plan", "ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'"),
        ("plan_expires_at", "ALTER TABLE users ADD COLUMN plan_expires_at INTEGER"),
        ("last_login_at", "ALTER TABLE users ADD COLUMN last_login_at INTEGER"),
    ):
        if name not in cols:
            conn.execute(ddl)


@contextmanager
def connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
