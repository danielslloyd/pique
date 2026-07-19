// Typed client for the narration endpoint. The first call for a page builds audio on
// the GPU TTS service and can take 10-60s, so we use a generous timeout.

import { MEDIA_BASE } from "./api";
import type { WordSpan } from "./timing";

export interface Narration {
  audio_url: string;
  duration_s: number;
  engine: string;
  voice_id: string;
  /** One span per token of the page text; `i` is the token index. */
  words: WordSpan[];
}

export class NarrationUnavailableError extends Error {
  constructor() {
    super("The story voice is taking a nap. Try again in a moment!");
    this.name = "NarrationUnavailableError";
  }
}

export const DEFAULT_ENGINE = "kokoro";
export const DEFAULT_VOICE = "af_heart";
const NARRATION_TIMEOUT_MS = 90_000;
const VOICE_KEY = "pique-voice";

export interface VoicePref {
  engine: string;
  voice: string;
}

/** Parent-chosen reading voice (localStorage), falling back to the Kokoro default. */
export function getVoicePref(): VoicePref {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(VOICE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<VoicePref>;
        if (parsed.engine && parsed.voice) return { engine: parsed.engine, voice: parsed.voice };
      }
    } catch {
      /* ignore malformed pref */
    }
  }
  return { engine: DEFAULT_ENGINE, voice: DEFAULT_VOICE };
}

export function setVoicePref(pref: VoicePref): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOICE_KEY, JSON.stringify(pref));
}

/**
 * Shared react-query key for a page's narration. Listen and Echo controllers MUST use
 * this so they hit the same cache entry, and it includes the voice so changing voices
 * refetches instead of serving stale audio.
 */
export function narrationQueryKey(
  bookId: number | string,
  pageNo: number,
  voice: VoicePref
): (string | number)[] {
  return ["narration", String(bookId), pageNo, voice.engine, voice.voice];
}

export interface NarrationOptions {
  engine?: string;
  voice?: string;
  signal?: AbortSignal;
}

export async function fetchNarration(
  bookId: number | string,
  pageNo: number,
  opts: NarrationOptions = {}
): Promise<Narration> {
  const engine = opts.engine ?? DEFAULT_ENGINE;
  const voice = opts.voice ?? DEFAULT_VOICE;
  const url = `/api/books/${bookId}/pages/${pageNo}/narration?engine=${encodeURIComponent(engine)}&voice=${encodeURIComponent(voice)}`;

  // Combine the caller's signal (if any) with our own timeout.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), NARRATION_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(url, { signal: timeout.signal });
    if (res.status === 503) throw new NarrationUnavailableError();
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
    }
    return (await res.json()) as Narration;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Full, seekable URL for a narration's audio file (audio_url is a /media path). */
export function narrationAudioUrl(narration: Narration): string {
  return `${MEDIA_BASE}${narration.audio_url}`;
}

/** URL for a single word's help audio, routed through the /api proxy. */
export function wordAudioUrl(
  normalizedWord: string,
  opts: { engine?: string; voice?: string } = {}
): string {
  const engine = opts.engine ?? DEFAULT_ENGINE;
  const voice = opts.voice ?? DEFAULT_VOICE;
  return `/api/word-audio/${encodeURIComponent(normalizedWord)}?engine=${encodeURIComponent(engine)}&voice=${encodeURIComponent(voice)}`;
}
