# Forced alignment via torchaudio MMS_FA. Ported from Henty server.py
# (load_aligner/_normalize_align_words/_trim_to_target) — but where Henty discarded
# per-word spans after trimming carrier padding, align_words() keeps every span.

from dataclasses import dataclass

import numpy as np
import torch
import torchaudio


@dataclass
class WordSpan:
    word: str  # normalized (aligner charset) form
    start_s: float
    end_s: float


class MMSAligner:
    def __init__(self, device: str = "cuda"):
        self.device = device
        self._model = None
        self._tokenizer = None
        self._aligner = None
        self._sr = None
        self._chars: set[str] | None = None

    def _load(self):
        if self._model is None:
            bundle = torchaudio.pipelines.MMS_FA
            self._model = bundle.get_model().to(self.device).eval()
            self._tokenizer = bundle.get_tokenizer()
            self._aligner = bundle.get_aligner()
            self._sr = bundle.sample_rate
            self._chars = set(bundle.get_dict().keys())

    def normalize_words(self, text: str) -> list[str]:
        """Reduce text to the aligner's charset; characters outside it become spaces."""
        self._load()
        allowed = self._chars
        cleaned = "".join(
            ch if (ch in allowed or ch.isspace()) else " " for ch in (text or "").lower()
        )
        return [w for w in cleaned.split() if w]

    def align_words(self, wav: np.ndarray, sr: int, words: list[str]) -> list[WordSpan]:
        """Align pre-normalized words to audio; returns one span per word, in order."""
        self._load()
        w = torch.from_numpy(np.asarray(wav, dtype=np.float32)).squeeze()
        if w.ndim > 1:
            w = w[0] if w.shape[0] < w.shape[1] else w[:, 0]

        wav16 = torchaudio.functional.resample(w.unsqueeze(0), sr, self._sr).to(self.device)
        tokens = self._tokenizer(words)
        with torch.inference_mode():
            emission, _ = self._model(wav16)
            spans = self._aligner(emission[0], tokens)

        ratio = wav16.size(1) / emission.size(1)  # samples per emission frame at aligner sr
        out: list[WordSpan] = []
        for word, span in zip(words, spans):
            start_s = span[0].start * ratio / self._sr
            end_s = span[-1].end * ratio / self._sr
            out.append(WordSpan(word=word, start_s=round(float(start_s), 3), end_s=round(float(end_s), 3)))
        return out

    def trim_to_target(
        self,
        wav: np.ndarray,
        sr: int,
        pre_words: list[str],
        target_words: list[str],
        post_words: list[str],
        guard_ms: int = 60,
    ) -> tuple[np.ndarray, list[WordSpan]]:
        """Carrier-padding trim (Henty's trick for short fragments): align pre+target+post,
        slice out the target span, and return target word spans re-based to the slice."""
        all_words = pre_words + target_words + post_words
        spans = self.align_words(wav, sr, all_words)
        ti = len(pre_words)
        tj = ti + len(target_words) - 1
        start_s = spans[ti].start_s
        end_s = spans[tj].end_s

        guard = guard_ms / 1000.0
        a = max(0, int((start_s - guard) * sr))
        b = min(len(wav), int((end_s + guard) * sr))
        if b <= a:
            raise RuntimeError("carrier trim produced an empty span")

        offset = a / sr
        target_spans = [
            WordSpan(s.word, round(s.start_s - offset, 3), round(s.end_s - offset, 3))
            for s in spans[ti : tj + 1]
        ]
        return wav[a:b], target_spans

    def unload(self) -> None:
        self._model = None
        self._tokenizer = None
        self._aligner = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def is_loaded(self) -> bool:
        return self._model is not None
