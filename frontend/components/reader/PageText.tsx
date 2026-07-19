"use client";

import type { Token } from "@/lib/tokenize";
import type { WordState } from "@/stores/readerStore";

interface Props {
  tokens: Token[];
  /** State per token (punctuation-only tokens ride along as pending). */
  states: WordState[];
  /** Emphasize the current word (after the reader gets stuck). */
  emphasizeCurrent?: boolean;
  /** Token index of a word currently playing help audio — pulses/enlarges it. */
  pulsingIndex?: number;
  onWordTap?: (tokenIndex: number) => void;
}

export default function PageText({ tokens, states, emphasizeCurrent, pulsingIndex, onWordTap }: Props) {
  return (
    <p className="text-4xl font-bold leading-relaxed tracking-wide md:text-5xl">
      {tokens.map((token, i) => {
        const state = states[i] ?? "pending";
        const emphasized = emphasizeCurrent && state === "current";
        const pulsing = pulsingIndex === i;
        return (
          <span key={`${token.charStart}-${i}`}>
            <span
              className={`word word-${state}${pulsing ? " word-playing" : ""}`}
              style={emphasized ? { fontSize: "1.35em" } : undefined}
              onClick={() => onWordTap?.(i)}
            >
              {token.display}
            </span>{" "}
          </span>
        );
      })}
    </p>
  );
}
