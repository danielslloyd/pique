from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .db import create_tables, get_engine
from .models import STYLE_PRESETS, Style
from .routers import (
    asr,
    books,
    characters,
    jobs,
    media,
    narrations,
    stories,
    styles,
    word_audio,
)


def seed_styles(session: Session) -> None:
    if session.exec(select(Style)).first():
        return
    for preset in STYLE_PRESETS:
        session.add(Style(name=preset["name"], is_preset=True, master_prompt=preset["master_prompt"]))
    session.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_tables()
    with Session(get_engine()) as session:
        seed_styles(session)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Pique API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(asr.router)
    app.include_router(books.router)
    app.include_router(characters.router)
    app.include_router(jobs.router)
    app.include_router(media.router)
    app.include_router(narrations.router)
    app.include_router(stories.router)
    app.include_router(styles.router)
    app.include_router(word_audio.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    return app


app = create_app()
