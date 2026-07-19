# Ported from Henty server.py load_model/_gen_chatterbox/ensure_valid_wav_format,
# including the float32 guards for numpy<2.3 producing float64 tensors.

from pathlib import Path

import numpy as np
import torch

from .base import TTSEngine

try:
    from chatterbox.tts import ChatterboxTTS

    HAS_CHATTERBOX = True
except ImportError:
    HAS_CHATTERBOX = False


def ensure_valid_wav_format(wav_path: str) -> bool:
    """Validate (and if needed rewrite) a reference wav so Chatterbox accepts it:
    mono/stereo PCM, reasonable sample rate. Ported and simplified from Henty."""
    try:
        import soundfile as sf

        data, sr = sf.read(wav_path, dtype="float32")
        if data.ndim > 1:
            data = data[:, 0]
        if sr < 16000:
            return False
        # Rewrite as clean 16-bit PCM mono to eliminate odd encodings.
        sf.write(wav_path, data, sr, subtype="PCM_16")
        return True
    except Exception:
        return False


class ChatterboxEngine(TTSEngine):
    name = "chatterbox"

    def __init__(self, device: str = "cuda"):
        self.device = device
        self._model = None

    def _load(self):
        if not HAS_CHATTERBOX:
            raise RuntimeError("chatterbox-tts not installed")
        if self._model is None:
            self._model = ChatterboxTTS.from_pretrained(device=self.device)
        return self._model

    def synthesize(
        self,
        text: str,
        ref_audio: str | None = None,
        exaggeration: float = 0.6,
        cfg_weight: float = 0.4,
        language_id: str = "en",
        **_,
    ) -> tuple[np.ndarray, int]:
        model = self._load()

        gen_params: dict = {
            "exaggeration": torch.tensor(exaggeration, dtype=torch.float32).item(),
            "cfg_weight": torch.tensor(cfg_weight, dtype=torch.float32).item(),
        }
        if ref_audio and Path(ref_audio).exists() and ensure_valid_wav_format(ref_audio):
            gen_params["audio_prompt_path"] = ref_audio
        if language_id != "en":
            gen_params["language_id"] = language_id

        # numpy<2.3 can yield float64 tensors -> "expected scalar type Double" errors.
        torch.set_default_dtype(torch.float32)
        try:
            model = model.float()
        except (AttributeError, RuntimeError):
            try:
                model = model.to(dtype=torch.float32)
            except (AttributeError, RuntimeError):
                pass

        wav = model.generate(text, **gen_params)
        if torch.is_tensor(wav):
            wav = wav.detach().cpu().float().numpy()
        wav = np.asarray(wav, dtype=np.float32).squeeze()
        if wav.ndim > 1:
            wav = wav[0] if wav.shape[0] < wav.shape[1] else wav[:, 0]
        return wav, int(model.sr)

    def unload(self) -> None:
        self._model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def is_loaded(self) -> bool:
        return self._model is not None
