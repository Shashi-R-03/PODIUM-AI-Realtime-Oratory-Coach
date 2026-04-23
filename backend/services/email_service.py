"""
Email Service — OTP generation + sending via SMTP.
Uses asyncio thread executor so no extra async library is needed.
Configure SMTP settings in .env (see config.py).
"""

import smtplib
import secrets
import asyncio
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def generate_otp() -> str:
    """Return a 6-digit OTP string, never less than 100000."""
    return str(secrets.randbelow(900000) + 100000)


def _send_sync(smtp_host: str, smtp_port: int, smtp_user: str,
               smtp_pass: str, from_addr: str,
               to_email: str, subject: str, html: str):
    """Synchronous SMTP send — run in executor so it doesn't block the event loop."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_addr
    msg["To"]      = to_email
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as srv:
        srv.ehlo()
        srv.starttls()
        srv.login(smtp_user, smtp_pass)
        srv.sendmail(from_addr, to_email, msg.as_string())


async def send_otp_email(to_email: str, otp: str, purpose: str, name: str = ""):
    """
    Send an OTP email.
    purpose: "register" | "reset"
    Raises on SMTP error — let the caller handle it.
    """
    from config import get_settings
    s = get_settings()

    greeting = f"Hi {name}," if name else "Hi,"
    action   = (
        "complete your Podium AI account registration"
        if purpose == "register"
        else "reset your Podium AI password"
    )
    subject  = (
        "Podium AI — Your Verification Code"
        if purpose == "register"
        else "Podium AI — Password Reset Code"
    )

    html = f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#04080f;font-family:Arial,sans-serif">
  <div style="max-width:480px;margin:40px auto;background:#07101e;border:1px solid #162438;
              border-radius:12px;padding:36px">
    <div style="margin-bottom:24px">
      <span style="font-size:20px;font-weight:bold;color:#00d4ff;letter-spacing:2px">PODIUM AI</span>
      <div style="font-size:11px;color:#3a6580;letter-spacing:1px;margin-top:4px">REAL-TIME ORATORY COACH</div>
    </div>
    <p style="color:#d8ecff;margin:0 0 8px">{greeting}</p>
    <p style="color:#7a9aba;margin:0 0 28px">Use the code below to {action}:</p>
    <div style="background:#0b1628;border:1px solid #1a3048;border-radius:8px;
                padding:28px;text-align:center;margin-bottom:28px">
      <span style="font-size:40px;font-weight:bold;letter-spacing:16px;
                   color:#00d4ff;font-family:monospace">{otp}</span>
    </div>
    <p style="color:#7a9aba;font-size:13px;margin:0 0 8px">
      This code expires in <strong style="color:#d8ecff">10 minutes</strong>.
    </p>
    <p style="color:#7a9aba;font-size:13px;margin:0">Do not share this code with anyone.</p>
    <hr style="border:none;border-top:1px solid #162438;margin:28px 0">
    <p style="color:#3a5a75;font-size:11px;margin:0">
      If you did not request this, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
"""

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        _send_sync,
        s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_password,
        s.smtp_from, to_email, subject, html,
    )
