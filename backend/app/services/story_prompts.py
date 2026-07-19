"""Prompt construction, JSON schemas, and reading-level validation for stories.

Reading levels are encoded twice: as natural-language *guidance* baked into the
system prompt, and as *heuristic limits* used by ``validate_level`` to check the
generated text and drive a corrective retry.
"""

import re

# --- Reading levels -----------------------------------------------------------

READING_LEVELS: dict[str, dict] = {
    "pre-k": {
        "label": "pre-k",
        "max_sentences_per_page": 1,
        "max_words_per_sentence": 6,
        "guidance": (
            "Exactly one short sentence per page. No more than 6 words in a "
            "sentence. Use only very simple, decodable words a pre-kindergartener "
            "can sound out."
        ),
    },
    "k": {
        "label": "k",
        "max_sentences_per_page": 2,
        "max_words_per_sentence": 8,
        "guidance": (
            "One or two short sentences per page. No more than 8 words in a "
            "sentence. Use simple, common words suitable for a kindergarten reader."
        ),
    },
    "1st": {
        "label": "1st grade",
        "max_sentences_per_page": 3,
        "max_words_per_sentence": 10,
        "guidance": (
            "Two or three short sentences per page. No more than 10 words in a "
            "sentence. Use words suitable for a first-grade reader."
        ),
    },
}


# --- JSON schemas -------------------------------------------------------------

PAGE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "page_no": {"type": "integer"},
        "text": {"type": "string"},
        "image_prompt": {"type": "string"},
    },
    "required": ["page_no", "text", "image_prompt"],
}

STORY_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "pages": {"type": "array", "items": PAGE_SCHEMA},
    },
    "required": ["title", "pages"],
}


# --- Message builders ---------------------------------------------------------


def _level_spec(level: str) -> dict:
    return READING_LEVELS.get(level, READING_LEVELS["k"])


def _character_block(characters: list[dict]) -> str:
    lines = []
    for c in characters:
        identity = (c.get("identity_prompt") or "").strip()
        suffix = f" ({identity})" if identity else ""
        lines.append(f"- {c['name']}{suffix}")
    return "\n".join(lines)


_IMAGE_PROMPT_RULES = (
    "one vivid sentence describing the SCENE for an illustrator: the setting, the "
    "action, and the emotion. Refer to characters by NAME only. Do NOT describe "
    "how characters look (hair, clothing, colors, species) — those descriptors are "
    "added later by the system."
)


def build_story_messages(
    characters: list[dict], theme: str, level: str, page_count: int
) -> list[dict]:
    spec = _level_spec(level)
    names = ", ".join(c["name"] for c in characters)
    system = (
        "You are a warm, imaginative children's picture-book author.\n"
        f"Write a {page_count}-page picture book for a {spec['label']} reading "
        "level.\n\n"
        f"Reading-level rules: {spec['guidance']}\n\n"
        "Every page has exactly two fields:\n"
        "- text: the exact words the child reads on that page, obeying the "
        "reading-level rules above.\n"
        f"- image_prompt: {_IMAGE_PROMPT_RULES}\n\n"
        "Give the story a gentle narrative arc and a warm, reassuring ending. "
        "Provide a short, evocative title."
    )
    user = (
        f"Characters:\n{_character_block(characters)}\n\n"
        f"Theme: {theme}\n\n"
        f"Write exactly {page_count} pages, numbered 1 to {page_count}, featuring "
        f"{names}."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def build_revise_messages(
    title: str,
    pages: list[dict],
    page_no: int,
    instruction: str,
    level: str,
    characters: list[dict] | None = None,
) -> list[dict]:
    spec = _level_spec(level)
    story = "\n".join(f"Page {p['page_no']}: {p['text']}" for p in pages)
    char_line = ""
    if characters:
        char_line = f"Characters: {', '.join(c['name'] for c in characters)}\n"
    system = (
        "You are a children's picture-book author revising a single page.\n"
        f"Reading-level rules: {spec['guidance']}\n\n"
        "Return one page object with fields page_no, text, and image_prompt. "
        f"The image_prompt is {_IMAGE_PROMPT_RULES}"
    )
    user = (
        f"Story title: {title}\n"
        f"{char_line}\n"
        f"Full story so far:\n{story}\n\n"
        f"Revise page {page_no}. Keep page_no = {page_no}.\n"
        f"Instruction: {instruction}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# --- Validation ---------------------------------------------------------------

_SENTENCE_SPLIT = re.compile(r"[.!?]+")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def validate_level(pages: list[dict], level: str) -> list[str]:
    """Return human-readable reading-level violations for ``pages``.

    Sentences are split on ``.!?`` and words counted by whitespace.
    """
    spec = READING_LEVELS.get(level)
    if not spec:
        return []
    max_sentences = spec["max_sentences_per_page"]
    max_words = spec["max_words_per_sentence"]
    violations: list[str] = []
    for i, page in enumerate(pages):
        page_no = page.get("page_no", i + 1)
        sentences = _sentences(page.get("text", ""))
        if len(sentences) > max_sentences:
            violations.append(
                f"page {page_no}: {len(sentences)} sentences (max {max_sentences})"
            )
        for sentence in sentences:
            word_count = len(sentence.split())
            if word_count > max_words:
                violations.append(
                    f"page {page_no}: sentence has {word_count} words "
                    f"(max {max_words})"
                )
    return violations
