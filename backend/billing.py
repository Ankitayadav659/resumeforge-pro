"""
Razorpay payments (Orders API + Checkout + webhook), standard library only.

Flow:
 1. Browser asks /api/billing/order -> we create a Razorpay order server-side.
 2. Razorpay Checkout collects the payment (cards, UPI, netbanking, wallets).
 3. Browser posts the result to /api/billing/verify -> we verify the HMAC signature
    and activate Pro.
 4. Razorpay also calls /api/billing/webhook (payment.captured / order.paid) so the
    purchase is honoured even if the user closes the tab before step 3.
Activation is idempotent: a payment can only ever be applied once.
"""
import base64
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request

API = "https://api.razorpay.com/v1"


def key_id():
    return os.environ.get("RAZORPAY_KEY_ID", "").strip()


def _key_secret():
    return os.environ.get("RAZORPAY_KEY_SECRET", "").strip()


def _webhook_secret():
    return os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()


def enabled():
    return bool(key_id() and _key_secret())


def test_mode():
    return key_id().startswith("rzp_test_")


class BillingError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def create_order(amount, currency, receipt, notes):
    if not enabled():
        raise BillingError(503, "Online payments are not set up on this server yet.")
    body = json.dumps({"amount": amount, "currency": currency, "receipt": receipt[:40], "notes": notes}).encode()
    auth = base64.b64encode(f"{key_id()}:{_key_secret()}".encode()).decode()
    req = urllib.request.Request(f"{API}/orders", data=body, method="POST",
                                 headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode()).get("error", {}).get("description", "")
        except Exception:
            pass
        raise BillingError(502, f"Payment provider rejected the order. {detail}".strip())
    except (urllib.error.URLError, TimeoutError):
        raise BillingError(502, "Could not reach the payment provider. Please try again.")


def verify_checkout_signature(order_id, payment_id, signature):
    if not enabled():
        return False
    expected = hmac.new(_key_secret().encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, str(signature or ""))


def verify_webhook_signature(raw_body, signature):
    secret = _webhook_secret()
    if not secret:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, str(signature or ""))
