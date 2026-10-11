"""
End-to-end tests for ResumeForge Pro (standard library only).

Run from the project folder:   python -m unittest discover -s tests -v

Starts the real server on a random port with a throwaway database. Razorpay is
simulated: orders are created locally and signatures are computed with a test
secret, so no network or real money is involved.
"""
import gzip
import hashlib
import html as html_lib
import hmac
import http.cookiejar
import json
import os
import re
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import xml.dom.minidom

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="rf-test-")
os.environ.update({
    "RESUMEFORGE_DB": os.path.join(TMP, "test.db"),
    "APP_URL": "https://resume.example.com",
    "COOKIE_SECURE": "0",   # the test client talks plain HTTP
    "ADMIN_EMAILS": "admin@example.com",
    "SUPPORT_EMAIL": "support@example.com",
    "RAZORPAY_KEY_ID": "rzp_test_dummy",
    "RAZORPAY_KEY_SECRET": "test_secret_value",
    "RAZORPAY_WEBHOOK_SECRET": "webhook_secret_value",
    "ANTHROPIC_API_KEY": "",
    "SMTP_HOST": "",
})
os.environ.pop("ANTHROPIC_API_KEY")
sys.path.insert(0, ROOT)

import mimetypes  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

import server  # noqa: E402
from backend import billing, db  # noqa: E402

_order_seq = [0]


def fake_create_order(amount, currency, receipt, notes):
    _order_seq[0] += 1
    return {"id": f"order_TEST{_order_seq[0]:06d}", "amount": amount, "currency": currency}


billing.create_order = fake_create_order
server.billing.create_order = fake_create_order


def sign(secret, msg):
    return hmac.new(secret.encode(), msg if isinstance(msg, bytes) else msg.encode(), hashlib.sha256).hexdigest()


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def req(self, method, path, body=None, headers=None, raw=None, csrf=True):
        h = {"Accept-Encoding": "identity"}
        if csrf and method != "GET":
            h["X-RF"] = "1"
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        r = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with self.opener.open(r, timeout=20) as resp:
                return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def json(self, method, path, body=None, **kw):
        status, _h, data = self.req(method, path, body, **kw)
        return status, (json.loads(data) if data else None)


class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        mimetypes.add_type("application/javascript", ".js")
        mimetypes.add_type("text/css", ".css")
        mimetypes.add_type("image/svg+xml", ".svg")
        mimetypes.add_type("application/manifest+json", ".webmanifest")
        db.init()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.httpd.daemon_threads = True
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def signup(self, email, name="Test User"):
        c = Client(self.base)
        s, body = c.json("POST", "/api/auth/signup", {"name": name, "email": email, "password": "Str0ng!pass-" + email[:3]})
        self.assertEqual(s, 201, body)
        return c

    # ------------------------------------------------------------------ pages & SEO
    def test_public_pages_have_seo_basics(self):
        c = Client(self.base)
        for path in server.PUBLIC_PAGES:
            with self.subTest(path=path):
                s, h, body = c.req("GET", path)
                self.assertEqual(s, 200)
                html = body.decode()
                self.assertNotIn("{{", html, "unfilled placeholder")
                self.assertEqual(len(re.findall(r"<h1[\s>]", html)), 1, "exactly one h1")
                title = re.search(r"<title>([^<]*)</title>", html)
                self.assertTrue(title and 10 <= len(title.group(1).replace("&amp;", "&")) <= 70, f"title length: {title and title.group(1)}")
                desc = re.search(r'<meta name="description" content="([^"]*)"', html)
                dlen = len(html_lib.unescape(desc.group(1))) if desc else 0
                self.assertTrue(70 <= dlen <= 160, f"description length {dlen}")
                self.assertTrue(f'<link rel="canonical" href="https://resume.example.com{path}"' in html, "canonical")
                self.assertIsNone(h.get("X-Robots-Tag"))
                for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
                    json.loads(block)  # must be valid JSON
                faqs = re.findall(r"<details class=\"faq\"><summary>(.*?)</summary>", html)
                if faqs:
                    self.assertIn('"FAQPage"', html)
                    for q in faqs:
                        plain = re.sub(r"<[^>]+>", "", q).replace("&amp;", "&")
                        self.assertIn(json.dumps(plain)[1:-1], html, f"FAQ JSON-LD missing: {plain}")

    def test_app_pages_are_noindex(self):
        c = Client(self.base)
        for path in server.APP_PAGES:
            s, h, _ = c.req("GET", path)
            self.assertEqual(s, 200, path)
            self.assertIn("noindex", h.get("X-Robots-Tag", ""), path)

    def test_robots_and_sitemap(self):
        c = Client(self.base)
        s, _h, body = c.req("GET", "/robots.txt")
        self.assertEqual(s, 200)
        self.assertIn("Sitemap: https://resume.example.com/sitemap.xml", body.decode())
        self.assertIn("Disallow: /dashboard", body.decode())
        s, _h, body = c.req("GET", "/sitemap.xml")
        self.assertEqual(s, 200)
        doc = xml.dom.minidom.parseString(body)
        locs = [n.firstChild.data for n in doc.getElementsByTagName("loc")]
        self.assertEqual(len(locs), len(server.PUBLIC_PAGES))
        self.assertIn("https://resume.example.com/pricing", locs)
        self.assertFalse(any("/dashboard" in l for l in locs))

    def test_static_assets_404_traversal_and_gzip(self):
        c = Client(self.base)
        s, h, _ = c.req("GET", "/css/site.css?v=1")
        self.assertEqual(s, 200)
        self.assertIn("immutable", h["Cache-Control"])
        s, h, body = c.req("GET", "/js/app.js", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(h.get("Content-Encoding"), "gzip")
        self.assertIn(b"ResumeForge", gzip.decompress(body))
        for bad in ("/..%2fserver.py", "/../server.py", "/css/../../server.py", "/nope"):
            s, _h, _b = c.req("GET", bad)
            self.assertEqual(s, 404, bad)
        s, h, _ = c.req("GET", "/pricing/")
        self.assertEqual(s, 200)  # trailing slash redirected to the canonical page
        for img in ("/img/og-image.jpg", "/img/icon-512.png", "/favicon.ico", "/manifest.webmanifest"):
            self.assertEqual(c.req("GET", img)[0], 200, img)

    # ------------------------------------------------------------------ auth & security
    def test_auth_flow_and_csrf(self):
        c = Client(self.base)
        self.assertEqual(c.json("GET", "/api/auth/me")[0], 401)
        self.assertEqual(c.json("POST", "/api/auth/signup", {"name": "A", "email": "weak@example.com", "password": "password"})[0], 400)
        c = self.signup("auth@example.com")
        s, me = c.json("GET", "/api/auth/me")
        self.assertEqual((s, me["user"]["plan"]), (200, "free"))
        self.assertEqual(Client(self.base).json("POST", "/api/auth/signup", {"name": "B", "email": "auth@example.com", "password": "Another!pass1"})[0], 409)
        self.assertEqual(c.json("POST", "/api/resumes", {"data": {}}, csrf=False)[0], 403)
        self.assertEqual(Client(self.base).json("POST", "/api/auth/login", {"email": "auth@example.com", "password": "wrong-pass"})[0], 401)
        c.json("POST", "/api/auth/logout")
        self.assertEqual(c.json("GET", "/api/auth/me")[0], 401)

    def test_resume_isolation_between_users(self):
        a, b = self.signup("iso-a@example.com"), self.signup("iso-b@example.com")
        s, res = a.json("POST", "/api/resumes", {"name": "Mine", "data": {"mode": "fresher"}})
        rid = res["resume"]["id"]
        self.assertEqual(b.json("GET", f"/api/resumes/{rid}")[0], 404)
        self.assertEqual(b.json("PUT", f"/api/resumes/{rid}", {"name": "hacked"})[0], 404)
        self.assertEqual(b.json("DELETE", f"/api/resumes/{rid}")[0], 404)

    # ------------------------------------------------------------------ plans, billing, branding
    def test_free_limit_payment_and_pro(self):
        c = self.signup("buyer@example.com")
        ids = []
        for i in range(3):
            s, r = c.json("POST", "/api/resumes", {"name": f"R{i}", "data": {"mode": "experienced"}})
            self.assertEqual(s, 201)
            ids.append(r["resume"]["id"])
        s, r = c.json("POST", "/api/resumes", {"name": "R4", "data": {}})
        self.assertEqual(s, 402)
        self.assertTrue(r["upgrade"])

        # share link shows branding on Free
        _s, sh = c.json("POST", f"/api/resumes/{ids[0]}/share", {"enabled": True})
        self.assertTrue(Client(self.base).json("GET", f"/api/public/{sh['share_slug']}")[1]["resume"]["branding"])

        self.assertEqual(c.json("POST", "/api/billing/order", {"plan": "nope"})[0], 400)
        s, order = c.json("POST", "/api/billing/order", {"plan": "pro_3m"})
        self.assertEqual(s, 200)
        self.assertEqual(order["amount"], 44900)
        oid = order["order_id"]
        bad = {"razorpay_order_id": oid, "razorpay_payment_id": "pay_X", "razorpay_signature": "deadbeef"}
        self.assertEqual(c.json("POST", "/api/billing/verify", bad)[0], 400)
        good = dict(bad, razorpay_signature=sign("test_secret_value", f"{oid}|pay_X"))
        s, res = c.json("POST", "/api/billing/verify", good)
        self.assertEqual(s, 200)
        self.assertEqual(res["user"]["plan"], "pro")
        expires = res["user"]["plan_expires_at"]

        # webhook for the same order must not extend the pass twice
        event = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_X", "order_id": oid}}}}).encode()
        self.assertEqual(c.req("POST", "/api/billing/webhook", raw=event, headers={"X-Razorpay-Signature": "bad"}, csrf=False)[0], 400)
        self.assertEqual(c.req("POST", "/api/billing/webhook", raw=event, headers={"X-Razorpay-Signature": sign("webhook_secret_value", event)}, csrf=False)[0], 200)
        self.assertEqual(c.json("GET", "/api/auth/me")[1]["user"]["plan_expires_at"], expires)

        self.assertEqual(c.json("POST", "/api/resumes", {"name": "R4", "data": {}})[0], 201)
        self.assertFalse(Client(self.base).json("GET", f"/api/public/{sh['share_slug']}")[1]["resume"]["branding"])
        hist = c.json("GET", "/api/billing/history")[1]["payments"]
        self.assertEqual(len(hist), 1)
        self.assertEqual(hist[0]["amount"], 44900)

    def test_webhook_activates_when_browser_closed(self):
        c = self.signup("webhook@example.com")
        oid = c.json("POST", "/api/billing/order", {"plan": "pro_1m"})[1]["order_id"]
        event = json.dumps({"event": "order.paid", "payload": {"payment": {"entity": {"id": "pay_W", "order_id": oid}}}}).encode()
        s, _h, _b = c.req("POST", "/api/billing/webhook", raw=event, headers={"X-Razorpay-Signature": sign("webhook_secret_value", event)}, csrf=False)
        self.assertEqual(s, 200)
        self.assertEqual(c.json("GET", "/api/auth/me")[1]["user"]["plan"], "pro")

    # ------------------------------------------------------------------ admin, contact, AI, versions
    def test_admin_and_contact(self):
        user = self.signup("plain@example.com")
        self.assertEqual(user.json("GET", "/api/admin/stats")[0], 403)
        self.assertEqual(Client(self.base).json("POST", "/api/contact", {"name": "V", "email": "v@example.com", "message": "Hello there, I need help"})[0], 201)
        admin = self.signup("admin@example.com", "Admin")
        s, stats = admin.json("GET", "/api/admin/stats")
        self.assertEqual(s, 200)
        self.assertGreaterEqual(stats["messages_open"], 1)
        users = admin.json("GET", "/api/admin/users?q=plain")[1]["users"]
        self.assertEqual(len(users), 1)
        uid = users[0]["id"]
        self.assertEqual(admin.json("POST", f"/api/admin/users/{uid}/plan", {"action": "grant", "days": 10})[1]["user"]["plan"], "pro")
        self.assertEqual(admin.json("POST", f"/api/admin/users/{uid}/plan", {"action": "revoke"})[1]["user"]["plan"], "free")
        msgs = admin.json("GET", "/api/admin/messages")[1]["messages"]
        self.assertEqual(admin.json("POST", f"/api/admin/messages/{msgs[0]['id']}/done")[0], 200)

    def test_ai_unavailable_and_versions(self):
        c = self.signup("ai@example.com")
        rid = c.json("POST", "/api/resumes", {"name": "V", "data": {"mode": "fresher", "summary": "one"}})[1]["resume"]["id"]
        s, r = c.json("POST", "/api/ai/summary", {"resume": {"mode": "fresher"}})
        self.assertEqual(s, 503)
        c.json("PUT", f"/api/resumes/{rid}", {"data": {"mode": "fresher", "summary": "two"}})
        c.json("POST", f"/api/resumes/{rid}/versions", {"reason": "Sent to Google"})
        c.json("PUT", f"/api/resumes/{rid}", {"data": {"mode": "fresher", "summary": "three"}})
        versions = c.json("GET", f"/api/resumes/{rid}/versions")[1]["versions"]
        named = next(v for v in versions if v["reason"] == "Sent to Google")
        restored = c.json("POST", f"/api/resumes/{rid}/versions/{named['id']}/restore")[1]["resume"]
        self.assertEqual(restored["data"]["summary"], "two")

    def test_import_text_resume(self):
        c = self.signup("import@example.com")
        text = "ANITA DESAI\nMarketing Manager\nanita@example.com | +91 99887 66554 | Mumbai\n\nEXPERIENCE\nMarketing Manager | Unilever Lite   Mar 2020 - Present\n• Grew brand share by 4% in 2 years\n\nSKILLS\nSEO, Google Ads"
        s, r = c.json("POST", "/api/import", {"filename": "a.txt", "text": text})
        self.assertEqual(s, 200)
        self.assertEqual(r["data"]["personal"]["fullName"], "Anita Desai")
        self.assertTrue(r["data"]["experience"][0]["current"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
