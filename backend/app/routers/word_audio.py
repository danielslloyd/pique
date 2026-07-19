import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session

from ..db import get_session
from ..models import WordAudioCache
from ..services import tts_client
from ..services.storage import Storage, get_storage

router = APIRouter(prefix="/api/word-audio", tags=["word-audio"])

_WORD_RE = re.compile(r"^[\w'-]{1,40}$")
HELP_SPEED = 0.85  # slightly slow for clarity


def normalize_word(word: str) -> str | None:
    """Lowercase/strip a token; return None if it is not a single decodable word."""
    word = word.strip().lower()
    return word if _WORD_RE.match(word) else None


async def cache_word_audio(
    word: str, engine: str, voice: str, session: Session, storage: Storage
) -> str:
    """Cache-through single-word TTS. ``word`` must already be normalized.

    Returns the stored audio key. Raises ``tts_client.TTSUnavailable`` if the
    word is not cached and the TTS service cannot be reached.
    """
    cached = session.get(WordAudioCache, (word, engine, voice))
    if cached and storage.exists(cached.audio_path):
        return cached.audio_path

    result = await tts_client.synthesize(
        word, engine=engine, voice=voice, speed=HELP_SPEED, align=False
    )
    key = f"word_audio/{engine}_{voice}/{word}.wav"
    storage.save_bytes(result["audio"], key)
    if cached:
        cached.audio_path = key
    else:
        session.add(
            WordAudioCache(word=word, engine=engine, voice_id=voice, audio_path=key)
        )
    session.commit()
    return key


@router.get("/{word}")
async def get_word_audio(
    word: str,
    engine: str = "kokoro",
    voice: str = "af_heart",
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> FileResponse:
    normalized = normalize_word(word)
    if not normalized:
        raise HTTPException(400, "not a single word")

    try:
        key = await cache_word_audio(normalized, engine, voice, session, storage)
    except tts_client.TTSUnavailable as e:
        raise HTTPException(503, str(e)) from e

    return FileResponse(storage.path_for(key), media_type="audio/wav")
