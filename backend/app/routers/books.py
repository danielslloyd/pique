import io
import random
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel
from sqlalchemy import delete
from sqlmodel import Session, func, select

from ..config import settings
from ..db import get_session
from ..models import (
    Book,
    BookCharacter,
    Character,
    Narration,
    Page,
    Style,
    WordTiming,
)
from ..services import comfy_client
from ..services.gpu_coordinator import gpu
from ..services.job_runner import start_job
from ..services.rbook_import import find_existing_import, import_rbook
from ..services.storage import Storage, get_storage
from ..services.textproc import tokenize
from .narrations import build_page_narration
from .word_audio import cache_word_audio, normalize_word

router = APIRouter(prefix="/api/books", tags=["books"])

MAX_SEED = 2**31 - 1
SCENE_WORKFLOW = settings.scene_workflow
VALID_LEVELS = ("pre-k", "k", "1st")


class BookSummary(BaseModel):
    id: int
    title: str
    author: str
    status: str
    source: str
    reading_level: str
    page_count: int
    thumbnail_url: str | None


class PageInfo(BaseModel):
    id: int
    page_no: int
    text: str
    image_url: str | None
    image_status: str
    image_prompt: str
    image_seed: int | None


class BookDetail(BookSummary):
    description: str
    pages: list[PageInfo]


# --- Serialization helpers ----------------------------------------------------


def _summary(book: Book, page_count: int, storage: Storage) -> BookSummary:
    return BookSummary(
        id=book.id,
        title=book.title,
        author=book.author,
        status=book.status,
        source=book.source,
        reading_level=book.reading_level,
        page_count=page_count,
        thumbnail_url=storage.url_for(book.thumbnail_path),
    )


def _page_info(page: Page, storage: Storage) -> PageInfo:
    return PageInfo(
        id=page.id,
        page_no=page.page_no,
        text=page.text,
        image_url=storage.url_for(page.image_path),
        image_status=page.image_status,
        image_prompt=page.image_prompt,
        image_seed=page.image_seed,
    )


def _book_detail(book: Book, session: Session, storage: Storage) -> BookDetail:
    pages = session.exec(
        select(Page).where(Page.book_id == book.id).order_by(Page.page_no)
    ).all()
    return BookDetail(
        **_summary(book, len(pages), storage).model_dump(),
        description=book.description,
        pages=[_page_info(p, storage) for p in pages],
    )


def _get_page(book_id: int, page_no: int, session: Session) -> Page:
    page = session.exec(
        select(Page).where(Page.book_id == book_id, Page.page_no == page_no)
    ).first()
    if not page:
        raise HTTPException(404, "page not found")
    return page


def _book_characters(book_id: int, session: Session) -> list[Character]:
    """Characters attached to a book, in a stable (id) order."""
    return session.exec(
        select(Character)
        .join(BookCharacter, BookCharacter.character_id == Character.id)
        .where(BookCharacter.book_id == book_id)
        .order_by(Character.id)
    ).all()


# --- Listing / detail ---------------------------------------------------------


@router.get("", response_model=list[BookSummary])
def list_books(
    session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> list[BookSummary]:
    counts = dict(
        session.exec(select(Page.book_id, func.count(Page.id)).group_by(Page.book_id)).all()
    )
    books = session.exec(select(Book).order_by(Book.created_at.desc())).all()
    return [_summary(b, counts.get(b.id, 0), storage) for b in books]


@router.get("/{book_id}", response_model=BookDetail)
def get_book(
    book_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> BookDetail:
    book = session.get(Book, book_id)
    if not book:
        raise HTTPException(404, "book not found")
    return _book_detail(book, session, storage)


@router.post("/import-rbook", response_model=BookSummary)
async def import_rbook_endpoint(
    file: UploadFile,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> BookSummary:
    data = await file.read()
    try:
        book = import_rbook(data, session, storage)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    page_count = len(session.exec(select(Page).where(Page.book_id == book.id)).all())
    return _summary(book, page_count, storage)


@router.delete("/{book_id}")
def delete_book(book_id: int, session: Session = Depends(get_session)) -> dict:
    book = session.get(Book, book_id)
    if not book:
        raise HTTPException(404, "book not found")
    # Children must go first; bulk deletes execute immediately (ORM-level deletes of
    # unrelated mappers are not ordered relative to the book delete at flush time).
    narration_ids = select(Narration.id).where(Narration.book_id == book_id)
    session.execute(delete(WordTiming).where(WordTiming.narration_id.in_(narration_ids)))
    session.execute(delete(Narration).where(Narration.book_id == book_id))
    session.execute(delete(BookCharacter).where(BookCharacter.book_id == book_id))
    session.execute(delete(Page).where(Page.book_id == book_id))
    session.delete(book)
    session.commit()
    return {"deleted": book_id}


# --- Wizard: book creation ----------------------------------------------------


class WizardPageIn(BaseModel):
    text: str
    image_prompt: str = ""


class WizardBookRequest(BaseModel):
    title: str
    character_ids: list[int]
    reading_level: str
    pages: list[WizardPageIn]
    engine: str = "kokoro"
    voice: str = "af_heart"


@router.post("/wizard", response_model=BookDetail)
def create_wizard_book(
    body: WizardBookRequest,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> BookDetail:
    if body.reading_level not in VALID_LEVELS:
        raise HTTPException(400, "invalid reading_level")
    if not body.character_ids:
        raise HTTPException(400, "at least one character is required")
    if not body.pages:
        raise HTTPException(400, "at least one page is required")

    characters: list[Character] = []
    style_ids: set[int | None] = set()
    for cid in body.character_ids:
        character = session.get(Character, cid)
        if not character:
            raise HTTPException(404, f"character {cid} not found")
        if character.status != "locked":
            raise HTTPException(400, f"character {cid} is not locked")
        characters.append(character)
        style_ids.add(character.style_id)
    if len(style_ids) != 1 or None in style_ids:
        raise HTTPException(400, "all characters must share one style")
    (style_id,) = style_ids

    book = Book(
        title=body.title,
        source="wizard",
        status="draft",
        reading_level=body.reading_level,
        style_id=style_id,
        story_model=settings.story_model,
    )
    session.add(book)
    session.flush()  # assign id

    for character in characters:
        session.add(BookCharacter(book_id=book.id, character_id=character.id))
    for i, page in enumerate(body.pages, start=1):
        session.add(
            Page(
                book_id=book.id,
                page_no=i,
                text=page.text,
                image_prompt=page.image_prompt,
                image_status="pending",
            )
        )
    session.commit()
    session.refresh(book)
    return _book_detail(book, session, storage)


# --- Wizard: scene image generation -------------------------------------------


class PageImageRequest(BaseModel):
    seed: int | None = None
    prompt_override: str | None = None


def _largest_image(images: list[bytes]) -> bytes:
    def area(b: bytes) -> int:
        try:
            with Image.open(io.BytesIO(b)) as im:
                return im.width * im.height
        except Exception:  # noqa: BLE001
            return len(b)

    return max(images, key=area)


@router.post("/{book_id}/pages/{page_no}/image")
async def generate_page_image(
    book_id: int,
    page_no: int,
    body: PageImageRequest,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> dict:
    book = session.get(Book, book_id)
    if not book:
        raise HTTPException(404, "book not found")
    page = _get_page(book_id, page_no, session)
    style = session.get(Style, book.style_id) if book.style_id else None
    if not style:
        raise HTTPException(400, "book has no style")

    characters = _book_characters(book_id, session)
    if not characters:
        raise HTTPException(400, "book has no characters")
    first = characters[0]
    if not first.ref_image_path or not storage.exists(first.ref_image_path):
        raise HTTPException(400, "first character has no reference image")
    ref_bytes = storage.path_for(first.ref_image_path).read_bytes()

    identity = " ".join(c.identity_prompt for c in characters if c.identity_prompt)
    scene_text = body.prompt_override or page.image_prompt
    if "kontext" in SCENE_WORKFLOW or "qwen_edit" in SCENE_WORKFLOW:
        # Editing models (Kontext / Qwen-Edit) take instructions and carry identity
        # from the reference image itself; re-describing the character fights the ref.
        prompt = (
            f"Place this exact character in this scene, keeping the character exactly "
            f"the same: {scene_text} {style.master_prompt}."
        )
    else:
        prompt = f"{style.master_prompt}. {identity}. {scene_text}"
    seed = body.seed if body.seed is not None else random.randint(0, MAX_SEED)
    persist_prompt = body.prompt_override

    async def job(report):
        from ..db import get_engine

        engine = get_engine()
        st = get_storage()
        try:
            template = comfy_client.load_workflow(SCENE_WORKFLOW)
        except FileNotFoundError as e:
            raise RuntimeError(f"{SCENE_WORKFLOW}.json workflow is missing") from e

        async with gpu.phase("comfy"):
            client_id = uuid.uuid4().hex
            server_filename = await comfy_client.upload_image(ref_bytes, "scene_ref.png")
            wf = comfy_client.patch_workflow(
                template, input_image=server_filename, prompt_text=prompt, seed=seed
            )
            prompt_id = await comfy_client.queue_prompt(wf, client_id)
            outputs = await comfy_client.wait_for_completion(
                prompt_id, on_progress=report, timeout_s=600
            )
            images = await comfy_client.fetch_output_images(outputs)
        if not images:
            raise RuntimeError("scene generation produced no images")

        key = f"books/{book_id}/page_{page_no}_scene_{seed}.png"
        st.save_bytes(_largest_image(images), key)
        with Session(engine) as s:
            pg = s.exec(
                select(Page).where(Page.book_id == book_id, Page.page_no == page_no)
            ).first()
            pg.image_path = key
            pg.image_seed = seed
            pg.image_status = "candidate"
            if persist_prompt:
                pg.image_prompt = persist_prompt
            s.add(pg)
            s.commit()
        return {"book_id": book_id, "page_no": page_no, "seed": seed, "image_key": key}

    job_id = start_job("scene", job)
    return {"job_id": job_id}


@router.post("/{book_id}/pages/{page_no}/approve")
def approve_page(
    book_id: int, page_no: int, session: Session = Depends(get_session)
) -> dict:
    if not session.get(Book, book_id):
        raise HTTPException(404, "book not found")
    page = _get_page(book_id, page_no, session)
    page.image_status = "approved"
    session.add(page)
    session.commit()
    return {"approved": page_no}


class PagePatch(BaseModel):
    text: str | None = None
    image_prompt: str | None = None


@router.patch("/{book_id}/pages/{page_no}", response_model=PageInfo)
def patch_page(
    book_id: int,
    page_no: int,
    body: PagePatch,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> PageInfo:
    book = session.get(Book, book_id)
    if not book:
        raise HTTPException(404, "book not found")
    if book.status != "draft":
        raise HTTPException(409, "only draft books can be edited")
    page = _get_page(book_id, page_no, session)
    updates = body.model_dump(exclude_none=True)
    for key, value in updates.items():
        setattr(page, key, value)
    session.add(page)
    session.commit()
    session.refresh(page)
    return _page_info(page, storage)


# --- Wizard: finalize (narration + word-audio warm-up) ------------------------


class FinalizeRequest(BaseModel):
    engine: str = "kokoro"
    voice: str = "af_heart"


async def _prewarm_word_audio(
    pages: list[Page], engine: str, voice: str, session: Session, storage: Storage
) -> None:
    seen: set[str] = set()
    for page in pages:
        for token in tokenize(page.text):
            word = normalize_word(token)
            if word and word not in seen:
                seen.add(word)
                await cache_word_audio(word, engine, voice, session, storage)


@router.post("/{book_id}/finalize")
async def finalize_book(
    book_id: int,
    body: FinalizeRequest,
    session: Session = Depends(get_session),
) -> dict:
    book = session.get(Book, book_id)
    if not book:
        raise HTTPException(404, "book not found")
    pages = session.exec(
        select(Page).where(Page.book_id == book_id).order_by(Page.page_no)
    ).all()
    if not pages:
        raise HTTPException(400, "book has no pages")
    if any(p.image_status != "approved" for p in pages):
        raise HTTPException(400, "all pages must be approved before finalizing")

    engine, voice = body.engine, body.voice

    async def job(report):
        from ..db import get_engine

        db_engine = get_engine()
        st = get_storage()
        with Session(db_engine) as s:
            b = s.get(Book, book_id)
            b.status = "generating"
            s.add(b)
            s.commit()

        try:
            async with gpu.phase("tts"):
                with Session(db_engine) as s:
                    pgs = s.exec(
                        select(Page)
                        .where(Page.book_id == book_id)
                        .order_by(Page.page_no)
                    ).all()
                    total = len(pgs) + 1  # +1 so word-audio warm-up leaves headroom
                    for i, page in enumerate(pgs):
                        existing = s.exec(
                            select(Narration).where(
                                Narration.page_id == page.id,
                                Narration.engine == engine,
                                Narration.voice_id == voice,
                            )
                        ).first()
                        if not existing:
                            await build_page_narration(page, engine, voice, None, s, st)
                        report((i + 1) / total)

                    await _prewarm_word_audio(pgs, engine, voice, s, st)

                    b = s.get(Book, book_id)
                    if not b.thumbnail_path and pgs and pgs[0].image_path:
                        b.thumbnail_path = pgs[0].image_path
                    b.status = "ready"
                    s.add(b)
                    s.commit()
            report(1.0)
        except Exception:
            with Session(db_engine) as s:
                b = s.get(Book, book_id)
                if b:
                    b.status = "draft"
                    s.add(b)
                    s.commit()
            raise
        return {"book_id": book_id, "status": "ready"}

    job_id = start_job("narration", job)
    return {"job_id": job_id}


__all__ = ["router", "find_existing_import"]
