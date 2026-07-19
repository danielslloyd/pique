"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import EchoController from "@/components/reader/EchoController";
import FeedbackToast from "@/components/reader/FeedbackToast";
import ListenController, { type ListenControllerHandle } from "@/components/reader/ListenController";
import PageText from "@/components/reader/PageText";
import { getBook, mediaUrl } from "@/lib/api";
import * as audioManager from "@/lib/audio-manager";
import { playSuccessChime } from "@/lib/chime";
import { MatchController, type MatchEvent } from "@/lib/match-controller";
import { getVoicePref, wordAudioUrl } from "@/lib/narration-api";
import { createProvider } from "@/lib/recognition";
import type { RecognitionProvider } from "@/lib/recognition/types";
import { tokenize } from "@/lib/tokenize";
import { useReaderStore, type ReaderMode, type WordState } from "@/stores/readerStore";

// M2: Listen mode, word-by-word highlighting, word-help audio, and read-back reward.
const ENCOURAGEMENTS = ["Good!", "Nice reading!", "Keep going!", "You've got it!"];
/** Number of stuck events on the same word before we assist-advance past it. */
const HELP_LIMIT = 2;

/** Word states for narration playback: only the sounding word is highlighted. */
function listenStates(count: number, currentIndex: number): WordState[] {
  const states = new Array<WordState>(count).fill("pending");
  if (currentIndex >= 0 && currentIndex < count) states[currentIndex] = "current";
  return states;
}

export default function ReadPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });

  const mode = useReaderStore((s) => s.mode);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const wordStates = useReaderStore((s) => s.wordStates);
  const pictureRevealed = useReaderStore((s) => s.pictureRevealed);
  const recognitionStatus = useReaderStore((s) => s.recognitionStatus);
  const listenWordIndex = useReaderStore((s) => s.listenWordIndex);
  const setMode = useReaderStore((s) => s.setMode);
  const setPage = useReaderStore((s) => s.setPage);
  const applyProgress = useReaderStore((s) => s.applyProgress);
  const revealPicture = useReaderStore((s) => s.revealPicture);
  const setRecognitionStatus = useReaderStore((s) => s.setRecognitionStatus);
  const showFeedback = useReaderStore((s) => s.showFeedback);

  const [emphasizeCurrent, setEmphasizeCurrent] = useState(false);
  const [assistedCount, setAssistedCount] = useState(0);
  const [pulsingTokenIndex, setPulsingTokenIndex] = useState(-1);
  const [readBackActive, setReadBackActive] = useState(false);

  const providerRef = useRef<RecognitionProvider | null>(null);
  const controllerRef = useRef<MatchController | null>(null);
  const listenRef = useRef<ListenControllerHandle | null>(null);
  /** Per-word (match-index) count of stuck events, so the 2nd triggers assist-advance. */
  const helpCountsRef = useRef<Record<number, number>>({});
  /** Live mirror of pictureRevealed for use inside audio callbacks. */
  const pictureRevealedRef = useRef(false);
  pictureRevealedRef.current = pictureRevealed;

  const book = bookQuery.data;
  const page = book?.pages[pageIndex];

  const tokens = useMemo(() => (page ? tokenize(page.text) : []), [page]);
  /** Indices of tokens that require matching (non-empty normalized form). */
  const matchableTokenIdx = useMemo(
    () => tokens.map((t, i) => ({ norm: t.norm, i })).filter((t) => t.norm).map((t) => t.i),
    [tokens]
  );

  const toTokenIndices = useCallback(
    (matchIndices: number[]) => matchIndices.map((m) => matchableTokenIdx[m]).filter((i) => i !== undefined),
    [matchableTokenIdx]
  );

  // Plays a single word's help audio, muting recognition while it sounds.
  const playWordHelp = useCallback((normalized: string, tokenIndex: number) => {
    if (!normalized) return;
    setPulsingTokenIndex(tokenIndex);
    const voice = getVoicePref();
    audioManager.playUrl(wordAudioUrl(normalized, { engine: voice.engine, voice: voice.voice }), {
      onStart: () => providerRef.current?.pause(),
      onEnd: () => {
        setPulsingTokenIndex(-1);
        // Only breathe recognition back to life if the reader is still working the page.
        if (!pictureRevealedRef.current) providerRef.current?.resume();
      },
    });
  }, []);

  // (Re)start the reading session whenever the page changes — Read mode only.
  useEffect(() => {
    if (!page || tokens.length === 0) return;
    if (mode !== "read") return; // Listen mode never starts recognition.

    setPage(pageIndex, tokens.length);
    setEmphasizeCurrent(false);
    setAssistedCount(0);
    setPulsingTokenIndex(-1);
    helpCountsRef.current = {};

    const expected = matchableTokenIdx.map((i) => tokens[i].norm);
    const controller = new MatchController(expected, (event: MatchEvent) => {
      if (event.type === "progress") {
        const nextTokenIdx = matchableTokenIdx[event.nextIndex] ?? tokens.length;
        applyProgress(toTokenIndices(event.read), toTokenIndices(event.assisted), nextTokenIdx);
        setEmphasizeCurrent(false);
        setAssistedCount((n) => n + event.assisted.length);
        if (event.read.length > 0) {
          showFeedback("success", ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]);
        }
      } else if (event.type === "stuck") {
        const matchIndex = event.wordIndex;
        const tokenIdx = matchableTokenIdx[matchIndex];
        const token = tokens[tokenIdx];
        const count = (helpCountsRef.current[matchIndex] ?? 0) + 1;
        helpCountsRef.current[matchIndex] = count;

        if (count >= HELP_LIMIT) {
          // Second stuck on the same word: assist past it, encouragingly.
          showFeedback("encourage", "Let's keep going — we'll practice that one later!");
          setEmphasizeCurrent(false);
          controller.forceAdvance();
        } else {
          showFeedback("encourage", `Let's try the word "${token?.display ?? ""}"`);
          setEmphasizeCurrent(true);
          controller.relaxWord(matchIndex);
          // Auto-help: sound the word out, muting the mic while it plays.
          if (token?.norm) playWordHelp(token.norm, tokenIdx);
        }
      } else if (event.type === "complete") {
        revealPicture();
        playSuccessChime();
        providerRef.current?.pause();
      }
    });
    controllerRef.current = controller;

    // Provider selection is async (it may probe /api/asr/capabilities). Guard against the
    // cleanup running before the promise resolves.
    let cancelled = false;
    createProvider(page.text).then((provider) => {
      if (cancelled) {
        provider.stop();
        return;
      }
      providerRef.current = provider;
      provider.start({
        onHypothesis: (words, isFinal) => controller.feed(words, isFinal),
        onStatus: (status, detail) => {
          setRecognitionStatus(status);
          if (status === "unsupported") showFeedback("error", detail ?? "Speech recognition unavailable");
          if (status === "error") {
            const friendly =
              detail === "not-allowed" || detail === "service-not-allowed"
                ? "Pique needs the microphone — click Allow in the address bar!"
                : detail ?? "Speech recognition had a problem";
            showFeedback("error", friendly);
          }
        },
      });
    });

    return () => {
      cancelled = true;
      providerRef.current?.stop();
      providerRef.current = null;
      controllerRef.current = null;
    };
  }, [
    page,
    tokens,
    matchableTokenIdx,
    pageIndex,
    mode,
    applyProgress,
    revealPicture,
    setPage,
    setRecognitionStatus,
    showFeedback,
    toTokenIndices,
    playWordHelp,
  ]);

  // Echo mode: reset the page's word states so the sentence machine starts clean.
  useEffect(() => {
    if (mode !== "echo" || !page) return;
    setPage(pageIndex, tokens.length);
    setPulsingTokenIndex(-1);
  }, [mode, page, pageIndex, tokens.length, setPage]);

  // Parent keyboard shortcuts: ctrl/cmd+S skip word, ctrl/cmd+P reveal picture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        controllerRef.current?.forceAdvance();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        revealPicture();
        providerRef.current?.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealPicture]);

  const switchMode = useCallback(
    (next: ReaderMode) => {
      if (next === mode) return;
      audioManager.cancel(); // stop any word-help clip cleanly
      setReadBackActive(false);
      setPulsingTokenIndex(-1);
      setMode(next);
    },
    [mode, setMode]
  );

  const startReadBack = useCallback(() => {
    // Recognition was already paused at completion; make doubly sure before narration.
    providerRef.current?.pause();
    audioManager.cancel();
    setReadBackActive(true);
  }, []);

  const goToPage = useCallback(
    (nextIndex: number) => {
      audioManager.cancel();
      setReadBackActive(false);
      setPage(nextIndex, 0);
    },
    [setPage]
  );

  const handleWordTap = useCallback(
    (tokenIndex: number) => {
      if (mode === "listen" || readBackActive) {
        listenRef.current?.seekToToken(tokenIndex);
        return;
      }
      // Echo owns strict pause/resume discipline; a tap must not start app audio mid-turn.
      if (mode === "echo") return;
      const token = tokens[tokenIndex];
      if (token?.norm) playWordHelp(token.norm, tokenIndex);
    },
    [mode, readBackActive, tokens, playWordHelp]
  );

  if (bookQuery.isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-2xl font-bold">Loading…</main>;
  }
  if (bookQuery.isError || !book) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-2xl font-bold">Couldn&apos;t load this book.</p>
        <Link href="/" className="rounded-full bg-white px-6 py-3 font-bold text-gray-500 shadow">
          Back to My Books
        </Link>
      </main>
    );
  }
  if (!page) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-2xl font-bold">This book has no pages.</p>
        <Link href="/" className="rounded-full bg-white px-6 py-3 font-bold text-gray-500 shadow">
          Back to My Books
        </Link>
      </main>
    );
  }

  const isLastPage = pageIndex >= book.pages.length - 1;
  const imageSrc = mediaUrl(page.image_url);
  const listenActive = mode === "listen" || readBackActive;
  const showLock = mode === "read" && !readBackActive && !pictureRevealed;
  const displayStates = listenActive ? listenStates(tokens.length, listenWordIndex) : wordStates;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-6">
      <header className="mb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link href="/" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-gray-500 shadow">
            ← Library
          </Link>
          <ModeSwitcher mode={mode} onSelect={switchMode} />
          {mode === "read" ? <MicBadge status={recognitionStatus} /> : <div className="w-24" />}
        </div>
        <div className="text-center text-lg font-extrabold text-gray-400">
          {book.title} · {pageIndex + 1}/{book.pages.length}
        </div>
      </header>

      <section className="relative mb-6 aspect-[4/3] w-full overflow-hidden rounded-3xl bg-white shadow-md">
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt="" className="h-full w-full object-contain" />
        )}
        {showLock && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: "var(--sky)" }}
          >
            <div className="text-7xl">🔒</div>
            <p className="text-2xl font-extrabold text-gray-500">Read the words to see the picture!</p>
          </div>
        )}
        {pictureRevealed && (
          <div className="pop-in absolute right-4 top-4 rounded-full bg-white/90 px-4 py-2 text-lg font-extrabold text-green-600 shadow">
            {assistedCount === 0 ? "⭐ All by yourself!" : `⭐ ${matchableTokenIdx.length - assistedCount}/${matchableTokenIdx.length} solo`}
          </div>
        )}
      </section>

      <section className="rounded-3xl bg-white p-8 shadow-md">
        <PageText
          tokens={tokens}
          states={displayStates}
          emphasizeCurrent={mode === "read" && !readBackActive && emphasizeCurrent}
          pulsingIndex={mode === "read" && !readBackActive ? pulsingTokenIndex : -1}
          onWordTap={handleWordTap}
        />
      </section>

      {mode === "listen" && (
        <ListenController
          key={`listen-${page.page_no}`}
          ref={listenRef}
          bookId={bookId}
          pageNo={page.page_no}
          variant="listen"
          isLastPage={isLastPage}
          onNext={() => goToPage(pageIndex + 1)}
        />
      )}

      {mode === "read" && readBackActive && (
        <ListenController
          key={`readback-${page.page_no}`}
          ref={listenRef}
          bookId={bookId}
          pageNo={page.page_no}
          variant="readback"
          autoPlay
          onReturn={() => setReadBackActive(false)}
        />
      )}

      {mode === "echo" && (
        <EchoController
          key={`echo-${page.page_no}`}
          bookId={bookId}
          pageNo={page.page_no}
          pageText={page.text}
          tokens={tokens}
          isLastPage={isLastPage}
          onNext={() => goToPage(pageIndex + 1)}
        />
      )}

      {mode === "read" && !readBackActive && pictureRevealed && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={startReadBack}
            className="pop-in rounded-full px-8 py-4 text-2xl font-extrabold text-white shadow-lg transition-transform active:scale-95"
            style={{ background: "var(--leaf)" }}
          >
            🎧 Read it back to me!
          </button>
        </div>
      )}

      <footer className="mt-6 flex items-center justify-between">
        <button
          onClick={() => goToPage(Math.max(0, pageIndex - 1))}
          disabled={pageIndex === 0}
          className="rounded-full bg-white px-6 py-3 text-xl font-extrabold text-gray-500 shadow disabled:opacity-30"
        >
          ← Back
        </button>

        {mode === "read" && !readBackActive && (
          <button
            onClick={() => controllerRef.current?.forceAdvance()}
            className="rounded-full bg-white px-4 py-2 text-sm font-bold text-gray-400 shadow"
            title="Parent help: skip the current word (Ctrl+S)"
          >
            Skip word
          </button>
        )}

        {mode === "read" && !readBackActive && pictureRevealed && !isLastPage && (
          <button
            onClick={() => goToPage(pageIndex + 1)}
            className="pop-in rounded-full px-8 py-3 text-xl font-extrabold text-white shadow"
            style={{ background: "var(--accent)" }}
          >
            Next page →
          </button>
        )}
        {mode === "read" && !readBackActive && pictureRevealed && isLastPage && (
          <Link
            href="/"
            className="pop-in rounded-full px-8 py-3 text-xl font-extrabold text-white shadow"
            style={{ background: "var(--leaf)" }}
          >
            The End! 🎉
          </Link>
        )}
        {(listenActive || !pictureRevealed) && <div className="w-32" />}
      </footer>

      <FeedbackToast />
    </main>
  );
}

function ModeSwitcher({ mode, onSelect }: { mode: ReaderMode; onSelect: (mode: ReaderMode) => void }) {
  const base = "rounded-full px-5 py-2 text-lg font-extrabold shadow transition-transform active:scale-95";
  return (
    <div className="flex items-center gap-2 rounded-full bg-white/60 p-1">
      <button
        onClick={() => onSelect("listen")}
        className={base}
        style={
          mode === "listen"
            ? { background: "var(--accent)", color: "white" }
            : { background: "transparent", color: "var(--ink)" }
        }
        aria-pressed={mode === "listen"}
      >
        🎧 Listen
      </button>
      <button
        onClick={() => onSelect("read")}
        className={base}
        style={
          mode === "read"
            ? { background: "var(--accent)", color: "white" }
            : { background: "transparent", color: "var(--ink)" }
        }
        aria-pressed={mode === "read"}
      >
        🎤 Read
      </button>
      <button
        onClick={() => onSelect("echo")}
        className={base}
        style={
          mode === "echo"
            ? { background: "var(--accent)", color: "white" }
            : { background: "transparent", color: "var(--ink)" }
        }
        aria-pressed={mode === "echo"}
      >
        🗣️ Echo
      </button>
    </div>
  );
}

function MicBadge({ status }: { status: string }) {
  const label =
    status === "listening" ? "🎤 Listening" :
    status === "restarting" ? "🎤 …" :
    status === "paused" ? "🎤 Paused" :
    status === "unsupported" ? "🎤 Unavailable" :
    "🎤";
  const color = status === "listening" ? "text-green-600" : status === "unsupported" ? "text-red-400" : "text-gray-400";
  return <div className={`rounded-full bg-white px-4 py-2 text-sm font-bold shadow ${color}`}>{label}</div>;
}
