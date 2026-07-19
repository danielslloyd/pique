import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel, UniqueConstraint


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_job_id() -> str:
    return uuid.uuid4().hex


class Style(SQLModel, table=True):
    __tablename__ = "styles"

    id: int | None = Field(default=None, primary_key=True)
    family_id: int = Field(default=1, index=True)
    name: str = Field(index=True)
    is_preset: bool = False
    master_prompt: str
    negative_prompt: str = ""
    thumbnail_path: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class Character(SQLModel, table=True):
    __tablename__ = "characters"

    id: int | None = Field(default=None, primary_key=True)
    family_id: int = Field(default=1, index=True)
    name: str
    description: str = ""
    attributes_json: str = "{}"
    style_id: int | None = Field(default=None, foreign_key="styles.id")
    status: str = "draft"  # draft | locked
    identity_prompt: str = ""
    source_photo_path: str | None = None
    ref_image_path: str | None = None
    sheet_image_path: str | None = None
    seed: int | None = None
    created_at: datetime = Field(default_factory=utcnow)
    locked_at: datetime | None = None


class CharacterImage(SQLModel, table=True):
    __tablename__ = "character_images"

    id: int | None = Field(default=None, primary_key=True)
    family_id: int = Field(default=1, index=True)
    character_id: int = Field(foreign_key="characters.id", index=True)
    kind: str  # source_photo | base_candidate | sheet | ref_crop
    path: str
    seed: int | None = None
    created_at: datetime = Field(default_factory=utcnow)


class Book(SQLModel, table=True):
    __tablename__ = "books"

    id: int | None = Field(default=None, primary_key=True)
    family_id: int = Field(default=1, index=True)
    title: str
    author: str = ""
    description: str = ""
    status: str = "ready"  # draft | generating | ready
    source: str  # imported | wizard | legacy
    reading_level: str = "k"  # pre-k | k | 1st
    style_id: int | None = Field(default=None, foreign_key="styles.id")
    thumbnail_path: str | None = None
    story_model: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class BookCharacter(SQLModel, table=True):
    __tablename__ = "book_characters"

    book_id: int = Field(foreign_key="books.id", primary_key=True)
    character_id: int = Field(foreign_key="characters.id", primary_key=True)


class Page(SQLModel, table=True):
    __tablename__ = "pages"
    __table_args__ = (UniqueConstraint("book_id", "page_no", name="uq_pages_book_page"),)

    id: int | None = Field(default=None, primary_key=True)
    family_id: int = Field(default=1, index=True)
    book_id: int = Field(foreign_key="books.id", index=True)
    page_no: int
    text: str
    image_prompt: str = ""
    image_path: str | None = None
    image_seed: int | None = None
    image_status: str = "approved"  # pending | candidate | approved


class Narration(SQLModel, table=True):
    __tablename__ = "narrations"

    id: int | None = Field(default=None, primary_key=True)
    family_id: int = Field(default=1, index=True)
    book_id: int = Field(foreign_key="books.id", index=True)
    page_id: int | None = Field(default=None, foreign_key="pages.id", index=True)
    engine: str  # kokoro | chatterbox
    voice_id: str
    audio_path: str
    duration_s: float
    sample_rate: int
    created_at: datetime = Field(default_factory=utcnow)


class WordTiming(SQLModel, table=True):
    __tablename__ = "word_timings"

    id: int | None = Field(default=None, primary_key=True)
    narration_id: int = Field(foreign_key="narrations.id", index=True)
    word_index: int
    word: str
    start_ms: int
    end_ms: int


class WordAudioCache(SQLModel, table=True):
    __tablename__ = "word_audio_cache"

    word: str = Field(primary_key=True)
    engine: str = Field(primary_key=True)
    voice_id: str = Field(primary_key=True)
    family_id: int = Field(default=1, index=True)
    audio_path: str
    created_at: datetime = Field(default_factory=utcnow)


class Job(SQLModel, table=True):
    __tablename__ = "jobs"

    id: str = Field(default_factory=new_job_id, primary_key=True)
    family_id: int = Field(default=1, index=True)
    kind: str  # sheet | scene | narration | story
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    payload_json: str = "{}"
    result_json: str = "{}"
    error: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


STYLE_PRESETS: list[dict[str, str]] = [
    {
        "name": "storybook_watercolor",
        "master_prompt": (
            "soft watercolor children's book illustration, gentle pastel palette, "
            "hand-painted textures, warm and cozy storybook style"
        ),
    },
    {
        "name": "bold_cartoon",
        "master_prompt": (
            "bold cartoon illustration for children, thick clean outlines, bright saturated "
            "colors, simple shapes, playful animated style"
        ),
    },
    {
        "name": "ghibli_soft",
        "master_prompt": (
            "soft anime film illustration, lush painted backgrounds, gentle natural light, "
            "whimsical and serene, hand-drawn animation style"
        ),
    },
    {
        "name": "paper_cutout",
        "master_prompt": (
            "paper cutout collage illustration, layered construction paper shapes, visible "
            "paper texture, bright flat colors, craft storybook style"
        ),
    },
    {
        "name": "realistic_illustration",
        "master_prompt": (
            "realistic children's book illustration, detailed and warm, soft natural lighting, "
            "painterly finish, friendly and inviting"
        ),
    },
]
