"""Single-GPU phase manager.

Pique shares one GPU between three heavy consumers: ComfyUI (image generation),
Ollama (story LLM), and the TTS service (narration). Only one may hold VRAM at a
time. ``GpuCoordinator.phase(name)`` is an ``asyncio.Lock``-guarded async context
manager: on entering a phase that differs from the previous one, it runs the
best-effort transitions that evict the *other* consumers before yielding.

Consecutive acquisitions of the same phase skip the transitions (nothing to
evict), so a run of ComfyUI jobs pays the eviction cost only once.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import Literal

from . import comfy_client, tts_client

Phase = Literal["comfy", "llm", "tts"]


async def _best_effort(coro) -> None:
    """Await a transition coroutine, swallowing any connection/runtime error."""
    try:
        await coro
    except Exception:  # noqa: BLE001 - transitions are advisory only
        pass


class GpuCoordinator:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.last_phase: Phase | None = None

    @asynccontextmanager
    async def phase(self, name: Phase):
        async with self._lock:
            if name != self.last_phase:
                await self._transition(name)
                self.last_phase = name
            yield

    async def _transition(self, name: Phase) -> None:
        """Evict the consumers that must release VRAM before ``name`` runs."""
        if name == "comfy":
            await _best_effort(comfy_client.evict_ollama())
            await _best_effort(tts_client.unload())
        elif name == "llm":
            await _best_effort(comfy_client.free_comfy())
            await _best_effort(tts_client.unload())
        elif name == "tts":
            await _best_effort(comfy_client.free_comfy())
            await _best_effort(comfy_client.evict_ollama())


# Module-level singleton — import ``gpu`` and use ``async with gpu.phase(...)``.
gpu = GpuCoordinator()
