# Pique TTS + alignment service (port 8100). Stateless: text in -> audio + word timings out.
# The backend owns all storage; this service only holds models.

import base64
from pathlib import Path

import torch
from fastapi import FastAPI, HTTPException, UploadFile
from pydantic import BaseModel

from align.mms_aligner import MMSAligner
from audio_utils import to_mono_float32, wav_bytes
from engines.chatterbox_engine import ChatterboxEngine
from engines.kokoro_engine import KokoroEngine

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
VOICES_DIR = Path(__file__).parent / "voices"
VOICES_DIR.mkdir(exist_ok=True)

# Chatterbox garbles very short inputs; wrap them in carrier text and trim via alignment.
# (Kokoro handles short input fine.) Values from Henty's validated config.
CARRIER_MAX_CHARS = 40
CARRIER_PRE = "Here is the next passage."
CARRIER_POST = "That is the end of it."

app = FastAPI(title="Pique TTS")

engines = {
    "kokoro": KokoroEngine(DEVICE),
    "chatterbox": ChatterboxEngine(DEVICE),
}
aligner = MMSAligner(DEVICE)


class SynthesizeRequest(BaseModel):
    text: str
    engine: str = "kokoro"
    voice: str = "af_heart"  # kokoro voice name; ignored by chatterbox
    ref_audio: str | None = None  # filename under voices/ (chatterbox cloning)
    speed: float = 1.0
    exaggeration: float = 0.6
    cfg_weight: float = 0.4
    align: bool = True


class WordSpanOut(BaseModel):
    word: str
    start_s: float
    end_s: float


class SynthesizeResponse(BaseModel):
    sample_rate: int
    duration_s: float
    words: list[WordSpanOut]
    audio_b64: str


@app.post("/synthesize", response_model=SynthesizeResponse)
def synthesize(req: SynthesizeRequest) -> SynthesizeResponse:
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    engine = engines.get(req.engine)
    if engine is None:
        raise HTTPException(400, f"unknown engine {req.engine!r}")

    ref_path = None
    if req.ref_audio:
        ref_path = VOICES_DIR / Path(req.ref_audio).name
        if not ref_path.exists():
            raise HTTPException(400, f"voice sample not found: {req.ref_audio}")

    use_carrier = req.engine == "chatterbox" and len(text) < CARRIER_MAX_CHARS

    target_words = aligner.normalize_words(text) if (req.align or use_carrier) else []
    if use_carrier and not target_words:
        use_carrier = False

    gen_text = f"{CARRIER_PRE} {text} {CARRIER_POST}".strip() if use_carrier else text
    wav, sr = engine.synthesize(
        gen_text,
        voice=req.voice,
        speed=req.speed,
        ref_audio=str(ref_path) if ref_path else None,
        exaggeration=req.exaggeration,
        cfg_weight=req.cfg_weight,
    )
    wav = to_mono_float32(wav)

    spans = []
    if use_carrier:
        try:
            wav, spans = aligner.trim_to_target(
                wav,
                sr,
                aligner.normalize_words(CARRIER_PRE),
                target_words,
                aligner.normalize_words(CARRIER_POST),
            )
        except Exception:
            # Regenerate without carrier rather than shipping padded audio.
            wav, sr = engine.synthesize(
                text,
                voice=req.voice,
                speed=req.speed,
                ref_audio=str(ref_path) if ref_path else None,
                exaggeration=req.exaggeration,
                cfg_weight=req.cfg_weight,
            )
            wav = to_mono_float32(wav)
            spans = aligner.align_words(wav, sr, target_words) if req.align else []
    elif req.align and target_words:
        spans = aligner.align_words(wav, sr, target_words)

    audio = wav_bytes(wav, sr)
    return SynthesizeResponse(
        sample_rate=sr,
        duration_s=round(len(wav) / sr, 3),
        words=[WordSpanOut(word=s.word, start_s=s.start_s, end_s=s.end_s) for s in spans],
        audio_b64=base64.b64encode(audio).decode(),
    )


@app.post("/voices")
async def upload_voice(file: UploadFile) -> dict:
    name = Path(file.filename or "voice.wav").name
    if not name.lower().endswith(".wav"):
        raise HTTPException(400, "voice samples must be .wav")
    (VOICES_DIR / name).write_bytes(await file.read())
    return {"saved": name}


@app.get("/voices")
def list_voices() -> dict:
    return {"voices": sorted(p.name for p in VOICES_DIR.glob("*.wav"))}


@app.post("/unload")
def unload() -> dict:
    for engine in engines.values():
        engine.unload()
    aligner.unload()
    return {"unloaded": True}


@app.get("/health")
def health() -> dict:
    vram_gb = None
    if torch.cuda.is_available():
        vram_gb = round(torch.cuda.memory_allocated(0) / (1024**3), 2)
    return {
        "device": DEVICE,
        "loaded": {name: engine.is_loaded() for name, engine in engines.items()}
        | {"aligner": aligner.is_loaded()},
        "vram_gb": vram_gb,
    }
