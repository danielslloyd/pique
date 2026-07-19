import io
import json
import zipfile
from pathlib import PurePosixPath

from sqlmodel import Session, select

from ..models import Book, Page
from .storage import Storage


def find_existing_import(session: Session, title: str) -> Book | None:
    return session.exec(
        select(Book).where(Book.title == title, Book.source == "imported")
    ).first()


def import_rbook(file_bytes: bytes, session: Session, storage: Storage) -> Book:
    """Import a legacy .rbook (ZIP of book.json + page images + thumbnail.jpg)."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(file_bytes))
    except zipfile.BadZipFile as e:
        raise ValueError("not a valid .rbook: not a ZIP archive") from e
    names = set(archive.namelist())
    if "book.json" not in names:
        raise ValueError("not a valid .rbook: missing book.json")

    data = json.loads(archive.read("book.json"))
    metadata = data.get("metadata", {})
    pages_data = data.get("pages", [])
    if not pages_data:
        raise ValueError("not a valid .rbook: no pages")

    book = Book(
        title=metadata.get("title", "Untitled"),
        author=metadata.get("author", ""),
        description=metadata.get("description", ""),
        status="ready",
        source="imported",
    )
    session.add(book)
    session.flush()  # assign book.id

    if "thumbnail.jpg" in names:
        key = f"books/{book.id}/thumbnail.jpg"
        storage.save_bytes(archive.read("thumbnail.jpg"), key)
        book.thumbnail_path = key

    for i, page_data in enumerate(pages_data, start=1):
        image_name = page_data.get("image")
        image_key = None
        if image_name and image_name in names:
            ext = PurePosixPath(image_name).suffix or ".png"
            image_key = f"books/{book.id}/page_{i}{ext}"
            storage.save_bytes(archive.read(image_name), image_key)
        session.add(
            Page(
                book_id=book.id,
                page_no=i,
                text=(page_data.get("text") or "").strip(),
                image_path=image_key,
                image_status="approved",
            )
        )

    session.commit()
    session.refresh(book)
    return book
