import sys
from pathlib import Path

import pytest
from sqlmodel import Session, SQLModel, create_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.services.storage import Storage  # noqa: E402


@pytest.fixture()
def session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


@pytest.fixture()
def storage(tmp_path):
    return Storage(tmp_path / "media")


@pytest.fixture()
def rbook_paths():
    paths = sorted((REPO_ROOT / "books").glob("*.rbook"))
    assert paths, "expected .rbook fixtures in books/"
    return paths
