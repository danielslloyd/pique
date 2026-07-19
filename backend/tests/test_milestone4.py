"""Milestone-4 backend tests: story drafting, wizard books, scene jobs, finalize.

All external GPU services (ComfyUI, Ollama, TTS) are mocked; nothing hits the
network. Background jobs are driven by polling the /api/jobs endpoint.
"""

import io
import time

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


@pytest.fixture(autouse=True)
def no_gpu(monkeypatch):
    """Neutralize GPU-coordinator transitions so nothing tries to reach a service."""
    from app.services import comfy_client, tts_client
    from app.services.gpu_coordinator import gpu

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(comfy_client, "evict_ollama", _noop)
    monkeypatch.setattr(comfy_client, "free_comfy", _noop)
    monkeypatch.setattr(tts_client, "unload", _noop)
    gpu.last_phase = None


def _png_bytes(color=(200, 100, 50), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _preset_id(client) -> int:
    return client.get("/api/styles").json()[0]["id"]


def _locked_character(client, style_id, name="Hero") -> int:
    """Create a character with a source photo, a ref crop, and lock it."""
    detail = client.post(
        "/api/characters",
        data={"name": name, "description": "a brave kid", "style_id": str(style_id)},
        files={"photo": ("p.png", _png_bytes(size=(100, 100)), "image/png")},
    ).json()
    cid = detail["id"]
    src_id = detail["images"][0]["id"]
    ref = client.post(
        f"/api/characters/{cid}/ref-crop",
        json={"image_id": src_id, "x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8},
    ).json()
    r = client.post(
        f"/api/characters/{cid}/lock",
        json={"ref_image_id": ref["id"], "identity_prompt": f"{name} in a red coat"},
    )
    assert r.status_code == 200, r.text
    return cid


def _wait_job(client, job_id, timeout=15.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["status"] in ("done", "error"):
            return body
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish")


# --- Story draft --------------------------------------------------------------


def test_story_draft_validates_and_retries(client, monkeypatch):
    from app.services import ollama_client

    style_id = _preset_id(client)
    cid = _locked_character(client, style_id)

    calls = {"n": 0}

    async def fake_chat(messages, schema, model=None, timeout=600):
        calls["n"] += 1
        if calls["n"] == 1:
            # 12-word sentence -> violates the 'k' level (max 8 words).
            return {
                "title": "Big Day",
                "pages": [
                    {
                        "page_no": 1,
                        "text": "one two three four five six seven eight nine ten "
                        "eleven twelve.",
                        "image_prompt": "a sunny field",
                    }
                ],
            }
        # Retry conversation carries the violation feedback.
        assert any("Fix these problems" in m["content"] for m in messages)
        return {
            "title": "Big Day",
            "pages": [
                {"page_no": 1, "text": "A cat ran home.", "image_prompt": "a cozy house"}
            ],
        }

    monkeypatch.setattr(ollama_client, "chat_json", fake_chat)

    r = client.post(
        "/api/stories/draft",
        json={
            "character_ids": [cid],
            "theme": "friendship",
            "reading_level": "k",
            "page_count": 1,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert calls["n"] == 2  # validation triggered exactly one retry
    assert body["title"] == "Big Day"
    assert body["pages"][0]["text"] == "A cat ran home."


def test_story_draft_requires_locked_characters(client, monkeypatch):
    from app.services import ollama_client

    async def fake_chat(*a, **k):  # pragma: no cover - should not be reached
        raise AssertionError("chat_json should not run for unlocked characters")

    monkeypatch.setattr(ollama_client, "chat_json", fake_chat)

    style_id = _preset_id(client)
    cid = client.post(
        "/api/characters",
        data={"name": "Draft", "description": "d", "style_id": str(style_id)},
    ).json()["id"]

    r = client.post(
        "/api/stories/draft",
        json={"character_ids": [cid], "theme": "t", "reading_level": "k"},
    )
    assert r.status_code == 400

    r = client.post(
        "/api/stories/draft",
        json={"character_ids": [9999], "theme": "t", "reading_level": "k"},
    )
    assert r.status_code == 404


# --- Wizard book creation -----------------------------------------------------


def test_wizard_book_creation(client):
    style_id = _preset_id(client)
    cid = _locked_character(client, style_id)

    r = client.post(
        "/api/books/wizard",
        json={
            "title": "My Story",
            "character_ids": [cid],
            "reading_level": "k",
            "pages": [
                {"text": "A cat ran.", "image_prompt": "a cat running"},
                {"text": "The cat slept.", "image_prompt": "a sleeping cat"},
            ],
        },
    )
    assert r.status_code == 200, r.text
    book = r.json()
    assert book["source"] == "wizard"
    assert book["status"] == "draft"
    assert book["reading_level"] == "k"
    assert len(book["pages"]) == 2
    assert book["pages"][0]["page_no"] == 1
    assert book["pages"][0]["image_prompt"] == "a cat running"
    assert book["pages"][0]["image_status"] == "pending"
    assert book["pages"][0]["image_seed"] is None


def test_wizard_book_requires_shared_style(client):
    styles = client.get("/api/styles").json()
    c1 = _locked_character(client, styles[0]["id"], name="A")
    c2 = _locked_character(client, styles[1]["id"], name="B")

    r = client.post(
        "/api/books/wizard",
        json={
            "title": "Mismatched",
            "character_ids": [c1, c2],
            "reading_level": "k",
            "pages": [{"text": "Hi.", "image_prompt": "scene"}],
        },
    )
    assert r.status_code == 400
    assert "share one style" in r.json()["detail"]


def test_wizard_book_requires_locked(client):
    style_id = _preset_id(client)
    cid = client.post(
        "/api/characters",
        data={"name": "Unlocked", "description": "d", "style_id": str(style_id)},
    ).json()["id"]
    r = client.post(
        "/api/books/wizard",
        json={
            "title": "T",
            "character_ids": [cid],
            "reading_level": "k",
            "pages": [{"text": "Hi.", "image_prompt": "s"}],
        },
    )
    assert r.status_code == 400


# --- Scene image job ----------------------------------------------------------


def _make_wizard_book(client, style_id, pages, name="Hero"):
    cid = _locked_character(client, style_id, name=name)
    r = client.post(
        "/api/books/wizard",
        json={
            "title": "Scene Book",
            "character_ids": [cid],
            "reading_level": "k",
            "pages": pages,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"], cid


def _mock_comfy(monkeypatch, captured=None):
    from app.services import comfy_client

    async def fake_upload(image_bytes, filename="input.png"):
        return "ref.png"

    async def fake_queue(workflow, client_id):
        if captured is not None:
            captured["workflow"] = workflow
        return "pid"

    async def fake_wait(prompt_id, on_progress=None, timeout_s=600):
        if on_progress:
            on_progress(1.0)
        return {"node": {"images": [{"filename": "out.png"}]}}

    async def fake_fetch(outputs):
        return [_png_bytes(size=(256, 256))]

    monkeypatch.setattr(comfy_client, "upload_image", fake_upload)
    monkeypatch.setattr(comfy_client, "queue_prompt", fake_queue)
    monkeypatch.setattr(comfy_client, "wait_for_completion", fake_wait)
    monkeypatch.setattr(comfy_client, "fetch_output_images", fake_fetch)


def test_scene_job_generates_candidate(client, monkeypatch):
    captured = {}
    _mock_comfy(monkeypatch, captured)
    style_id = _preset_id(client)
    book_id, _ = _make_wizard_book(
        client, style_id, [{"text": "A cat ran.", "image_prompt": "a cat running"}]
    )

    r = client.post(
        f"/api/books/{book_id}/pages/1/image",
        json={"seed": 4242, "prompt_override": "a cat leaping over the moon"},
    )
    assert r.status_code == 200, r.text
    job = _wait_job(client, r.json()["job_id"])
    assert job["status"] == "done", job.get("error")

    detail = client.get(f"/api/books/{book_id}").json()
    page = detail["pages"][0]
    assert page["image_status"] == "candidate"
    assert page["image_seed"] == 4242
    assert page["image_url"] is not None
    # prompt_override persisted to the page
    assert page["image_prompt"] == "a cat leaping over the moon"

    # The composed prompt reached the workflow via a PROMPT-titled node.
    wf = captured["workflow"]
    prompt_texts = [
        n["inputs"].get("text", "")
        for n in wf.values()
        if n.get("_meta", {}).get("title", "").startswith("PROMPT")
    ]
    assert any("a cat leaping over the moon" in t for t in prompt_texts)


def test_scene_job_missing_page_404(client, monkeypatch):
    _mock_comfy(monkeypatch)
    style_id = _preset_id(client)
    book_id, _ = _make_wizard_book(
        client, style_id, [{"text": "Hi.", "image_prompt": "s"}]
    )
    r = client.post(f"/api/books/{book_id}/pages/99/image", json={})
    assert r.status_code == 404


# --- Approve / patch ----------------------------------------------------------


def test_approve_and_patch_page(client, monkeypatch):
    _mock_comfy(monkeypatch)
    style_id = _preset_id(client)
    book_id, _ = _make_wizard_book(
        client, style_id, [{"text": "A cat ran.", "image_prompt": "a cat running"}]
    )

    # patch text on a draft book
    r = client.patch(
        f"/api/books/{book_id}/pages/1",
        json={"text": "A dog ran.", "image_prompt": "a dog running"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "A dog ran."
    assert r.json()["image_prompt"] == "a dog running"

    # approve the page
    r = client.post(f"/api/books/{book_id}/pages/1/approve")
    assert r.status_code == 200
    assert r.json() == {"approved": 1}
    detail = client.get(f"/api/books/{book_id}").json()
    assert detail["pages"][0]["image_status"] == "approved"


# --- Finalize -----------------------------------------------------------------


def test_finalize_flow(client, monkeypatch):
    from app.models import Book, Narration
    from app.routers import books as books_router

    _mock_comfy(monkeypatch)
    style_id = _preset_id(client)
    book_id, _ = _make_wizard_book(
        client,
        style_id,
        [
            {"text": "A cat ran fast.", "image_prompt": "a cat running"},
            {"text": "The cat slept.", "image_prompt": "a sleeping cat"},
        ],
    )

    # Give each page an image + approval.
    for page_no in (1, 2):
        r = client.post(
            f"/api/books/{book_id}/pages/{page_no}/image", json={"seed": 7}
        )
        _wait_job(client, r.json()["job_id"])
        assert client.post(f"/api/books/{book_id}/pages/{page_no}/approve").status_code == 200

    seen_status = {"during": []}

    async def fake_build(page, engine, voice, ref_audio, session, storage):
        b = session.get(Book, page.book_id)
        seen_status["during"].append(b.status)
        narration = Narration(
            book_id=page.book_id,
            page_id=page.id,
            engine=engine,
            voice_id=voice,
            audio_path=f"narrations/{page.book_id}/p{page.page_no}.wav",
            duration_s=1.0,
            sample_rate=24000,
        )
        session.add(narration)
        session.commit()
        session.refresh(narration)
        return narration

    async def fake_cache(word, engine, voice, session, storage):
        return f"word_audio/{engine}_{voice}/{word}.wav"

    monkeypatch.setattr(books_router, "build_page_narration", fake_build)
    monkeypatch.setattr(books_router, "cache_word_audio", fake_cache)

    r = client.post(f"/api/books/{book_id}/finalize", json={})
    assert r.status_code == 200, r.text
    job = _wait_job(client, r.json()["job_id"])
    assert job["status"] == "done", job.get("error")

    # narration ran while the book was in the 'generating' state
    assert seen_status["during"] and all(s == "generating" for s in seen_status["during"])

    detail = client.get(f"/api/books/{book_id}").json()
    assert detail["status"] == "ready"
    assert detail["thumbnail_url"] is not None  # first page image became thumbnail


def test_finalize_rejects_unapproved_pages(client, monkeypatch):
    _mock_comfy(monkeypatch)
    style_id = _preset_id(client)
    book_id, _ = _make_wizard_book(
        client, style_id, [{"text": "A cat ran.", "image_prompt": "a cat"}]
    )
    # pages are 'pending', never approved
    r = client.post(f"/api/books/{book_id}/finalize", json={})
    assert r.status_code == 400
    assert "approved" in r.json()["detail"]
