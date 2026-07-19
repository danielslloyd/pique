from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Book, Narration, Page, WordTiming
from ..services import tts_client
from ..services.gpu_coordinator import gpu
from ..services.textproc import map_spans_to_tokens
from ..services.storage import Storage, get_storage

router = APIRouter(prefix="/api", tags=["narrations"])


class WordTimingOut(BaseModel):
    i: int
    word: str
    start_ms: int
    end_ms: int


class NarrationOut(BaseModel):
    audio_url: str
    duration_s: float
    engine: str
    voice_id: str
    words: list[WordTimingOut]


async def build_page_narration(
    page: Page,
    engine: str,
    voice: str,
    ref_audio: str | None,
    session: Session,
    storage: Storage,
) -> Narration:
    result = await tts_client.synthesize(
        page.text, engine=engine, voice=voice, ref_audio=ref_audio, align=True
    )
    key = f"narrations/{page.book_id}/page_{page.page_no}_{engine}_{voice}.wav"
    storage.save_bytes(result["audio"], key)

    narration = Narration(
        book_id=page.book_id,
        page_id=page.id,
        engine=engine,
        voice_id=voice,
        audio_path=key,
        duration_s=result["duration_s"],
        sample_rate=result["sample_rate"],
    )
    session.add(narration)
    session.flush()

    for i, timing in enumerate(map_spans_to_tokens(page.text, result["words"])):
        session.add(
            WordTiming(
                narration_id=narration.id,
                word_index=i,
                word=timing["word"],
                start_ms=timing["start_ms"],
                end_ms=timing["end_ms"],
            )
        )
    session.commit()
    session.refresh(narration)
    return narration


@router.get("/books/{book_id}/pages/{page_no}/narration", response_model=NarrationOut)
async def get_narration(
    book_id: int,
    page_no: int,
    engine: str = "kokoro",
    voice: str = "af_heart",
    build: bool = True,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> NarrationOut:
    if not session.get(Book, book_id):
        raise HTTPException(404, "book not found")
    page = session.exec(
        select(Page).where(Page.book_id == book_id, Page.page_no == page_no)
    ).first()
    if not page:
        raise HTTPException(404, "page not found")

    narration = session.exec(
        select(Narration).where(
            Narration.page_id == page.id,
            Narration.engine == engine,
            Narration.voice_id == voice,
        )
    ).first()

    if narration is None:
        if not build:
            raise HTTPException(404, "narration not built")
        try:
            async with gpu.phase("tts"):
                narration = await build_page_narration(
                    page, engine, voice, None, session, storage
                )
        except tts_client.TTSUnavailable as e:
            raise HTTPException(503, str(e)) from e

    timings = session.exec(
        select(WordTiming)
        .where(WordTiming.narration_id == narration.id)
        .order_by(WordTiming.word_index)
    ).all()
    return NarrationOut(
        audio_url=storage.url_for(narration.audio_path),
        duration_s=narration.duration_s,
        engine=narration.engine,
        voice_id=narration.voice_id,
        words=[
            WordTimingOut(i=t.word_index, word=t.word, start_ms=t.start_ms, end_ms=t.end_ms)
            for t in timings
        ],
    )


class BuildRequest(BaseModel):
    book_id: int
    engine: str = "kokoro"
    voice: str = "af_heart"
    ref_audio: str | None = None


@router.post("/narrations/build")
async def build_book_narrations(
    req: BuildRequest,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> dict:
    """Build narration for every page of a book (sequential; call from wizard finalize)."""
    pages = session.exec(
        select(Page).where(Page.book_id == req.book_id).order_by(Page.page_no)
    ).all()
    if not pages:
        raise HTTPException(404, "book has no pages")

    built, skipped = 0, 0
    try:
        async with gpu.phase("tts"):
            for page in pages:
                existing = session.exec(
                    select(Narration).where(
                        Narration.page_id == page.id,
                        Narration.engine == req.engine,
                        Narration.voice_id == req.voice,
                    )
                ).first()
                if existing:
                    skipped += 1
                    continue
                await build_page_narration(
                    page, req.engine, req.voice, req.ref_audio, session, storage
                )
                built += 1
    except tts_client.TTSUnavailable as e:
        raise HTTPException(503, str(e)) from e
    return {"built": built, "skipped": skipped}
