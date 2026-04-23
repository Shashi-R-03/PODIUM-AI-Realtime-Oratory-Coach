from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId
from datetime import datetime
from typing import List

from config import get_db
from routes.auth import current_user_id
from models.session import SessionCreate, SessionPublic

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _fmt(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


# ── Create session (returns session_id for WebSocket) ────
@router.post("/", status_code=201)
async def create_session(body: SessionCreate, uid: str = Depends(current_user_id)):
    db = get_db()
    doc = {
        "user_id": uid,
        "title": body.title,
        "started_at": datetime.utcnow(),
        "duration_s": 0,
        "audio": {},
        "video": {},
        "scores": {"voice": 0, "body": 0, "overall": 0},
        "feedback_log": [],
        "transcript_snippet": "",
    }
    result = await db.sessions.insert_one(doc)
    return {"session_id": str(result.inserted_id)}


# ── List user sessions ───────────────────────────────────
@router.get("/")
async def list_sessions(uid: str = Depends(current_user_id), limit: int = 30, skip: int = 0):
    db = get_db()
    cursor = db.sessions.find(
        {"user_id": uid, "duration_s": {"$gt": 0}},
        {"feedback_log": 0}  # exclude heavy field from list
    ).sort("started_at", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [_fmt(d) for d in docs]


# ── Get single session ───────────────────────────────────
@router.get("/{session_id}")
async def get_session(session_id: str, uid: str = Depends(current_user_id)):
    db = get_db()
    try:
        doc = await db.sessions.find_one({"_id": ObjectId(session_id), "user_id": uid})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")
    return _fmt(doc)


# ── Delete session ───────────────────────────────────────
@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str, uid: str = Depends(current_user_id)):
    db = get_db()
    result = await db.sessions.delete_one({"_id": ObjectId(session_id), "user_id": uid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
