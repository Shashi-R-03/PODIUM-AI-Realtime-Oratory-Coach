from fastapi import FastAPI, WebSocket, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from config import get_settings, get_client
from routes import auth, sessions, analytics, reports
from routes.auth import current_user_id
from ws.coach import coach_ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure MongoDB indexes
    from config import get_db
    db = get_db()
    await db.users.create_index("email", unique=True)
    await db.sessions.create_index("user_id")
    await db.sessions.create_index([("user_id", 1), ("started_at", -1)])

    # OTP collection: auto-expire documents 10 minutes after creation
    await db.otps.create_index("created_at", expireAfterSeconds=600)
    # Also index by email+purpose for fast lookup
    await db.otps.create_index([("email", 1), ("purpose", 1)])

    print("✅  Podium AI backend started")
    yield
    # Shutdown
    get_client().close()
    print("👋  Podium AI backend stopped")


app = FastAPI(
    title="Podium AI API",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5500", "http://127.0.0.1:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── REST routes ───────────────────────────────────────
app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(analytics.router)
app.include_router(reports.router)


# ── WebSocket ─────────────────────────────────────────
@app.websocket("/ws/coach/{session_id}")
async def ws_coach(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
):
    """
    WebSocket coaching endpoint.
    Token is passed as query param: ws://host/ws/coach/{id}?token=JWT
    """
    from jose import jwt, JWTError
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
        uid = payload.get("sub")
        if not uid:
            await websocket.close(code=4001)
            return
    except JWTError:
        await websocket.close(code=4001)
        return

    await coach_ws(websocket, session_id, uid)


# ── Health check ──────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "Podium AI"}
