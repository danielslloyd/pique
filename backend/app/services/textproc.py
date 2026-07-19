"""Tokenization shared with the frontend (lib/tokenize.ts): tokens are /\\S+/ runs.

Also provides the aligner-charset normalization used to map MMS_FA word spans back
onto display tokens: the aligner sees lowercase letters + apostrophes only, and a
single display token ("manta-ray") may produce several aligner words.
"""

import re
from dataclasses import dataclass

_TOKEN_RE = re.compile(r"\S+")
# Mirrors torchaudio MMS_FA dictionary: roman letters + apostrophe.
_ALIGNER_CHARSET_RE = re.compile(r"[^a-z']+")


@dataclass
class TokenInfo:
    display: str
    index: int
    aligner_words: list[str]  # how many aligner spans this token consumes (may be 0)


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text)


def aligner_words_for(token: str) -> list[str]:
    cleaned = _ALIGNER_CHARSET_RE.sub(" ", token.lower())
    return [w for w in cleaned.split() if w]


def map_spans_to_tokens(
    text: str, spans: list[dict]
) -> list[dict]:
    """Map aligner word spans (each {word, start_s, end_s}) onto display tokens.

    Returns one {word, start_ms, end_ms} per token, in order. Tokens producing
    multiple aligner words get the union span; tokens producing none (digits,
    punctuation-only) get zero-length timings interpolated from neighbors.
    """
    tokens = tokenize(text)
    result: list[dict] = []
    cursor = 0
    for token in tokens:
        words = aligner_words_for(token)
        if words and cursor + len(words) <= len(spans):
            first = spans[cursor]
            last = spans[cursor + len(words) - 1]
            cursor += len(words)
            result.append(
                {
                    "word": token,
                    "start_ms": int(first["start_s"] * 1000),
                    "end_ms": int(last["end_s"] * 1000),
                }
            )
        else:
            result.append({"word": token, "start_ms": -1, "end_ms": -1})

    # Interpolate zero-span tokens from neighbors.
    for i, item in enumerate(result):
        if item["start_ms"] >= 0:
            continue
        prev_end = next(
            (result[j]["end_ms"] for j in range(i - 1, -1, -1) if result[j]["start_ms"] >= 0), 0
        )
        item["start_ms"] = prev_end
        item["end_ms"] = prev_end
    return result
