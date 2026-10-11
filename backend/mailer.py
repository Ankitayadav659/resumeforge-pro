"""Outgoing email. Uses SMTP when configured; otherwise prints the message to the server console."""
import smtplib
import ssl
import sys
import threading
from email.message import EmailMessage
from html import escape as html_escape

from . import config


def _send_smtp(msg):
    try:
        if config.SMTP_SSL:
            with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, context=ssl.create_default_context(), timeout=20) as s:
                if config.SMTP_USER:
                    s.login(config.SMTP_USER, config.SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
                s.starttls(context=ssl.create_default_context())
                if config.SMTP_USER:
                    s.login(config.SMTP_USER, config.SMTP_PASSWORD)
                s.send_message(msg)
    except Exception as e:  # never crash a request because email failed
        sys.stderr.write(f"[mail] Failed to send email to {msg['To']}: {e}\n")


def send(to, subject, text, html=None):
    if not config.EMAIL_ENABLED:
        sys.stdout.write(
            "\n" + "=" * 70 + "\n"
            f"  EMAIL (SMTP not configured - shown here instead)\n  To: {to}\n  Subject: {subject}\n\n"
            + "\n".join("  " + line for line in text.splitlines()) + "\n" + "=" * 70 + "\n\n"
        )
        sys.stdout.flush()
        return
    msg = EmailMessage()
    msg["From"] = f"ResumeForge Pro <{config.SMTP_FROM}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    threading.Thread(target=_send_smtp, args=(msg,), daemon=True).start()


def send_password_reset(to, name, link):
    first = (name or "there").split()[0]
    first_html, link_html = html_escape(first), html_escape(link)
    text = (
        f"Hi {first},\n\n"
        "We received a request to reset your ResumeForge Pro password.\n"
        f"Open this link to choose a new password (valid for 30 minutes):\n\n{link}\n\n"
        "If you did not ask for this, you can ignore this email - your password will not change.\n\n"
        "ResumeForge Pro"
    )
    html = f"""<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
  <h2 style="color:#2b4fd8">Reset your password</h2>
  <p>Hi {first_html},</p>
  <p>We received a request to reset your ResumeForge Pro password. This link is valid for 30 minutes.</p>
  <p style="margin:28px 0"><a href="{link_html}"style="background:#2b4fd8;color:#fff;padding:12px 22px;border-radius:9px;text-decoration:none;font-weight:600">Choose a new password</a></p>
  <p style="color:#64748b;font-size:13px">If you did not ask for this, ignore this email — your password will not change.</p>
</div>"""
    send(to, "Reset your ResumeForge Pro password", text, html)
