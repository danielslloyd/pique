// Word-timing lookup for Listen mode. Given the playhead position (ms) and the
// per-token narration spans, find which word is currently sounding.

export interface WordSpan {
  /** Token index into tokenize(page.text) — narration returns one span per token. */
  i: number;
  word: string;
  start_ms: number;
  end_ms: number;
}

/**
 * Return the index (into `spans`) of the span whose [start_ms, end_ms) contains `ms`,
 * or the nearest previous span when `ms` falls in a gap. Returns -1 before the first
 * span begins. Binary search over start_ms (spans are assumed sorted).
 */
export function findWordIndexAt(ms: number, spans: WordSpan[]): number {
  if (spans.length === 0 || ms < spans[0].start_ms) return -1;

  let lo = 0;
  let hi = spans.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].start_ms <= ms) {
      ans = mid; // candidate: rightmost span that has already started
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
