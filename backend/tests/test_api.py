import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import config, db

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(db, "_engine", None)

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
    db._engine = None


def test_empty_library(client):
    r = client.get("/api/books")
    assert r.status_code == 200
    assert r.json() == []


def test_import_and_fetch(client, rbook_paths):
    with open(rbook_paths[0], "rb") as f:
        r = client.post(
            "/api/books/import-rbook",
            files={"file": (rbook_paths[0].name, f, "application/zip")},
        )
    assert r.status_code == 200, r.text
    summary = r.json()
    assert summary["page_count"] > 0

    r = client.get("/api/books")
    assert len(r.json()) == 1

    r = client.get(f"/api/books/{summary['id']}")
    assert r.status_code == 200
    detail = r.json()
    assert len(detail["pages"]) == summary["page_count"]
    page_with_image = next(p for p in detail["pages"] if p["image_url"])

    # media serving
    r = client.get(page_with_image["image_url"])
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/")

    # range support
    r = client.get(page_with_image["image_url"], headers={"Range": "bytes=0-99"})
    assert r.status_code == 206
    assert len(r.content) == 100


def test_media_traversal_blocked(client):
    r = client.get("/media/../../backend/app/main.py")
    assert r.status_code == 404


def test_delete_book(client, rbook_paths):
    with open(rbook_paths[0], "rb") as f:
        r = client.post(
            "/api/books/import-rbook",
            files={"file": (rbook_paths[0].name, f, "application/zip")},
        )
    book_id = r.json()["id"]
    assert client.delete(f"/api/books/{book_id}").status_code == 200
    assert client.get(f"/api/books/{book_id}").status_code == 404
    assert client.get("/api/books").json() == []
