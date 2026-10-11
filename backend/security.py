"""Password hashing, token helpers and in-memory rate limiting."""
import hashlib
import hmac
import secrets
import threading
import time

PBKDF2_ROUNDS = 310_000
COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
    "qwertyuiop", "iloveyou", "11111111", "abcd1234", "admin123", "welcome1", "india@123",
}


def hash_password(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(pw, stored):
    try:
        _algo, rounds, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def password_problem(pw):
    """Returns an error message, or None if the password is acceptable."""
    if len(pw) < 8 or len(pw) > 128:
        return "Password must be 8–128 characters"
    if pw.lower() in COMMON_PASSWORDS:
        return "That password is too common — choose another"
    return None


def new_token():
    return secrets.token_urlsafe(32)


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class RateLimiter:
    """Allows `limit` events per key inside a sliding `window` (seconds)."""

    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.events = {}
        self.lock = threading.Lock()

    def _recent(self, key):
        cutoff = time.time() - self.window
        stamps = [t for t in self.events.get(key, []) if t > cutoff]
        self.events[key] = stamps
        return stamps

    def blocked(self, key):
        with self.lock:
            return len(self._recent(key)) >= self.limit

    def hit(self, key):
        with self.lock:
            self._recent(key).append(time.time())

    def reset(self, key):
        with self.lock:
            self.events.pop(key, None)


login_limiter = RateLimiter(limit=8, window=300)      # failed logins per (ip, email)
forgot_limiter = RateLimiter(limit=5, window=3600)    # reset emails per ip
signup_limiter = RateLimiter(limit=10, window=3600)   # new accounts per ip
