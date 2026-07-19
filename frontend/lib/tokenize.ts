// THE single tokenizer. Highlighting, matching, and word-timing lookup all use this,
// so word indices always agree across subsystems.

export interface Token {
  /** The word as displayed, punctuation included. */
  display: string;
  /** Normalized form used for matching: lowercased, punctuation stripped. */
  norm: string;
  charStart: number;
  charEnd: number;
}

export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({
      display: match[0],
      norm: normalizeWord(match[0]),
      charStart: match.index,
      charEnd: match.index + match[0].length,
    });
  }
  return tokens;
}
