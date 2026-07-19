from abc import ABC, abstractmethod

import numpy as np


class TTSEngine(ABC):
    """An engine turns text (+voice params) into (mono float32 waveform, sample_rate)."""

    name: str = "base"

    @abstractmethod
    def synthesize(self, text: str, **params) -> tuple[np.ndarray, int]: ...

    @abstractmethod
    def unload(self) -> None: ...

    @abstractmethod
    def is_loaded(self) -> bool: ...
