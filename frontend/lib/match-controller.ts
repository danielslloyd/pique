// Read-mode matching engine. Ports the legacy word-pile design (accumulate every
// hypothesis word, march a cursor through expected words) with the M1 fixes:
// adaptive thresholds (word-match.ts), two-word lookahead with assisted marking,
// stuck detection that actually reaches the UI, and relaxed retry after word help.

import type { HypWord } from "./recognition/types";
import { wordsMatch } from "./word-match";

export type MatchEvent =
  | { type: "progress"; read: number[]; assisted: number[]; nextIndex: number }
  | { type: "stuck"; wordIndex: number; attempts: number }
  | { type: "complete" };

interface PileEntry {
  word: string;
  used: boolean;
}

const PILE_CAP = 40;
const LOOKAHEAD = 2;
const STUCK_AFTER_FINALS = 2;

export class MatchController {
  private pile: PileEntry[] = [];
  private cursor = -1; // last pile index consumed by a match
  private currentIndex = 0;
  private stuckFinals = 0;
  private relaxedIndices = new Set<number>();

  constructor(
    private expected: string[], // normalized expected words (empty-norm tokens excluded by caller)
    private emit: (event: MatchEvent) => void
  ) {}

  get wordIndex(): number {
    return this.currentIndex;
  }

  get done(): boolean {
    return this.currentIndex >= this.expected.length;
  }

  /** Loosen matching for one word (called after word-help audio plays). */
  relaxWord(index: number): void {
    this.relaxedIndices.add(index);
  }

  /** Skip the current word, marking it assisted (help exhausted or parent skip). */
  forceAdvance(): void {
    if (this.done) return;
    const idx = this.currentIndex;
    this.currentIndex++;
    this.stuckFinals = 0;
    this.emit({ type: "progress", read: [], assisted: [idx], nextIndex: this.currentIndex });
    if (this.done) this.emit({ type: "complete" });
  }

  feed(words: HypWord[], isFinal: boolean): void {
    if (this.done) return;
    for (const { word } of words) {
      this.pile.push({ word, used: false });
    }
    this.trimPile();

    const read: number[] = [];
    const assisted: number[] = [];

    for (;;) {
      const step = this.matchNext(isFinal);
      if (!step) break;
      assisted.push(...step.skipped);
      read.push(step.matched);
    }

    if (read.length > 0 || assisted.length > 0) {
      this.stuckFinals = 0;
      this.emit({ type: "progress", read, assisted, nextIndex: this.currentIndex });
      if (this.done) this.emit({ type: "complete" });
    } else if (isFinal) {
      this.stuckFinals++;
      if (this.stuckFinals >= STUCK_AFTER_FINALS && !this.done) {
        this.emit({ type: "stuck", wordIndex: this.currentIndex, attempts: this.stuckFinals });
      }
    }
  }

  /**
   * Try to advance one step: match expected[currentIndex], or (lookahead) match
   * expected[currentIndex + k] and mark the skipped words assisted. Fuzzy matching
   * is allowed for the current word any time; lookahead words need an exact hit
   * unless the hypothesis is final — interim garbage must not skip real words.
   */
  private matchNext(isFinal: boolean): { matched: number; skipped: number[] } | null {
    for (let k = 0; k <= LOOKAHEAD; k++) {
      const targetIndex = this.currentIndex + k;
      if (targetIndex >= this.expected.length) break;
      const target = this.expected[targetIndex];
      const relaxed = this.relaxedIndices.has(targetIndex);
      const exactOnly = k > 0 && !isFinal;

      for (let i = this.cursor + 1; i < this.pile.length; i++) {
        const entry = this.pile[i];
        if (entry.used) continue;
        const hit = exactOnly
          ? entry.word.toLowerCase().replace(/[^\w]/g, "") === target
          : wordsMatch(entry.word, target, { relaxed });
        if (hit) {
          entry.used = true;
          this.cursor = i;
          const skipped: number[] = [];
          for (let s = this.currentIndex; s < targetIndex; s++) skipped.push(s);
          this.currentIndex = targetIndex + 1;
          return { matched: targetIndex, skipped };
        }
      }
    }
    return null;
  }

  private trimPile(): void {
    if (this.pile.length > PILE_CAP) {
      const drop = this.pile.length - PILE_CAP;
      this.pile.splice(0, drop);
      this.cursor = Math.max(-1, this.cursor - drop);
    }
  }
}
