"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { playSuccessChime } from "@/lib/chime";
import { MatchController, type MatchEvent } from "@/lib/match-controller";
import {
  fetchNarration,
  getVoicePref,
  narrationAudioUrl,
  narrationQueryKey,
  NarrationUnavailableError,
  type Narration,
} from "@/lib/narration-api";
import { createProvider } from "@/lib/recognition";
import type { RecognitionProvider } from "@/lib/recognition/types";
import { splitSentences } from "@/lib/sentences";
import { findWordIndexAt } from "@/lib/timing";
import type { Token } from "@/lib/tokenize";
import { useReaderStore } from "@/stores/readerStore";

// Echo mode: guided, one-sentence-at-a-time practice. For each sentence the app first
// reads the sentence aloud (🔊, highlighting each word), then hands the turn to the
// child (🎤) with a fresh MatchController scoped to just that sentence's words. A
// sentence passes when the child reaches ≥70% of its words (or completes it). Strict
// pause/resume discipline keeps recognition off whenever the app is speaking.

const PASS_MESSAGES = ["Nice reading!", "You did it!", "Great job!", "Wonderful!", "Awesome!"];
const PASS_FRACTION = 0.7;
const BETWEEN_SENTENCES_MS = 900;

type Phase = "loading" | "reading" | "listening" | "celebrating" | "error";

interface Props {
  bookId: string | number;
  /** 1-based page number for the narration endpoint. */
  pageNo: number;
  /** Full page text — primes the Whisper session. */
  pageText: string;
  tokens: Token[];
  isLastPage?: boolean;
  onNext?: () => void;
}

export default function EchoController({ bookId, pageNo, pageText, tokens, isLastPage, onNext }: Props) {
  const setEchoReadingWord = useReaderStore((s) => s.setEchoReadingWord);
  const applyProgress = useReaderStore((s) => s.applyProgress);
  const showFeedback = useReaderStore((s) => s.showFeedback);

  const voice = useMemo(() => getVoicePref(), []);
  const sentences = useMemo(() => splitSentences(pageText), [pageText]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [sentenceIndex, setSentenceIndex] = useState(0);

  const narrationQuery = useQuery({
    queryKey: narrationQueryKey(bookId, pageNo, voice),
    queryFn: ({ signal }) =>
      fetchNarration(bookId, pageNo, { signal, engine: voice.engine, voice: voice.voice }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  const narration: Narration | undefined = narrationQuery.data;

  // --- refs shared by the machine ------------------------------------------
  const providerRef = useRef<RecognitionProvider | null>(null);
  const providerReadyRef = useRef(false);
  const controllerRef = useRef<MatchController | null>(null);
  const listeningRef = useRef(false); // gate: only feed hypotheses on the child's turn
  const wantListenRef = useRef(false); // resume as soon as the provider is ready
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("loading");
  const sentenceRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const goPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // --- recognition provider: created once, driven by the machine -----------
  useEffect(() => {
    let cancelled = false;
    createProvider(pageText).then((provider) => {
      if (cancelled) {
        provider.stop();
        return;
      }
      providerRef.current = provider;
      provider.start({
        onHypothesis: (words, isFinal) => {
          if (listeningRef.current) controllerRef.current?.feed(words, isFinal);
        },
        onStatus: () => {
          /* Echo shows its own 🔊/🎤 label from `phase`. */
        },
      });
      // Stay muted until the first listening turn.
      provider.pause();
      providerReadyRef.current = true;
      if (wantListenRef.current) provider.resume();
    });
    return () => {
      cancelled = true;
      providerRef.current?.stop();
      providerRef.current = null;
      providerReadyRef.current = false;
    };
  }, [pageText]);

  // --- dedicated audio element for narration slices ------------------------
  useEffect(() => {
    if (!narration) return;
    const audio = new Audio(narrationAudioUrl(narration));
    audio.preload = "auto";
    audioRef.current = audio;
    return () => {
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      audio.src = "";
      audioRef.current = null;
    };
  }, [narration]);

  // --- the sentence machine ------------------------------------------------
  useEffect(() => {
    if (!narration || startedRef.current) return;
    startedRef.current = true;

    if (sentences.length === 0) {
      goPhase("celebrating");
      playSuccessChime();
      return;
    }

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const matchTokensFor = (i: number): number[] => {
      const s = sentences[i];
      const idx: number[] = [];
      for (let t = s.tokenStart; t < s.tokenEnd; t++) {
        if (tokens[t]?.norm) idx.push(t);
      }
      return idx;
    };

    const runSentence = (i: number) => {
      sentenceRef.current = i;
      setSentenceIndex(i);
      // Reading phase — app speaks, recognition muted.
      goPhase("reading");
      listeningRef.current = false;
      wantListenRef.current = false;
      providerRef.current?.pause();
      playSlice(i, () => startListening(i));
    };

    const playSlice = (i: number, onDone: () => void) => {
      const s = sentences[i];
      const audio = audioRef.current;
      const spans = narration.words.filter((w) => w.i >= s.tokenStart && w.i < s.tokenEnd);
      if (!audio || spans.length === 0) {
        onDone();
        return;
      }
      const firstStart = spans[0].start_ms;
      const lastEnd = spans[spans.length - 1].end_ms;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        audio.removeEventListener("timeupdate", onTime);
        audio.removeEventListener("ended", finish);
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
        setEchoReadingWord(-1);
        onDone();
      };

      const onTime = () => {
        const ms = audio.currentTime * 1000;
        if (ms >= lastEnd - 30) {
          finish();
          return;
        }
        const idx = findWordIndexAt(ms, narration.words);
        if (idx >= 0) {
          const tok = narration.words[idx].i;
          if (tok >= s.tokenStart && tok < s.tokenEnd) setEchoReadingWord(tok);
        }
      };

      audio.addEventListener("timeupdate", onTime);
      audio.addEventListener("ended", finish);
      audio.currentTime = firstStart / 1000;
      void audio.play().catch(() => finish());
    };

    const startListening = (i: number) => {
      const matchTokens = matchTokensFor(i);
      if (matchTokens.length === 0) {
        passSentence(i);
        return;
      }
      const expected = matchTokens.map((t) => tokens[t].norm);
      const threshold = Math.max(1, Math.ceil(PASS_FRACTION * matchTokens.length));

      const controller = new MatchController(expected, (event: MatchEvent) => {
        if (event.type === "progress") {
          const read = event.read.map((m) => matchTokens[m]).filter((x): x is number => x !== undefined);
          const assisted = event.assisted
            .map((m) => matchTokens[m])
            .filter((x): x is number => x !== undefined);
          const nextToken = matchTokens[event.nextIndex] ?? sentences[i].tokenEnd;
          applyProgress(read, assisted, nextToken);
        }
        if (controller.wordIndex >= threshold || controller.done) passSentence(i);
      });
      controllerRef.current = controller;

      // Mark the sentence's first word as "current" before the child starts.
      applyProgress([], [], matchTokens[0]);

      goPhase("listening");
      listeningRef.current = true;
      wantListenRef.current = true;
      if (providerReadyRef.current) providerRef.current?.resume();
    };

    const passSentence = (i: number) => {
      if (phaseRef.current !== "listening" || sentenceRef.current !== i) return;
      listeningRef.current = false;
      wantListenRef.current = false;
      controllerRef.current = null;
      providerRef.current?.pause();

      const isLast = i >= sentences.length - 1;
      // Mark the whole sentence read so it turns green even on a ≥70% (partial) pass.
      const nextFirst = isLast ? sentences[i].tokenEnd : matchTokensFor(i + 1)[0] ?? sentences[i].tokenEnd;
      applyProgress(matchTokensFor(i), [], nextFirst);
      if (isLast) {
        goPhase("celebrating");
        playSuccessChime();
      } else {
        showFeedback("success", PASS_MESSAGES[Math.floor(Math.random() * PASS_MESSAGES.length)]);
        clearTimer();
        timerRef.current = setTimeout(() => runSentence(i + 1), BETWEEN_SENTENCES_MS);
      }
    };

    runSentence(0);

    return () => {
      clearTimer();
      listeningRef.current = false;
      wantListenRef.current = false;
      controllerRef.current = null;
      setEchoReadingWord(-1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration]);

  // --- render --------------------------------------------------------------
  if (narrationQuery.isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="text-5xl">🗣️</div>
        <p className="text-xl font-extrabold text-gray-500">Getting the story voice ready…</p>
      </div>
    );
  }

  if (narrationQuery.isError || !narration) {
    const msg =
      narrationQuery.error instanceof NarrationUnavailableError
        ? narrationQuery.error.message
        : "The story voice is having a nap. 😴";
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <p className="text-xl font-extrabold text-gray-500">{msg}</p>
        <button
          onClick={() => narrationQuery.refetch()}
          className="rounded-full px-8 py-3 text-xl font-extrabold text-white shadow"
          style={{ background: "var(--accent)" }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === "celebrating") {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="pop-in text-6xl">⭐️🎉⭐️</div>
        <p className="text-3xl font-black text-green-600">You read the whole page!</p>
        {isLastPage ? (
          <Link
            href="/"
            className="pop-in rounded-full px-8 py-3 text-2xl font-extrabold text-white shadow"
            style={{ background: "var(--leaf)" }}
          >
            The End! 🎉
          </Link>
        ) : (
          <button
            onClick={onNext}
            className="pop-in rounded-full px-8 py-3 text-2xl font-extrabold text-white shadow"
            style={{ background: "var(--accent)" }}
          >
            Next page →
          </button>
        )}
      </div>
    );
  }

  const isReading = phase === "reading";
  const total = sentences.length;
  return (
    <div className="flex flex-col items-center gap-3 py-5">
      <div
        className="flex items-center gap-3 rounded-full px-6 py-3 text-2xl font-extrabold shadow"
        style={{ background: isReading ? "var(--sky)" : "var(--leaf)", color: isReading ? "var(--ink)" : "white" }}
      >
        <span className="text-3xl">{isReading ? "🔊" : "🎤"}</span>
        {isReading ? "Listen…" : "Your turn — read it!"}
      </div>
      {total > 0 && (
        <p className="text-sm font-bold text-gray-400">
          Sentence {Math.min(sentenceIndex + 1, total)} of {total}
        </p>
      )}
    </div>
  );
}
