"""
PDF Report Generator using fpdf2.
Generates a styled session performance report.
FIX: Added clean() to strip unicode chars unsupported by Helvetica (latin-1).
"""

from fpdf import FPDF
from datetime import datetime
import io


def clean(text) -> str:
    """Strip/replace unicode characters that latin-1 Helvetica cannot encode."""
    if not text:
        return ""
    return (str(text)
        .replace('\u2014', '-')    # em dash —
        .replace('\u2013', '-')    # en dash –
        .replace('\u2018', "'")    # left single quote '
        .replace('\u2019', "'")    # right single quote '
        .replace('\u201c', '"')    # left double quote "
        .replace('\u201d', '"')    # right double quote "
        .replace('\u2026', '...')  # ellipsis …
        .replace('\u00b7', '·')    # middle dot (keep as-is, latin-1 safe)
        .encode('latin-1', errors='replace').decode('latin-1')  # catch-all
    )


class PodiumPDF(FPDF):
    def header(self):
        self.set_fill_color(4, 8, 15)
        self.rect(0, 0, 210, 30, 'F')
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(0, 212, 255)
        self.set_xy(12, 8)
        self.cell(0, 10, "PODIUM AI  -  Session Report", ln=False)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(100, 140, 170)
        self.set_xy(12, 20)
        self.cell(0, 5, f"Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
        self.ln(12)

    def footer(self):
        self.set_y(-14)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(80, 110, 140)
        self.cell(0, 8, f"Podium AI  |  Page {self.page_no()}", align="C")


def _score_color(score: int) -> tuple:
    if score >= 75:
        return (0, 232, 122)
    if score >= 50:
        return (0, 212, 255)
    return (255, 107, 53)


def _bar(pdf: FPDF, label: str, value: int, max_val: int = 100):
    """Draw a labeled progress bar."""
    pct = min(value / max_val, 1.0)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(180, 210, 235)
    pdf.cell(52, 6, label, ln=False)
    # track bg
    x, y = pdf.get_x(), pdf.get_y()
    pdf.set_fill_color(20, 36, 56)
    pdf.rect(x, y + 1, 80, 4, 'F')
    # fill
    r, g, b = _score_color(int(pct * 100))
    pdf.set_fill_color(r, g, b)
    if pct > 0:
        pdf.rect(x, y + 1, 80 * pct, 4, 'F')
    # value text
    pdf.set_xy(x + 83, y)
    pdf.set_text_color(0, 212, 255)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(20, 6, str(value), ln=True)


def generate_session_pdf(session: dict, user_name: str) -> bytes:
    pdf = PodiumPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_page_background((7, 16, 30))  # dark bg

    # ── User + session meta ──────────────────────────────
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(216, 236, 255)
    pdf.cell(0, 8, clean(user_name), ln=True)

    started = session.get("started_at", "")
    if hasattr(started, "strftime"):
        date_str = started.strftime("%B %d, %Y  %H:%M")
    else:
        date_str = str(started)[:16].replace("T", "  ")

    dur = session.get("duration_s", 0)
    dur_str = f"{dur // 60}m {dur % 60}s"

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(100, 140, 170)
    pdf.cell(0, 6, f"Session  |  {date_str}  |  Duration: {dur_str}", ln=True)
    title = clean(session.get("title") or "Untitled Session")
    pdf.cell(0, 6, f"Title: {title}", ln=True)
    pdf.ln(4)

    # ── Overall scores ───────────────────────────────────
    pdf.set_fill_color(11, 22, 40)
    pdf.rect(10, pdf.get_y(), 190, 28, 'F')
    scores = session.get("scores", {})
    for label, key, x_off in [("VOICE", "voice", 10), ("BODY", "body", 76), ("OVERALL", "overall", 142)]:
        val = scores.get(key, 0)
        r, g, b = _score_color(val)
        pdf.set_xy(x_off + 10, pdf.get_y() + 4)
        pdf.set_font("Helvetica", "B", 22)
        pdf.set_text_color(r, g, b)
        pdf.cell(54, 12, str(val), align="C", ln=False)
        pdf.set_xy(x_off + 10, pdf.get_y() + 14)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(100, 140, 170)
        pdf.cell(54, 5, label, align="C", ln=False)
        if key != "overall":
            pdf.set_draw_color(22, 36, 56)
            pdf.line(x_off + 64, pdf.get_y() - 8, x_off + 64, pdf.get_y() + 18)
    pdf.ln(22)

    # ── Audio metrics ────────────────────────────────────
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(0, 212, 255)
    pdf.cell(0, 8, "  AUDIO ANALYSIS", ln=True)
    pdf.set_draw_color(22, 36, 56)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(3)

    audio = session.get("audio", {})
    _bar(pdf, "Speaking Rate (WPM)", min(audio.get("wpm", 0), 100))
    _bar(pdf, "Voice Volume",        min(int(audio.get("volume", 0)), 100))
    _bar(pdf, "Pitch Variation",     min(int(audio.get("pitch", 0)), 100))
    _bar(pdf, "Speech Clarity",      int(audio.get("clarity", 0)))

    pdf.ln(2)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(180, 210, 235)
    pdf.cell(52, 6, "Total Words:", ln=False)
    pdf.set_text_color(0, 212, 255)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 6, str(audio.get("words", 0)), ln=True)

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(180, 210, 235)
    pdf.cell(52, 6, "Filler Words:", ln=False)
    fmap = audio.get("filler_map", {})
    fstr = ", ".join(f"{k}x{v}" for k, v in fmap.items() if v > 0) or "None"
    pdf.set_text_color(255, 107, 53)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 6, f"{audio.get('fillers', 0)} total  ({fstr})", ln=True)

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(180, 210, 235)
    pdf.cell(52, 6, "Pauses:", ln=False)
    pdf.set_text_color(0, 212, 255)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 6, f"{audio.get('pauses', 0)}  (avg {audio.get('avg_pause_ms', 0)/1000:.1f}s)", ln=True)
    pdf.ln(3)

    # ── Video metrics ────────────────────────────────────
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(0, 212, 255)
    pdf.cell(0, 8, "  BODY LANGUAGE", ln=True)
    pdf.set_draw_color(22, 36, 56)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(3)

    video = session.get("video", {})
    _bar(pdf, "Eye Contact",       video.get("eye_contact", 0))
    _bar(pdf, "Gesture Frequency", video.get("gesture_freq", 0))
    _bar(pdf, "Posture Score",     video.get("posture", 0))
    _bar(pdf, "Head Stability",    video.get("head_stability", 0))
    _bar(pdf, "Engagement",        video.get("engagement", 0))
    pdf.ln(4)

    # ── Feedback log ─────────────────────────────────────
    feedback = session.get("feedback_log", [])
    if feedback:
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(0, 212, 255)
        pdf.cell(0, 8, "  COACHING FEEDBACK LOG", ln=True)
        pdf.set_draw_color(22, 36, 56)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(3)
        for fb in feedback[:18]:
            ts = fb.get("timestamp_s", 0)
            ts_str = f"{ts//60:02d}:{ts%60:02d}"
            ftype = fb.get("type", "info")
            if ftype == "positive":
                pdf.set_text_color(0, 232, 122)
            elif ftype == "warning":
                pdf.set_text_color(255, 107, 53)
            else:
                pdf.set_text_color(0, 212, 255)
            pdf.set_font("Helvetica", "", 8)
            text = clean(fb.get("text", ""))
            pdf.multi_cell(0, 5, f"  [{ts_str}]  {text}", ln=True)
        pdf.ln(2)

    # ── Transcript snippet ───────────────────────────────
    snip = clean(session.get("transcript_snippet", ""))
    if snip:
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(0, 212, 255)
        pdf.cell(0, 8, "  TRANSCRIPT SNIPPET", ln=True)
        pdf.set_draw_color(22, 36, 56)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(3)
        pdf.set_font("Helvetica", "I", 8)
        pdf.set_text_color(140, 175, 205)
        pdf.multi_cell(0, 5, snip[:800])

    buf = io.BytesIO()
    pdf.output(buf)
    return buf.getvalue()