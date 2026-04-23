"""
WebSocket Coach Handler
Receives real-time metric frames from the browser,
runs feedback engine, persists data, returns coaching messages.
"""

import json
import time
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect
from bson import ObjectId

from config import get_db
from services.feedback_engine import evaluate, compute_scores


async def coach_ws(websocket: WebSocket, session_id: str, user_id: str):
    await websocket.accept()
    db = get_db()

    # Per-session state
    cooldowns: dict = {}
    feedback_log: list = []
    latest_audio: dict = {}
    latest_video: dict = {}
    session_start = time.time()

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type")

            # ── METRICS frame ─────────────────────────────
            if mtype == "metrics":
                audio = msg.get("audio", {})
                video = msg.get("video", {})
                latest_audio = audio
                latest_video = video

                # Compute scores
                scores = compute_scores(audio, video)

                # Evaluate feedback rules
                fb = evaluate(audio, video, cooldowns)
                response: dict = {"type": "scores", "scores": scores}

                if fb:
                    elapsed = int(time.time() - session_start)
                    fb["timestamp_s"] = elapsed
                    feedback_log.append(fb)
                    response["feedback"] = fb

                await websocket.send_text(json.dumps(response))

            # ── END session ───────────────────────────────
            elif mtype == "end":
                payload = msg.get("data", {})
                elapsed = int(time.time() - session_start)
                scores = compute_scores(latest_audio, latest_video)

                update = {
                    "duration_s": elapsed,
                    "audio": {
                        "wpm": latest_audio.get("wpm", 0),
                        "volume": latest_audio.get("volume", 0),
                        "pitch": latest_audio.get("pitch", 0),
                        "clarity": latest_audio.get("clarity", 0),
                        "fillers": latest_audio.get("fillers", 0),
                        "filler_map": latest_audio.get("filler_map", {}),
                        "pauses": latest_audio.get("pauses", 0),
                        "avg_pause_ms": latest_audio.get("avg_pause_ms", 0),
                        "words": latest_audio.get("words", 0),
                    },
                    "video": {
                        "eye_contact": latest_video.get("eye", 0),
                        "gesture_freq": latest_video.get("gesture", 0),
                        "posture": latest_video.get("posture", 0),
                        "head_stability": latest_video.get("head", 0),
                        "engagement": latest_video.get("engage", 0),
                    },
                    "scores": scores,
                    "feedback_log": feedback_log,
                    "transcript_snippet": payload.get("transcript", "")[-600:],
                }

                # Persist to MongoDB
                try:
                    sid = ObjectId(session_id)
                    await db.sessions.update_one(
                        {"_id": sid, "user_id": user_id},
                        {"$set": update}
                    )
                    # Update user stats
                    await db.users.update_one(
                        {"_id": ObjectId(user_id)},
                        {
                            "$inc": {
                                "total_sessions": 1,
                                "total_words": latest_audio.get("words", 0),
                            },
                            "$max": {"best_score": scores["overall"]},
                        }
                    )
                except Exception as e:
                    print(f"[WS] DB error: {e}")

                await websocket.send_text(json.dumps({
                    "type": "ended",
                    "scores": scores,
                    "session_id": session_id,
                }))
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
