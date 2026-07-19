// Provider selection. A localStorage-backed "tier" preference chooses between the
// built-in Web Speech API and the backend Whisper streamer, with Web Speech as the
// safe fallback whenever Whisper is unavailable.

import type { RecognitionProvider } from "./types";
import { WebSpeechProvider } from "./webspeech";
import { WhisperProvider } from "./whisper";

export type AsrTier = "auto" | "webspeech" | "whisper";

const TIER_KEY = "pique-asr-tier";

export function getAsrTier(): AsrTier {
  if (typeof window === "undefined") return "auto";
  const raw = window.localStorage.getItem(TIER_KEY);
  return raw === "webspeech" || raw === "whisper" || raw === "auto" ? raw : "auto";
}

export function setAsrTier(tier: AsrTier): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TIER_KEY, tier);
}

export interface AsrCapabilities {
  whisper_available: boolean;
}

/** Ask the backend whether the Whisper streamer is available. Never throws. */
export async function fetchAsrCapabilities(): Promise<AsrCapabilities> {
  try {
    const res = await fetch("/api/asr/capabilities");
    if (!res.ok) return { whisper_available: false };
    const json = (await res.json()) as Partial<AsrCapabilities>;
    return { whisper_available: !!json.whisper_available };
  } catch {
    return { whisper_available: false };
  }
}

/** True if this browser exposes the Web Speech API. */
export function isWebSpeechSupported(): boolean {
  return new WebSpeechProvider().isSupported();
}

async function whisperAvailable(): Promise<boolean> {
  return (await fetchAsrCapabilities()).whisper_available;
}

/**
 * Build the recognition provider for the current tier preference. `expectedText` is the
 * page text, used to prime the Whisper session (and ignored by Web Speech).
 */
export async function createProvider(expectedText: string): Promise<RecognitionProvider> {
  const tier = getAsrTier();
  const webspeech = new WebSpeechProvider();

  if (tier === "webspeech") return webspeech;

  if (tier === "whisper") {
    if (await whisperAvailable()) return new WhisperProvider(expectedText);
    console.warn("Whisper was requested but the server reports it unavailable; using Web Speech instead.");
    return webspeech;
  }

  // auto: prefer the zero-latency in-browser engine, then Whisper, then Web Speech
  // (which will report "unsupported" on start so the reader can surface it).
  if (webspeech.isSupported()) return webspeech;
  if (await whisperAvailable()) return new WhisperProvider(expectedText);
  return webspeech;
}
