from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime


class AudioMetrics(BaseModel):
    wpm: int = 0
    volume: float = 0
    pitch: float = 0
    clarity: float = 0
    fillers: int = 0
    filler_map: Dict[str, int] = {}
    pauses: int = 0
    avg_pause_ms: int = 0
    words: int = 0


class VideoMetrics(BaseModel):
    eye_contact: int = 0
    gesture_freq: int = 0
    posture: int = 0
    head_stability: int = 0
    engagement: int = 0


class SessionScores(BaseModel):
    voice: int = 0
    body: int = 0
    overall: int = 0


class FeedbackMessage(BaseModel):
    text: str
    type: str           # positive | warning | info
    icon: str
    timestamp_s: int    # seconds into session


class SessionCreate(BaseModel):
    title: Optional[str] = None


class SessionUpdate(BaseModel):
    duration_s: int = 0
    audio: AudioMetrics = AudioMetrics()
    video: VideoMetrics = VideoMetrics()
    scores: SessionScores = SessionScores()
    feedback_log: List[FeedbackMessage] = []
    transcript_snippet: str = ""


class SessionPublic(BaseModel):
    id: str
    user_id: str
    title: Optional[str]
    started_at: datetime
    duration_s: int
    audio: AudioMetrics
    video: VideoMetrics
    scores: SessionScores
    feedback_log: List[FeedbackMessage]
    transcript_snippet: str
