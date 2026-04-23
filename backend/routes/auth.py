from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta
from bson import ObjectId
from typing import Optional

from config import get_db, get_settings
from models.user import UserRegister, UserLogin, TokenResponse, UserPublic
from services.email_service import generate_otp, send_otp_email

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer()
pwd    = CryptContext(schemes=["bcrypt"], deprecated="auto")


def make_token(user_id: str) -> str:
    s   = get_settings()
    exp = datetime.utcnow() + timedelta(minutes=s.access_token_expire_minutes)
    return jwt.encode({"sub": user_id, "exp": exp}, s.jwt_secret, algorithm=s.jwt_algorithm)


async def current_user_id(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    s = get_settings()
    try:
        payload = jwt.decode(creds.credentials, s.jwt_secret, algorithms=[s.jwt_algorithm])
        uid = payload.get("sub")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid token")
        return uid
    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")


async def get_user_doc(user_id: str) -> dict:
    db  = get_db()
    doc = await db.users.find_one({"_id": ObjectId(user_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return doc


def _to_public(doc: dict) -> UserPublic:
    return UserPublic(
        id=str(doc["_id"]),
        name=doc["name"],
        email=doc["email"],
        created_at=doc["created_at"],
        total_sessions=doc.get("total_sessions", 0),
        best_score=doc.get("best_score", 0),
        total_words=doc.get("total_words", 0),
    )


# ── Send OTP ─────────────────────────────────────────
class SendOtpRequest:
    def __init__(self, email: str, purpose: str, name: str = ""):
        self.email   = email
        self.purpose = purpose
        self.name    = name

from pydantic import BaseModel, EmailStr

class SendOtpBody(BaseModel):
    email:   EmailStr
    purpose: str       # "register" | "reset"
    name:    Optional[str] = ""

class ResetPasswordBody(BaseModel):
    email:        EmailStr
    otp:          str
    new_password: str


@router.post("/send-otp", status_code=200)
async def send_otp(body: SendOtpBody):
    db = get_db()

    if body.purpose not in ("register", "reset"):
        raise HTTPException(status_code=400, detail="purpose must be 'register' or 'reset'")

    email = body.email.lower()

    # For reset: user must already exist
    if body.purpose == "reset":
        if not await db.users.find_one({"email": email}):
            # Don't reveal whether the email exists — generic message
            return {"message": "If that email is registered, a code has been sent."}

    # For register: email must NOT already be taken
    if body.purpose == "register":
        if await db.users.find_one({"email": email}):
            raise HTTPException(status_code=409, detail="Email already registered. Please sign in.")

    otp = generate_otp()

    # Upsert OTP (replace any previous OTP for this email+purpose)
    await db.otps.replace_one(
        {"email": email, "purpose": body.purpose},
        {
            "email":      email,
            "purpose":    body.purpose,
            "otp":        otp,
            "name":       body.name or "",
            "created_at": datetime.utcnow(),
        },
        upsert=True,
    )

    try:
        await send_otp_email(email, otp, body.purpose, body.name or "")
    except Exception as e:
        print(f"[EMAIL] Failed to send OTP to {email}: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email. Check SMTP settings in .env")

    return {"message": "Verification code sent. Check your inbox."}


# ── Register (now requires OTP) ───────────────────────
@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: UserRegister):
    db    = get_db()
    email = body.email.lower()

    # Verify OTP
    otp_doc = await db.otps.find_one({"email": email, "purpose": "register"})
    if not otp_doc:
        raise HTTPException(status_code=400, detail="No verification code found. Request a new one.")
    if otp_doc["otp"] != body.otp:
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")

    doc = {
        "name":          body.name.strip(),
        "email":         email,
        "password_hash": pwd.hash(body.password),
        "created_at":    datetime.utcnow(),
        "total_sessions": 0,
        "best_score":    0,
        "total_words":   0,
    }
    result = await db.users.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Delete used OTP
    await db.otps.delete_one({"email": email, "purpose": "register"})

    token = make_token(str(result.inserted_id))
    return TokenResponse(access_token=token, user=_to_public(doc))


# ── Login ────────────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin):
    db  = get_db()
    doc = await db.users.find_one({"email": body.email.lower()})
    if not doc or not pwd.verify(body.password, doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    token = make_token(str(doc["_id"]))
    return TokenResponse(access_token=token, user=_to_public(doc))


# ── Reset Password ───────────────────────────────────
@router.post("/reset-password", status_code=200)
async def reset_password(body: ResetPasswordBody):
    db    = get_db()
    email = body.email.lower()

    otp_doc = await db.otps.find_one({"email": email, "purpose": "reset"})
    if not otp_doc:
        raise HTTPException(status_code=400, detail="No reset code found. Request a new one.")
    if otp_doc["otp"] != body.otp:
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    result = await db.users.update_one(
        {"email": email},
        {"$set": {"password_hash": pwd.hash(body.new_password)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Account not found.")

    # Delete used OTP
    await db.otps.delete_one({"email": email, "purpose": "reset"})

    return {"message": "Password updated successfully. Please sign in."}


# ── Me ───────────────────────────────────────────────
@router.get("/me", response_model=UserPublic)
async def me(uid: str = Depends(current_user_id)):
    doc = await get_user_doc(uid)
    return _to_public(doc)
