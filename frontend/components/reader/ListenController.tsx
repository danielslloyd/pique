"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import * as audioManager from "@/lib/audio-manager";
import {
  fetchNarration,
  getVoicePref,
  narrationAudioUrl,
  narrationQueryKey,
  NarrationUnavailableError,
  type Narration,
} from "@/lib/narration-api";
import { findWordIndexAt } from "@/lib/timing";
import { useReaderStore } from "@/stores/readerStore";

export interface ListenControllerHandle {
  /** Seek playback to the start of the given token (from a word tap). */
  seekToToken: (tokenIndex: number) => void;
}

interface Props {
  bookId: string | number;
  /** 1-based page number for the narration endpoint. */
  pageNo: number;
  variant: "listen" | "readback";
  isLastPage?: boolean;
  /** Read-back: begin playing as soon as narration is ready. */
  autoPlay?: boolean;
  /** Fired when playback reaches the end. */
  onEnded?: () => void;
  /** Listen: advance to the next page from the ended affordance. */
  onNext?: () => void;
  /** Read-back: return to the completed Read-mode state. */
  onReturn?: () => void;
}

const ListenController = forwardRef<ListenControllerHandle, Props>(function ListenController(
  { bookId, pageNo, variant, isLastPage, autoPlay, onEnded, onNext, onReturn },
  ref
) {
  const setListenWordIndex = useReaderStore((s) => s.setListenWordIndex);
  const showFeedback = useReaderStore((s) => s.showFeedback);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTokenRef = useRef<number>(-2);
  const autoPlayedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [ended, setEnded] = useState(false);

  const voice = useMemo(() => getVoicePref(), []);
  const narrationQuery = useQuery({
    queryKey: narrationQueryKey(bookId, pageNo, voice),
    queryFn: ({ signal }) =>
      fetchNarration(bookId, pageNo, { signal, engine: voice.engine, voice: voice.voice }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  const narration: Narration | undefined = narrationQuery.data;

  // --- highlight sync -------------------------------------------------------
  const syncHighlight = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !narration) return;
    const idx = findWordIndexAt(audio.currentTime * 1000, narration.words);
    const tokenIndex = idx < 0 ? -1 : narration.words[idx].i;
    if (tokenIndex !== lastTokenRef.current) {
      lastTokenRef.current = tokenIndex;
      setListenWordIndex(tokenIndex);
    }
  }, [narration, setListenWordIndex]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startRaf = useCallback(() => {
    stopRaf();
    const loop = () => {
      syncHighlight();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    // rAF starves when the page isn't painting (backgrounded tab, hidden view);
    // audio keeps playing there, so keep the highlight honest with a coarse timer.
    intervalRef.current = setInterval(syncHighlight, 120);
  }, [stopRaf, syncHighlight]);

  // --- transport controls ---------------------------------------------------
  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Any short "app audio" (word help) must yield to narration.
    audioManager.cancel();
    setEnded(false);
    void audio.play().catch(() => {
      /* autoplay/user-gesture rejection — the play button will retry */
    });
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const restart = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    play();
  }, [play]);

  const seekToMs = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = ms / 1000;
      syncHighlight();
      play();
    },
    [play, syncHighlight]
  );

  useImperativeHandle(
    ref,
    () => ({
      seekToToken: (tokenIndex: number) => {
        if (!narration) return;
        const span = narration.words.find((w) => w.i === tokenIndex);
        if (span) seekToMs(span.start_ms);
      },
    }),
    [narration, seekToMs]
  );

  // --- audio element lifecycle ---------------------------------------------
  useEffect(() => {
    if (!narration) return;
    const audio = new Audio(narrationAudioUrl(narration));
    audio.preload = "auto";
    audioRef.current = audio;
    lastTokenRef.current = -2;

    const onPlay = () => {
      setIsPlaying(true);
      startRaf();
    };
    const onPause = () => {
      setIsPlaying(false);
      stopRaf();
      syncHighlight();
    };
    const onEnd = () => {
      setIsPlaying(false);
      setEnded(true);
      stopRaf();
      setListenWordIndex(-1);
      onEnded?.();
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      stopRaf();
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      audio.src = "";
      audioRef.current = null;
      setListenWordIndex(-1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration]);

  // Read-back autoplay, once, when audio is ready.
  useEffect(() => {
    if (!autoPlay || !narration || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    play();
  }, [autoPlay, narration, play]);

  // Surface a friendly toast if the TTS service is unavailable.
  useEffect(() => {
    if (!narrationQuery.isError) return;
    const err = narrationQuery.error;
    const msg =
      err instanceof NarrationUnavailableError
        ? err.message
        : "Couldn't get the story voice. Try again!";
    showFeedback("error", msg);
  }, [narrationQuery.isError, narrationQuery.error, showFeedback]);

  // --- render ---------------------------------------------------------------
  if (narrationQuery.isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="text-5xl">🎧</div>
        <p className="text-xl font-extrabold text-gray-500">Getting the story voice ready…</p>
      </div>
    );
  }

  if (narrationQuery.isError || !narration) {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <p className="text-xl font-extrabold text-gray-500">The story voice is having a nap. 😴</p>
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

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="flex items-center gap-5">
        <button
          onClick={isPlaying ? pause : play}
          className="flex h-24 w-24 items-center justify-center rounded-full text-5xl text-white shadow-lg transition-transform active:scale-95"
          style={{ background: "var(--accent)" }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸️" : "▶️"}
        </button>
        <button
          onClick={restart}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl text-gray-500 shadow-md transition-transform active:scale-95"
          aria-label="Start over"
          title="Start over"
        >
          ↺
        </button>
      </div>

      {ended && variant === "listen" && (
        <div className="pop-in flex items-center gap-4">
          {isLastPage ? (
            <Link
              href="/"
              className="rounded-full px-8 py-3 text-2xl font-extrabold text-white shadow"
              style={{ background: "var(--leaf)" }}
            >
              The End! 🎉
            </Link>
          ) : (
            <button
              onClick={onNext}
              className="rounded-full px-8 py-3 text-2xl font-extrabold text-white shadow"
              style={{ background: "var(--accent)" }}
            >
              Next page →
            </button>
          )}
        </div>
      )}

      {ended && variant === "readback" && (
        <button
          onClick={onReturn}
          className="pop-in rounded-full px-8 py-3 text-2xl font-extrabold text-white shadow"
          style={{ background: "var(--leaf)" }}
        >
          All done! ✅
        </button>
      )}
    </div>
  );
});

export default ListenController;
