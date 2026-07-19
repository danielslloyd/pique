"""Streaming-ish speech recognition for the reading app via faster-whisper.

The browser sends 16 kHz mono Int16 PCM frames over a WebSocket. We keep a rolling
buffer and periodically transcribe the most recent window with the page text as
`initial_prompt` (biases recognition toward the expected words — a big win for
kindergarten speech). This is not true streaming ASR, but for word-matching
purposes a ~1.2 s cadence is plenty and stays simple.

Model notes:
- `small.en` int8 on CPU keeps up with the window cadence on a modern desktop CPU
  and never touches VRAM (safe while ComfyUI/Ollama own the GPU).
- Set PIQUE_WHISPER_DEVICE=cuda for GPU decoding (needs cuDNN 9 DLLs on PATH on
  Windows); the GPU coordinator does NOT gate ASR — keep it on CPU during heavy
  generation phases.
"""

import asyncio
from dataclasses import dataclass, field

import numpy as np

try:
    from faster_whisper import WhisperModel

    HAS_WHISPER = True
except ImportError:
    HAS_WHISPER = False

SAMPLE_RATE = 16000
WINDOW_SECONDS = 6.0  # rolling context fed to the model
MIN_NEW_AUDIO_SECONDS = 1.0  # don't re-transcribe until this much new audio arrived

_model = None
_model_lock = asyncio.Lock()


async def get_model(model_name: str = "small.en", device: str = "cpu") -> "WhisperModel":
    global _model
    async with _model_lock:
        if _model is None:
            loop = asyncio.get_running_loop()
            _model = await loop.run_in_executor(
                None,
                lambda: WhisperModel(model_name, device=device, compute_type="int8"),
            )
        return _model


def whisper_available() -> bool:
    return HAS_WHISPER


@dataclass
class StreamSession:
    expected_text: str = ""
    buffer: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    samples_at_last_decode: int = 0
    total_samples: int = 0

    def add_pcm(self, data: bytes) -> None:
        pcm = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        self.buffer = np.concatenate([self.buffer, pcm])
        self.total_samples += len(pcm)
        max_len = int(WINDOW_SECONDS * SAMPLE_RATE)
        if len(self.buffer) > max_len:
            self.buffer = self.buffer[-max_len:]

    def ready_to_decode(self) -> bool:
        return (
            self.total_samples - self.samples_at_last_decode
            >= MIN_NEW_AUDIO_SECONDS * SAMPLE_RATE
        )

    async def transcribe(self, model: "WhisperModel") -> list[dict]:
        """Transcribe the current window. Returns [{word, confidence}] tokens."""
        self.samples_at_last_decode = self.total_samples
        audio = self.buffer.copy()
        if len(audio) < SAMPLE_RATE // 2:
            return []

        loop = asyncio.get_running_loop()

        def _run():
            segments, _info = model.transcribe(
                audio,
                language="en",
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
                initial_prompt=self.expected_text or None,
                word_timestamps=False,
            )
            words = []
            for seg in segments:
                for raw in seg.text.strip().split():
                    words.append(
                        {"word": raw, "confidence": float(np.exp(seg.avg_logprob))}
                    )
            return words

        return await loop.run_in_executor(None, _run)
