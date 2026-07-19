import asyncio
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import config, db

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(db, "_engine", None)

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
    db._engine = None


def _png_bytes(color=(200, 100, 50), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _preset_id(client) -> int:
    styles = client.get("/api/styles").json()
    assert styles, "expected seeded preset styles"
    return styles[0]["id"]


# --- Styles -------------------------------------------------------------------


def test_styles_list_presets_first(client):
    styles = client.get("/api/styles").json()
    assert len(styles) == 5
    assert all(s["is_preset"] for s in styles)


def test_styles_crud_and_preset_protection(client):
    presets = client.get("/api/styles").json()
    preset_id = presets[0]["id"]

    # preset cannot be patched or deleted
    assert client.patch(f"/api/styles/{preset_id}", json={"name": "x"}).status_code == 409
    assert client.delete(f"/api/styles/{preset_id}").status_code == 409

    # create custom
    r = client.post(
        "/api/styles",
        json={"name": "my_style", "master_prompt": "a prompt", "negative_prompt": "no"},
    )
    assert r.status_code == 200, r.text
    custom = r.json()
    assert custom["is_preset"] is False

    # custom appears after presets
    listing = client.get("/api/styles").json()
    assert listing[-1]["id"] == custom["id"]

    # patch custom
    r = client.patch(f"/api/styles/{custom['id']}", json={"name": "renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"

    # delete custom
    assert client.delete(f"/api/styles/{custom['id']}").status_code == 200


def test_style_delete_blocked_when_referenced(client):
    r = client.post("/api/styles", json={"name": "used", "master_prompt": "p"})
    style_id = r.json()["id"]
    # reference it from a character
    client.post(
        "/api/characters",
        data={"name": "Ref", "description": "d", "style_id": str(style_id)},
    )
    assert client.delete(f"/api/styles/{style_id}").status_code == 409


# --- Character creation -------------------------------------------------------


def test_create_character_text_only(client):
    style_id = _preset_id(client)
    r = client.post(
        "/api/characters",
        data={"name": "Maya", "description": "a brave girl", "style_id": str(style_id)},
    )
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["name"] == "Maya"
    assert detail["status"] == "draft"
    assert detail["style"]["id"] == style_id
    assert detail["source_photo_url"] is None
    assert detail["images"] == []


def test_create_character_with_photo(client):
    style_id = _preset_id(client)
    r = client.post(
        "/api/characters",
        data={"name": "Leo", "description": "a boy", "style_id": str(style_id)},
        files={"photo": ("leo.png", _png_bytes(), "image/png")},
    )
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["source_photo_url"] is not None
    kinds = [im["kind"] for im in detail["images"]]
    assert "source_photo" in kinds

    # thumbnail resolves to the source photo, media serves it
    summary = client.get("/api/characters").json()[0]
    assert summary["thumbnail_url"] is not None
    assert client.get(summary["thumbnail_url"]).status_code == 200


# --- Ref crop -----------------------------------------------------------------


def test_ref_crop(client):
    style_id = _preset_id(client)
    detail = client.post(
        "/api/characters",
        data={"name": "Cropme", "description": "d", "style_id": str(style_id)},
        files={"photo": ("p.png", _png_bytes(size=(100, 100)), "image/png")},
    ).json()
    src_id = next(im["id"] for im in detail["images"] if im["kind"] == "source_photo")

    r = client.post(
        f"/api/characters/{detail['id']}/ref-crop",
        json={"image_id": src_id, "x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5},
    )
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["kind"] == "ref_crop"
    assert client.get(rec["url"]).status_code == 200

    # crop is now the character's ref image
    after = client.get(f"/api/characters/{detail['id']}").json()
    assert after["ref_image_url"] is not None


def test_ref_crop_invalid_rectangle(client):
    style_id = _preset_id(client)
    detail = client.post(
        "/api/characters",
        data={"name": "Bad", "description": "d", "style_id": str(style_id)},
        files={"photo": ("p.png", _png_bytes(), "image/png")},
    ).json()
    src_id = detail["images"][0]["id"]
    r = client.post(
        f"/api/characters/{detail['id']}/ref-crop",
        json={"image_id": src_id, "x": 0.5, "y": 0.5, "w": 0.0, "h": 0.0},
    )
    assert r.status_code == 400


# --- Lock / unlock ------------------------------------------------------------


def test_lock_requires_ref_and_identity(client):
    style_id = _preset_id(client)
    cid = client.post(
        "/api/characters",
        data={"name": "L", "description": "d", "style_id": str(style_id)},
    ).json()["id"]

    # no ref image yet
    assert client.post(f"/api/characters/{cid}/lock", json={}).status_code == 400

    # add ref via crop of a source photo
    client.post(
        "/api/characters",
        data={"name": "ignore", "description": "d", "style_id": str(style_id)},
    )
    # give the character a source + ref
    detail = client.post(
        "/api/characters",
        data={"name": "L2", "description": "d", "style_id": str(style_id)},
        files={"photo": ("p.png", _png_bytes(), "image/png")},
    ).json()
    cid2 = detail["id"]
    src_id = detail["images"][0]["id"]
    ref = client.post(
        f"/api/characters/{cid2}/ref-crop",
        json={"image_id": src_id, "x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8},
    ).json()

    # ref present but no identity prompt -> 400
    assert client.post(f"/api/characters/{cid2}/lock", json={}).status_code == 400

    # provide identity prompt inline -> locked
    r = client.post(
        f"/api/characters/{cid2}/lock",
        json={"ref_image_id": ref["id"], "identity_prompt": "A kid in red"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "locked"

    # already locked -> 409
    assert client.post(f"/api/characters/{cid2}/lock", json={}).status_code == 409

    # locked character cannot be patched
    assert client.patch(f"/api/characters/{cid2}", json={"name": "no"}).status_code == 409

    # unlock returns to draft
    r = client.post(f"/api/characters/{cid2}/unlock")
    assert r.status_code == 200
    assert r.json()["status"] == "draft"


# --- Legacy import ------------------------------------------------------------


def _legacy_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        manifest = [
            {
                "name": "Ruby",
                "description": "red hair",
                "tags": ["hero"],
                "attributes": {"age": 7},
                "artStyle": "children_book",
                "primaryImage": "ruby_1.png",
                "images": ["ruby_1.png", "ruby_2.png"],
            },
            {
                "name": "Bolt",
                "description": "a dog",
                "tags": [],
                "attributes": {},
                "artStyle": "bold_cartoon",
                "primaryImage": None,
                "images": ["bolt.png"],
            },
            {"name": "Broken"},  # tolerated: no images, still creates a draft
        ]
        z.writestr("characters.json", json.dumps(manifest))
        z.writestr("images/ruby_1.png", _png_bytes((255, 0, 0)))
        z.writestr("images/ruby_2.png", _png_bytes((0, 255, 0)))
        z.writestr("images/bolt.png", _png_bytes((0, 0, 255)))
    return buf.getvalue()


def test_import_legacy_roundtrip(client):
    r = client.post(
        "/api/characters/import-legacy",
        files={"file": ("export.zip", _legacy_zip(), "application/zip")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 3
    assert len(body["characters"]) == 3

    # Ruby: mapped style + primary stored as sheet + base candidates
    ruby_id = body["characters"][0]
    ruby = client.get(f"/api/characters/{ruby_id}").json()
    assert ruby["style"]["name"] == "storybook_watercolor"
    assert ruby["sheet_image_url"] is not None
    kinds = sorted(im["kind"] for im in ruby["images"])
    assert kinds == ["base_candidate", "base_candidate", "sheet"]

    # Bolt: mapped bold_cartoon, no sheet
    bolt = client.get(f"/api/characters/{body['characters'][1]}").json()
    assert bolt["style"]["name"] == "bold_cartoon"
    assert bolt["sheet_image_url"] is None


def test_import_legacy_bad_zip(client):
    r = client.post(
        "/api/characters/import-legacy",
        files={"file": ("x.zip", b"not a zip", "application/zip")},
    )
    assert r.status_code == 400


# --- Job runner ---------------------------------------------------------------


def test_job_runner_lifecycle(tmp_path, monkeypatch):
    from app import config, db

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(db, "_engine", None)
    db.create_tables()

    from sqlmodel import Session

    from app.models import Job
    from app.services.job_runner import start_job

    seen = []

    async def factory(report):
        report(0.25)
        seen.append(0.25)
        report(0.75)
        return {"ok": True, "value": 42}

    async def run():
        job_id = start_job("test", factory)
        for _ in range(100):
            with Session(db.get_engine()) as s:
                job = s.get(Job, job_id)
                if job and job.status in ("done", "error"):
                    return job.status, job.result_json, job.progress, job.error
            await asyncio.sleep(0.02)
        return "timeout", None, None, None

    status, result_json, progress, error = asyncio.run(run())
    db._engine = None

    assert status == "done", error
    assert json.loads(result_json) == {"ok": True, "value": 42}
    assert progress == 1.0
    assert seen == [0.25]


def test_job_endpoint_reports_status(tmp_path, monkeypatch):
    from app import config, db

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(db, "_engine", None)
    db.create_tables()

    from sqlmodel import Session

    from app.models import Job
    from app.services.job_runner import start_job

    async def factory(report):
        return {"done": 1}

    async def run():
        job_id = start_job("test", factory)
        for _ in range(100):
            with Session(db.get_engine()) as s:
                job = s.get(Job, job_id)
                if job and job.status == "done":
                    break
            await asyncio.sleep(0.02)
        return job_id

    job_id = asyncio.run(run())

    from app.main import create_app

    with TestClient(create_app()) as c:
        r = c.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "done"
        assert body["result"] == {"done": 1}
        assert c.get("/api/jobs/nonexistent").status_code == 404
    db._engine = None
