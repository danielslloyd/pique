"""One-shot import of every legacy .rbook in books/ into the Pique database.

Run from repo root with the backend venv:
    backend\\.venv\\Scripts\\python scripts\\import_books.py
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from sqlmodel import Session  # noqa: E402

from app.db import create_tables, get_engine  # noqa: E402
from app.main import seed_styles  # noqa: E402
from app.services.rbook_import import find_existing_import, import_rbook  # noqa: E402
from app.services.storage import get_storage  # noqa: E402

import json  # noqa: E402
import zipfile  # noqa: E402


def main() -> None:
    create_tables()
    storage = get_storage()
    books_dir = REPO_ROOT / "books"
    rbooks = sorted(books_dir.glob("*.rbook"))
    if not rbooks:
        print(f"No .rbook files found in {books_dir}")
        return

    with Session(get_engine()) as session:
        seed_styles(session)
        for path in rbooks:
            data = path.read_bytes()
            try:
                title = json.loads(zipfile.ZipFile(path).read("book.json"))["metadata"].get(
                    "title", "Untitled"
                )
            except Exception:
                title = None
            if title and find_existing_import(session, title):
                print(f"skip (already imported): {path.name} - {title!r}")
                continue
            book = import_rbook(data, session, storage)
            print(f"imported: {path.name} -> book #{book.id} {book.title!r}")


if __name__ == "__main__":
    main()
