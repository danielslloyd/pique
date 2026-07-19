import base64

import httpx

from ..config import settings


class TTSUnavailable(Exception):
    pass


async def synthesize(
    text: str,
    engine: str = "kokoro",
    voice: str = "af_heart",
    ref_audio: str | None = None,
    speed: float = 1.0,
    align: bool = True,
) -> dict:
    """Call the TTS service. Returns {audio: bytes, sample_rate, duration_s, words: [...]}."""
    payload = {
        "text": text,
        "engine": engine,
        "voice": voice,
        "ref_audio": ref_audio,
        "speed": speed,
        "align": align,
    }
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(f"{settings.tts_url}/synthesize", json=payload)
    except httpx.ConnectError as e:
        raise TTSUnavailable(f"TTS service unreachable at {settings.tts_url}") from e
    if resp.status_code != 200:
        raise TTSUnavailable(f"TTS service error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return {
        "audio": base64.b64decode(data["audio_b64"]),
        "sample_rate": data["sample_rate"],
        "duration_s": data["duration_s"],
        "words": data["words"],
    }


async def unload() -> None:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.post(f"{settings.tts_url}/unload")
    except httpx.HTTPError:
        pass
