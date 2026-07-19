// Web Speech API provider. Ports the legacy engine's alternatives-flattening but with
// restart discipline: exponential backoff instead of a 100ms restart hammer, and a
// hard pause() gate so the recognizer is never running while app audio plays.

import type { HypWord, RecognitionCallbacks, RecognitionProvider } from "./types";

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionResultLike extends ArrayLike<{ transcript: string; confidence: number }> {
  isFinal: boolean;
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as SpeechRecognitionCtor) ?? (w.webkitSpeechRecognition as SpeechRecognitionCtor) ?? null;
}

const BACKOFF_START_MS = 250;
const BACKOFF_MAX_MS = 4000;
const RESUME_DELAY_MS = 300;

export class WebSpeechProvider implements RecognitionProvider {
  readonly name = "webspeech";

  private recognition: SpeechRecognitionLike | null = null;
  private callbacks: RecognitionCallbacks | null = null;
  private active = false; // start() called and not stop()ed
  private paused = false;
  private backoffMs = BACKOFF_START_MS;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  isSupported(): boolean {
    return getCtor() !== null;
  }

  start(callbacks: RecognitionCallbacks): void {
    this.callbacks = callbacks;
    if (!this.isSupported()) {
      callbacks.onStatus("unsupported", "This browser has no speech recognition. Try Chrome.");
      return;
    }
    this.active = true;
    this.paused = false;
    this.backoffMs = BACKOFF_START_MS;
    this.spinUp();
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.clearTimers();
    this.teardownRecognition();
    this.callbacks?.onStatus("paused");
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    // Delay so the tail of app audio isn't captured.
    this.resumeTimer = setTimeout(() => {
      if (!this.active || !this.paused) return;
      this.paused = false;
      this.backoffMs = BACKOFF_START_MS;
      this.spinUp();
    }, RESUME_DELAY_MS);
  }

  stop(): void {
    this.active = false;
    this.paused = false;
    this.clearTimers();
    this.teardownRecognition();
    this.callbacks?.onStatus("idle");
    this.callbacks = null;
  }

  private spinUp(): void {
    if (!this.active || this.paused) return;
    const Ctor = getCtor();
    if (!Ctor) return;
    this.teardownRecognition();

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;

    rec.onresult = (event) => {
      this.backoffMs = BACKOFF_START_MS; // hearing speech means the session is healthy
      const latest = event.results[event.results.length - 1];
      if (!latest) return;
      const words: HypWord[] = [];
      for (let alt = 0; alt < latest.length; alt++) {
        const { transcript, confidence } = latest[alt];
        for (const raw of transcript.trim().split(/\s+/)) {
          if (raw) words.push({ word: raw, confidence: confidence || 0.5 });
        }
      }
      this.callbacks?.onHypothesis(words, latest.isFinal);
    };

    rec.onerror = (event) => {
      // "no-speech"/"aborted" are routine with halting readers; anything else surfaces.
      const error = event.error ?? "unknown";
      if (error !== "no-speech" && error !== "aborted") {
        this.callbacks?.onStatus("error", error);
      }
      // onend fires after onerror and owns the restart.
    };

    rec.onend = () => {
      if (!this.active || this.paused) return;
      this.callbacks?.onStatus("restarting");
      this.restartTimer = setTimeout(() => {
        this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
        this.spinUp();
      }, this.backoffMs);
    };

    this.recognition = rec;
    try {
      rec.start();
      this.callbacks?.onStatus("listening");
    } catch {
      // start() throws if called while already started; treat as restart.
      this.restartTimer = setTimeout(() => this.spinUp(), this.backoffMs);
    }
  }

  private teardownRecognition(): void {
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      try {
        this.recognition.abort();
      } catch {
        /* already stopped */
      }
      this.recognition = null;
    }
  }

  private clearTimers(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.restartTimer = null;
    this.resumeTimer = null;
  }
}
