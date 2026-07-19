"""Async Ollama client for structured (JSON-schema-constrained) chat.

Uses Ollama's ``format`` field to force the model to emit JSON matching a schema,
so callers get a parsed dict back rather than free text.
"""

import json

import httpx

from ..config import settings


class OllamaError(Exception):
    pass


async def chat_json(
    messages: list[dict],
    schema: dict,
    model: str | None = None,
    timeout: int = 600,
) -> dict:
    """POST /api/chat with a JSON schema ``format`` and return the parsed content.

    Retries once if the model returns text that is not valid JSON. Raises
    ``OllamaError`` on connection failure, a non-200 response, or invalid JSON
    that survives the retry.
    """
    model = model or settings.story_model
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "format": schema,
        "options": {"temperature": 0.8},
        "keep_alive": "2m",
    }

    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for _attempt in range(2):
            try:
                resp = await client.post(
                    f"{settings.ollama_url}/api/chat", json=payload
                )
            except httpx.HTTPError as e:
                raise OllamaError(
                    f"Ollama unreachable at {settings.ollama_url}: {e}"
                ) from e
            if resp.status_code != 200:
                raise OllamaError(
                    f"Ollama error {resp.status_code}: {resp.text[:300]}"
                )
            try:
                content = resp.json()["message"]["content"]
            except (KeyError, json.JSONDecodeError) as e:
                raise OllamaError(f"Unexpected Ollama response shape: {e}") from e
            try:
                return json.loads(content)
            except json.JSONDecodeError as e:
                last_error = e  # retry once
    raise OllamaError(f"Ollama returned invalid JSON after retry: {last_error}")
