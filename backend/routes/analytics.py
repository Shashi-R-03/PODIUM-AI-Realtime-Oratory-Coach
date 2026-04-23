from fastapi import APIRouter, Depends
from config import get_db
from routes.auth import current_user_id

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
async def overview(uid: str = Depends(current_user_id)):
    """Stats cards + trend data for the dashboard."""
    db = get_db()

    # All completed sessions
    cursor = db.sessions.find(
        {"user_id": uid, "duration_s": {"$gt": 0}},
        {"scores": 1, "audio": 1, "video": 1, "started_at": 1, "duration_s": 1}
    ).sort("started_at", 1)
    sessions = await cursor.to_list(length=200)

    if not sessions:
        return {
            "total_sessions": 0,
            "total_words": 0,
            "total_duration_s": 0,
            "best_score": 0,
            "avg_score": 0,
            "trend": [],
            "category_avgs": {},
            "filler_totals": {},
        }

    total_sessions = len(sessions)
    total_words = sum(s.get("audio", {}).get("words", 0) for s in sessions)
    total_duration = sum(s.get("duration_s", 0) for s in sessions)
    scores_list = [s.get("scores", {}).get("overall", 0) for s in sessions]
    best_score = max(scores_list)
    avg_score = round(sum(scores_list) / len(scores_list))

    # Trend: last 20 sessions score + date
    trend = []
    for s in sessions[-20:]:
        trend.append({
            "date": s["started_at"].strftime("%b %d"),
            "overall": s.get("scores", {}).get("overall", 0),
            "voice": s.get("scores", {}).get("voice", 0),
            "body": s.get("scores", {}).get("body", 0),
        })

    # Category averages
    def avg_field(key_path: list):
        vals = []
        for s in sessions:
            d = s
            for k in key_path:
                d = d.get(k, {}) if isinstance(d, dict) else {}
            if isinstance(d, (int, float)):
                vals.append(d)
        return round(sum(vals) / len(vals)) if vals else 0

    category_avgs = {
        "wpm": avg_field(["audio", "wpm"]),
        "volume": avg_field(["audio", "volume"]),
        "clarity": avg_field(["audio", "clarity"]),
        "eye_contact": avg_field(["video", "eye_contact"]),
        "gesture_freq": avg_field(["video", "gesture_freq"]),
        "posture": avg_field(["video", "posture"]),
        "head_stability": avg_field(["video", "head_stability"]),
    }

    # Aggregate filler words across all sessions
    filler_totals: dict = {}
    for s in sessions:
        fm = s.get("audio", {}).get("filler_map", {})
        for word, count in fm.items():
            filler_totals[word] = filler_totals.get(word, 0) + count

    return {
        "total_sessions": total_sessions,
        "total_words": total_words,
        "total_duration_s": total_duration,
        "best_score": best_score,
        "avg_score": avg_score,
        "trend": trend,
        "category_avgs": category_avgs,
        "filler_totals": filler_totals,
    }
