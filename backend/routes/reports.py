from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from bson import ObjectId

from config import get_db
from routes.auth import current_user_id, get_user_doc
from services.pdf_generator import generate_session_pdf

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/{session_id}/pdf")
async def download_pdf(session_id: str, uid: str = Depends(current_user_id)):
    db = get_db()
    try:
        doc = await db.sessions.find_one({"_id": ObjectId(session_id), "user_id": uid})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    user_doc = await get_user_doc(uid)
    pdf_bytes = generate_session_pdf(doc, user_doc.get("name", "User"))

    date_str = doc["started_at"].strftime("%Y%m%d")
    filename = f"podium-report-{date_str}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
