"""Ollama-backed story drafting endpoints for the wizard.

These endpoints call the LLM synchronously (not via the job runner): a draft can
take 60-180s, which the wizard front-end handles with a long-lived request.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..models import Character
from ..services import ollama_client
from ..services.gpu_coordinator import gpu
from ..services.story_prompts import (
    PAGE_SCHEMA,
    READING_LEVELS,
    STORY_SCHEMA,
    build_revise_messages,
    build_story_messages,
    validate_level,
)

router = APIRouter(prefix="/api/stories", tags=["stories"])


# --- Schemas ------------------------------------------------------------------


class StoryPage(BaseModel):
    page_no: int
    text: str
    image_prompt: str


class DraftRequest(BaseModel):
    character_ids: list[int]
    theme: str
    reading_level: str
    page_count: int = 6
    model: str | None = None


class DraftResponse(BaseModel):
    title: str
    pages: list[StoryPage]


class ReviseRequest(BaseModel):
    title: str
    pages: list[StoryPage]
    page_no: int
    instruction: str
    reading_level: str
    character_ids: list[int]


class ReviseResponse(BaseModel):
    page: StoryPage


# --- Helpers ------------------------------------------------------------------


def _load_locked_characters(character_ids: list[int], session: Session) -> list[Character]:
    if not character_ids:
        raise HTTPException(400, "at least one character is required")
    characters: list[Character] = []
    for cid in character_ids:
        character = session.get(Character, cid)
        if not character:
            raise HTTPException(404, f"character {cid} not found")
        if character.status != "locked":
            raise HTTPException(400, f"character {cid} is not locked")
        characters.append(character)
    return characters


def _coerce_page(raw: dict, fallback_no: int) -> StoryPage:
    return StoryPage(
        page_no=int(raw.get("page_no", fallback_no)),
        text=(raw.get("text") or "").strip(),
        image_prompt=(raw.get("image_prompt") or "").strip(),
    )


def _coerce_story(data: dict) -> DraftResponse:
    pages = [
        _coerce_page(p, i + 1) for i, p in enumerate(data.get("pages", []) or [])
    ]
    return DraftResponse(title=(data.get("title") or "Untitled").strip(), pages=pages)


# --- Endpoints ----------------------------------------------------------------


@router.post("/draft", response_model=DraftResponse)
async def draft_story(
    body: DraftRequest, session: Session = Depends(get_session)
) -> DraftResponse:
    if body.reading_level not in READING_LEVELS:
        raise HTTPException(400, "invalid reading_level")
    characters = _load_locked_characters(body.character_ids, session)
    char_dicts = [
        {"name": c.name, "identity_prompt": c.identity_prompt} for c in characters
    ]
    messages = build_story_messages(
        char_dicts, body.theme, body.reading_level, body.page_count
    )

    async with gpu.phase("llm"):
        first = await ollama_client.chat_json(
            messages, STORY_SCHEMA, model=body.model
        )
        best = first
        best_violations = validate_level(first.get("pages", []), body.reading_level)

        if best_violations:
            retry_messages = messages + [
                {"role": "assistant", "content": json.dumps(first)},
                {
                    "role": "user",
                    "content": "Fix these problems: " + "; ".join(best_violations),
                },
            ]
            try:
                second = await ollama_client.chat_json(
                    retry_messages, STORY_SCHEMA, model=body.model
                )
                second_violations = validate_level(
                    second.get("pages", []), body.reading_level
                )
                if len(second_violations) < len(best_violations):
                    best, best_violations = second, second_violations
            except ollama_client.OllamaError:
                pass  # keep the first attempt if the retry fails outright

    return _coerce_story(best)


@router.post("/revise", response_model=ReviseResponse)
async def revise_story(
    body: ReviseRequest, session: Session = Depends(get_session)
) -> ReviseResponse:
    if body.reading_level not in READING_LEVELS:
        raise HTTPException(400, "invalid reading_level")
    characters = _load_locked_characters(body.character_ids, session)
    char_dicts = [{"name": c.name} for c in characters]
    pages = [p.model_dump() for p in body.pages]
    messages = build_revise_messages(
        body.title, pages, body.page_no, body.instruction, body.reading_level, char_dicts
    )

    async with gpu.phase("llm"):
        result = await ollama_client.chat_json(messages, PAGE_SCHEMA, model=None)

    return ReviseResponse(page=_coerce_page(result, body.page_no))
