# WAV normalization ported from the tail of Henty's generate_audio().

import io

import numpy as np
from scipy.io import wavfile


def to_mono_float32(wav) -> np.ndarray:
    arr = np.asarray(wav, dtype=np.float32)
    if arr.ndim == 2:
        arr = arr[0] if arr.shape[0] < arr.shape[1] else arr[:, 0]
    return arr.flatten()


def wav_bytes(wav: np.ndarray, sample_rate: int) -> bytes:
    """float32 [-1,1] mono -> 16-bit PCM WAV bytes."""
    clipped = np.clip(to_mono_float32(wav), -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)
    buf = io.BytesIO()
    wavfile.write(buf, sample_rate, pcm)
    return buf.getvalue()
