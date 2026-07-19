from app.services.rbook_import import find_existing_import, import_rbook


def test_import_real_rbooks(session, storage, rbook_paths):
    for path in rbook_paths:
        book = import_rbook(path.read_bytes(), session, storage)
        assert book.id is not None
        assert book.title
        assert book.source == "imported"

        from sqlmodel import select

        from app.models import Page

        pages = session.exec(select(Page).where(Page.book_id == book.id)).all()
        assert len(pages) > 0
        for page in pages:
            assert page.text.strip()
        pages_with_images = [p for p in pages if p.image_path]
        assert pages_with_images, "expected at least one page image"
        for page in pages_with_images:
            assert storage.path_for(page.image_path).is_file()


def test_idempotency_check(session, storage, rbook_paths):
    book = import_rbook(rbook_paths[0].read_bytes(), session, storage)
    assert find_existing_import(session, book.title) is not None
    assert find_existing_import(session, "definitely-not-a-title") is None


def test_invalid_rbook_rejected(session, storage):
    import pytest

    with pytest.raises(ValueError):
        import_rbook(b"not a zip at all", session, storage)
