from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class UserRegister(BaseModel):
    name:     str      = Field(..., min_length=2, max_length=60)
    email:    EmailStr
    password: str      = Field(..., min_length=6)
    otp:      str      = Field(..., min_length=6, max_length=6)  # NEW: required for email-verified signup


class UserLogin(BaseModel):
    email:    EmailStr
    password: str


class UserPublic(BaseModel):
    id:              str
    name:            str
    email:           str
    created_at:      datetime
    total_sessions:  int = 0
    best_score:      int = 0
    total_words:     int = 0


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user:         UserPublic
