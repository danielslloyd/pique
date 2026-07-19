from app.services.textproc import aligner_words_for, map_spans_to_tokens, tokenize


def test_tokenize_matches_frontend_rule():
    # Same /\S+/ rule as frontend lib/tokenize.ts — multi-space and newlines collapse.
    assert tokenize("This  is a\nkangaroo.") == ["This", "is", "a", "kangaroo."]


def test_aligner_words_split_hyphens():
    assert aligner_words_for("manta-ray.") == ["manta", "ray"]
    assert aligner_words_for("'Try") == ["'try"]
    assert aligner_words_for("2") == []  # digits are outside the MMS charset


def test_map_spans_simple():
    spans = [
        {"word": "this", "start_s": 0.1, "end_s": 0.3},
        {"word": "is", "start_s": 0.35, "end_s": 0.5},
        {"word": "a", "start_s": 0.55, "end_s": 0.6},
        {"word": "kangaroo", "start_s": 0.7, "end_s": 1.4},
    ]
    out = map_spans_to_tokens("This is a kangaroo.", spans)
    assert [t["word"] for t in out] == ["This", "is", "a", "kangaroo."]
    assert out[0]["start_ms"] == 100
    assert out[3]["end_ms"] == 1400


def test_map_spans_multiword_token():
    spans = [
        {"word": "a", "start_s": 0.0, "end_s": 0.1},
        {"word": "manta", "start_s": 0.2, "end_s": 0.5},
        {"word": "ray", "start_s": 0.55, "end_s": 0.8},
    ]
    out = map_spans_to_tokens("a manta-ray.", spans)
    assert len(out) == 2
    assert out[1]["start_ms"] == 200 and out[1]["end_ms"] == 800  # union span


def test_map_spans_interpolates_unalignable():
    spans = [
        {"word": "page", "start_s": 0.0, "end_s": 0.4},
        {"word": "two", "start_s": 0.5, "end_s": 0.8},
    ]
    # "2" produces no aligner words -> zero-length timing at previous end.
    out = map_spans_to_tokens("page 2 two", spans)
    assert out[1]["start_ms"] == out[1]["end_ms"] == 400
