// Word matching tuned for early readers. Ported from the legacy WordMatcher with:
//  - adaptive edit-distance thresholds by word length (flat 0.8 rejected short words)
//  - symmetric kid-speech equivalences instead of the old one-way substitution chain
//  - homophone table retained

import { normalizeWord } from "./tokenize";

const HOMOPHONES: Record<string, string[]> = {
  there: ["their", "theyre"],
  their: ["there", "theyre"],
  theyre: ["there", "their"],
  to: ["too", "two", "2"],
  too: ["to", "two", "2"],
  two: ["to", "too", "2"],
  "2": ["to", "too", "two"],
  your: ["youre"],
  youre: ["your"],
  here: ["hear"],
  hear: ["here"],
  where: ["wear", "wears"],
  wear: ["where"],
  no: ["know"],
  know: ["no"],
  by: ["bye", "buy"],
  bye: ["by", "buy"],
  buy: ["by", "bye"],
  for: ["four", "4"],
  four: ["for", "4"],
  "4": ["four", "for"],
  one: ["won", "1"],
  won: ["one", "1"],
  "1": ["one", "won"],
  right: ["write"],
  write: ["right"],
  see: ["sea"],
  sea: ["see"],
  eight: ["8", "ate"],
  ate: ["eight", "8"],
  "8": ["eight", "ate"],
  three: ["3"],
  "3": ["three"],
  five: ["5"],
  "5": ["five"],
  six: ["6"],
  "6": ["six"],
  seven: ["7"],
  "7": ["seven"],
  nine: ["9"],
  "9": ["nine"],
  ten: ["10"],
  "10": ["ten"],
  zero: ["0"],
  "0": ["zero"],
};

export function areHomophones(a: string, b: string): boolean {
  return HOMOPHONES[a]?.includes(b) ?? false;
}

/**
 * Symmetric kid-speech canonicalization: common early-reader articulation swaps
 * (th->d, r->w, l->w, etc.) applied to BOTH words so "wabbit" ~ "rabbit" and the
 * mapping can't chain against itself the way the old s->sh->s substitutions did.
 */
export function kidSpeechCanonical(word: string): string {
  return word
    .replace(/th/g, "d")
    .replace(/ph/g, "f")
    .replace(/r/g, "w")
    .replace(/l/g, "w")
    .replace(/ing\b/g, "in")
    .replace(/s\b/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Max edit distance allowed for a word of the given (normalized) length. */
export function allowedDistance(len: number, relaxed = false): number {
  if (len <= 3) return relaxed ? 1 : 0;
  if (len <= 5) return relaxed ? 2 : 1;
  return relaxed ? 3 : 2;
}

export interface MatchOptions {
  /** Loosen thresholds one notch (used on retry after word help). */
  relaxed?: boolean;
}

/**
 * Decide whether a spoken word counts as a correct reading of the expected word.
 * Both inputs may be raw (un-normalized).
 */
export function wordsMatch(spoken: string, expected: string, opts: MatchOptions = {}): boolean {
  const s = normalizeWord(spoken);
  const e = normalizeWord(expected);
  if (!s || !e) return false;
  if (s === e) return true;
  if (areHomophones(s, e) || areHomophones(e, s)) return true;

  const relaxed = opts.relaxed ?? false;
  const budget = allowedDistance(e.length, relaxed);
  if (budget > 0 && levenshtein(s, e) <= budget) return true;

  // Kid-speech articulation equivalence (both sides canonicalized).
  const ks = kidSpeechCanonical(s);
  const ke = kidSpeechCanonical(e);
  if (ks && ks === ke) return true;
  if (budget > 0 && ks && ke && levenshtein(ks, ke) <= Math.max(0, budget - 1)) return true;

  return false;
}
