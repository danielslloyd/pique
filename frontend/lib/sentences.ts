// Sentence segmentation for Echo mode. Splits page text into sentences and maps each
// to a [tokenStart, tokenEnd) range over tokenize(text), so Echo can play a narration
// slice and match speech against exactly one sentence's words.

import { tokenize } from "./tokenize";

export interface Sentence {
  text: string;
  /** First token index (inclusive) belonging to this sentence. */
  tokenStart: number;
  /** One past the last token index (exclusive). */
  tokenEnd: number;
}

/**
 * Split on sentence-final punctuation followed by whitespace, then attach each token
 * (by its charStart offset) to the sentence whose character span contains it. Sentences
 * with no tokens (stray whitespace) are dropped.
 */
export function splitSentences(text: string): Sentence[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  // Character spans of each raw sentence piece.
  const spans: { startChar: number; endChar: number }[] = [];
  const re = /(?<=[.!?])\s+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ startChar: start, endChar: m.index });
    start = re.lastIndex;
  }
  spans.push({ startChar: start, endChar: text.length });

  const sentences: Sentence[] = [];
  for (const span of spans) {
    let tokenStart = -1;
    let tokenEnd = -1;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.charStart >= span.startChar && t.charStart < span.endChar) {
        if (tokenStart === -1) tokenStart = i;
        tokenEnd = i + 1;
      }
    }
    if (tokenStart === -1) continue; // no tokens in this span
    sentences.push({
      text: text.slice(span.startChar, span.endChar).trim(),
      tokenStart,
      tokenEnd,
    });
  }
  return sentences;
}
