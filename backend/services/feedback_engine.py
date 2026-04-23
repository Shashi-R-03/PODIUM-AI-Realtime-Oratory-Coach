"""
Feedback Engine — Rule-based coaching logic.
Receives current metrics snapshot and returns a feedback message if a rule fires.
Rules have cooldown tracked externally (per WebSocket session).
"""

from dataclasses import dataclass
from typing import Callable, Optional
import time


@dataclass
class Rule:
    id: str
    type: str          # positive | warning | info
    icon: str
    cooldown_s: float  # seconds between repeats
    condition: Callable
    message: Callable  # callable(audio, video) -> str


RULES: list[Rule] = [
    Rule("too_fast", "warning", "⚡", 10,
         lambda a, v: a["wpm"] > 170,
         lambda a, v: f"Speaking too fast at {a['wpm']} WPM. Aim for 120–155 WPM for clarity."),

    Rule("too_slow", "warning", "🐢", 10,
         lambda a, v: 0 < a["wpm"] < 95,
         lambda a, v: f"Pace is slow at {a['wpm']} WPM. Pick up energy to keep the audience engaged."),

    Rule("good_pace", "positive", "✓", 20,
         lambda a, v: 115 <= a["wpm"] <= 158,
         lambda a, v: f"Great pace at {a['wpm']} WPM — ideal for clear communication."),

    Rule("low_vol", "warning", "🔈", 10,
         lambda a, v: a["speaking"] and a["volume"] < 16,
         lambda a, v: "Your voice is too quiet. Project from your diaphragm with more confidence."),

    Rule("good_vol", "positive", "🎙️", 25,
         lambda a, v: a["speaking"] and 22 <= a["volume"] <= 62,
         lambda a, v: "Strong vocal projection! You sound confident and clear."),

    Rule("loud_vol", "warning", "📢", 12,
         lambda a, v: a["speaking"] and a["volume"] > 72,
         lambda a, v: "Volume is very high. Moderate your voice to avoid seeming aggressive."),

    Rule("fillers_hi", "warning", "💬", 14,
         lambda a, v: a["fillers"] > 6,
         lambda a, v: f"{a['fillers']} filler words detected. Replace 'um' and 'uh' with a deliberate pause."),

    Rule("fillers_md", "info", "💬", 14,
         lambda a, v: 3 <= a["fillers"] <= 6,
         lambda a, v: "A few filler words detected. Pause intentionally instead of filling silence."),

    Rule("long_pause", "warning", "⏸️", 14,
         lambda a, v: a["pauses"] > 0 and a["avg_pause_ms"] > 3500,
         lambda a, v: "Pauses are quite long. Strategic pauses work best at 0.5–1 second."),

    Rule("good_pause", "positive", "⏸️", 25,
         lambda a, v: a["pauses"] > 2 and a["avg_pause_ms"] < 1600,
         lambda a, v: "Good use of pauses for emphasis — a hallmark of confident speakers."),

    Rule("pitch_flat", "info", "〰️", 16,
         lambda a, v: a["pitch"] < 22,
         lambda a, v: "Your voice sounds monotone. Vary your pitch to keep the audience engaged."),

    Rule("eye_low", "warning", "👁️", 12,
         lambda a, v: v["frames"] > 80 and v["eye"] < 45,
         lambda a, v: f"Eye contact at {v['eye']}%. Look directly at the camera to build connection."),

    Rule("eye_good", "positive", "👁️", 25,
         lambda a, v: v["frames"] > 80 and v["eye"] >= 72,
         lambda a, v: f"Excellent eye contact at {v['eye']}%! You're building real audience connection."),

    Rule("no_gesture", "info", "🤲", 18,
         lambda a, v: v["frames"] > 150 and v["gesture"] < 8,
         lambda a, v: "Use more hand gestures to emphasize key points and appear more dynamic."),

    Rule("good_gest", "positive", "🤲", 25,
         lambda a, v: 12 <= v["gesture"] <= 65,
         lambda a, v: "Good gesture use — your hands are making you look expressive and engaged."),

    Rule("posture_bad", "warning", "🧍", 14,
         lambda a, v: v["frames"] > 80 and v["posture"] < 42,
         lambda a, v: "Check your posture. Sit or stand tall with level shoulders to project authority."),

    Rule("posture_ok", "positive", "🧍", 28,
         lambda a, v: v["posture"] >= 82,
         lambda a, v: "Great posture! Upright, balanced stance conveys confidence and credibility."),

    Rule("head_move", "info", "↔️", 14,
         lambda a, v: v["frames"] > 80 and v["head"] < 38,
         lambda a, v: "Excessive head movement detected. A steadier head projects calm authority."),

    Rule("no_face", "warning", "📷", 10,
         lambda a, v: v["frames"] > 40 and not v["face_on"],
         lambda a, v: "Your face is not visible. Centre yourself in the camera frame."),

    Rule("great_all", "positive", "🌟", 30,
         lambda a, v: a["words"] > 80 and v["frames"] > 60,
         lambda a, v: "Outstanding performance! Keep this energy and confidence going!"),
]


def evaluate(audio: dict, video: dict, cooldowns: dict) -> Optional[dict]:
    """
    Evaluate all rules against current metrics.
    Returns first firing rule's feedback dict, or None.
    `cooldowns` is a mutable dict {rule_id: last_fired_timestamp} owned by caller.
    """
    now = time.time()
    for rule in RULES:
        last = cooldowns.get(rule.id, 0)
        if now - last < rule.cooldown_s:
            continue
        try:
            if rule.condition(audio, video):
                msg = rule.message(audio, video)
                cooldowns[rule.id] = now
                return {"text": msg, "type": rule.type, "icon": rule.icon}
        except Exception:
            continue
    return None


def compute_scores(audio: dict, video: dict) -> dict:
    """Compute voice, body, and overall scores (0-100)."""
    # ── Voice score ──
    vs = 55
    if audio.get("wpm", 0) > 0:
        wpm = audio["wpm"]
        pace = (100 if 115 <= wpm <= 158
                else max(0, (wpm / 115) * 100) if wpm < 115
                else max(0, 100 - ((wpm - 158) / 45) * 100))
        vol = audio.get("volume", 0)
        vol_s = (100 if 20 <= vol <= 65
                 else (vol / 20) * 100 if vol < 20
                 else max(0, 100 - ((vol - 65) / 30) * 30))
        fp = min(45, audio.get("fillers", 0) * 5)
        cl = audio.get("clarity", 70)
        pv = min(100, audio.get("pitch", 50) * 1.8)
        vs = round(pace * .28 + vol_s * .28 + cl * .24 + (100 - fp) * .12 + pv * .08)

    # ── Body score ──
    bs = 45
    frames = video.get("frames", 0)
    if frames > 30:
        bs = round(
            video.get("eye", 0) * .35 +
            min(video.get("gesture", 0) * 2, 100) * .20 +
            video.get("posture", 50) * .25 +
            video.get("head", 80) * .20
        )

    voice = max(0, min(100, vs))
    body = max(0, min(100, bs))
    overall = max(0, min(100, round(voice * .5 + body * .5)))
    return {"voice": voice, "body": body, "overall": overall}
