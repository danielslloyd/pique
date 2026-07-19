// Single shared HTMLAudioElement for short "app audio" clips (word-help playback).
// Owning exactly one element and one set of hooks guarantees the mutual-exclusion
// contract: a clip's onStart pauses recognition, its onEnd resumes it, and starting a
// new clip cancels the previous one without firing its onEnd (so we don't resume-then-
// immediately-pause). Listen-mode narration has its own audio element and does not go
// through here — recognition is fully stopped in Listen mode anyway.

let audio: HTMLAudioElement | null = null;

interface PlayHooks {
  /** Fired right before playback begins — use to pause recognition. */
  onStart?: () => void;
  /** Fired once when playback ends or errors — use to resume recognition. */
  onEnd?: () => void;
}

let currentHooks: PlayHooks | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) audio = new Audio();
  return audio;
}

/** Detach handlers and stop the element without firing the pending onEnd. */
function teardown(): void {
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  try {
    audio.pause();
  } catch {
    /* ignore */
  }
}

function finish(): void {
  const hooks = currentHooks;
  currentHooks = null;
  teardown();
  hooks?.onEnd?.();
}

/**
 * Play a URL through the shared element. Cancels any in-flight clip first (silently),
 * then fires onStart, then plays. onEnd fires exactly once on natural end or error.
 */
export function playUrl(url: string, hooks: PlayHooks = {}): void {
  cancel(); // drop any previous clip without firing its onEnd
  const el = getAudio();
  currentHooks = hooks;
  el.src = url;
  el.currentTime = 0;
  el.onended = finish;
  el.onerror = finish;
  hooks.onStart?.();
  const p = el.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => finish());
  }
}

/** Stop the current clip immediately without firing its onEnd hook. */
export function cancel(): void {
  currentHooks = null;
  teardown();
}

export function isPlaying(): boolean {
  return audio !== null && !audio.paused && !audio.ended;
}
