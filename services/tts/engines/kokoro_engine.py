# Ported from Henty server.py load_kokoro/_gen_kokoro (lazy-load pattern kept, log noise dropped).

import numpy as np
import torch

from .base import TTSEngine

try:
    from kokoro import KPipeline

    HAS_KOKORO = True
except ImportError:
    HAS_KOKORO = False

KOKORO_SR = 24000
DEFAULT_VOICE = "af_heart"


class KokoroEngine(TTSEngine):
    name = "kokoro"

    def __init__(self, device: str = "cuda"):
        self.device = device
        self._pipeline = None

    def _load(self):
        if not HAS_KOKORO:
            raise RuntimeError("Kokoro not available. Install the 'kokoro' package.")
        if self._pipeline is None:
            # lang_code 'a' = American English.
            self._pipeline = KPipeline(lang_code="a", device=self.device)
        return self._pipeline

    def synthesize(self, text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0, **_) -> tuple[np.ndarray, int]:
        pipeline = self._load()
        segments: list[np.ndarray] = []
        for result in pipeline(text, voice=voice or DEFAULT_VOICE, speed=float(speed)):
            audio = getattr(result, "audio", None)
            if audio is None and isinstance(result, (list, tuple)):
                audio = result[-1]  # older API: (gs, ps, audio)
            if audio is None:
                continue
            if torch.is_tensor(audio):
                audio = audio.detach().cpu().numpy()
            segments.append(np.asarray(audio, dtype=np.float32).flatten())
        if not segments:
            raise RuntimeError("Kokoro produced no audio")
        wav = np.concatenate(segments) if len(segments) > 1 else segments[0]
        return wav, KOKORO_SR

    def unload(self) -> None:
        self._pipeline = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def is_loaded(self) -> bool:
        return self._pipeline is not None
