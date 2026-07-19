"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getVoicePref,
  setVoicePref,
  DEFAULT_ENGINE,
  DEFAULT_VOICE,
  type VoicePref,
} from "@/lib/narration-api";
import {
  fetchAsrCapabilities,
  getAsrTier,
  isWebSpeechSupported,
  setAsrTier,
  type AsrTier,
} from "@/lib/recognition";

const ENGINES: { value: string; label: string }[] = [
  { value: "kokoro", label: "Kokoro" },
  { value: "chatterbox", label: "Chatterbox" },
];

const TIERS: { value: AsrTier; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Use the best engine this device supports." },
  { value: "webspeech", label: "Web Speech", hint: "The browser's built-in recognizer (Chrome works best)." },
  { value: "whisper", label: "Whisper", hint: "The Pique server's recognizer, for other browsers." },
];

export default function SettingsPage() {
  // Preferences load from localStorage after mount to avoid a hydration mismatch.
  const [engine, setEngine] = useState(DEFAULT_ENGINE);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [tier, setTier] = useState<AsrTier>("auto");
  const [webSpeech, setWebSpeech] = useState<boolean | null>(null);

  useEffect(() => {
    const v: VoicePref = getVoicePref();
    setEngine(v.engine);
    setVoice(v.voice);
    setTier(getAsrTier());
    setWebSpeech(isWebSpeechSupported());
  }, []);

  const saveVoice = (next: Partial<VoicePref>) => {
    const merged: VoicePref = { engine, voice, ...next };
    setEngine(merged.engine);
    setVoice(merged.voice);
    setVoicePref(merged);
  };

  const saveTier = (next: AsrTier) => {
    setTier(next);
    setAsrTier(next);
  };

  const capabilitiesQuery = useQuery({
    queryKey: ["asr-capabilities"],
    queryFn: fetchAsrCapabilities,
  });

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json().catch(() => ({}));
    },
    retry: 0,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-gray-500 shadow">
          ← Library
        </Link>
        <h1 className="text-2xl font-black" style={{ color: "var(--accent-deep)" }}>
          Settings
        </h1>
        <div className="w-20" />
      </header>

      {/* Reading voice */}
      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-extrabold text-gray-700">Reading voice</h2>
        <p className="mb-4 text-sm text-gray-400">
          The voice used for Listen mode, Echo mode, and word-help audio.
        </p>

        <div className="mb-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Engine</div>
          <div className="flex flex-wrap gap-2">
            {ENGINES.map((e) => (
              <button
                key={e.value}
                onClick={() => saveVoice({ engine: e.value })}
                className="rounded-full px-4 py-2 text-sm font-bold shadow-sm transition-colors"
                style={
                  engine === e.value
                    ? { background: "var(--accent)", color: "white" }
                    : { background: "var(--sky)", color: "var(--ink)" }
                }
                aria-pressed={engine === e.value}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-400" htmlFor="voice-input">
            Voice
          </label>
          <input
            id="voice-input"
            value={voice}
            onChange={(e) => saveVoice({ voice: e.target.value })}
            placeholder={DEFAULT_VOICE}
            className="w-full rounded-2xl bg-[var(--sky)] px-4 py-3 text-base font-semibold outline-none focus:ring-2"
            style={{ outlineColor: "var(--accent)" }}
          />
          <p className="mt-2 text-xs text-gray-400">
            Voice IDs depend on the engine (Kokoro&apos;s default is <code>af_heart</code>). Changes are saved
            automatically.
          </p>
        </div>
      </section>

      {/* Speech recognition */}
      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-extrabold text-gray-700">Speech recognition</h2>
        <p className="mb-4 text-sm text-gray-400">
          How Pique listens while your child reads aloud in Read and Echo modes.
        </p>

        <div className="mb-5 flex flex-col gap-2">
          {TIERS.map((t) => (
            <button
              key={t.value}
              onClick={() => saveTier(t.value)}
              className="flex items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors"
              style={{
                borderColor: tier === t.value ? "var(--accent)" : "transparent",
                background: tier === t.value ? "#fff3ec" : "var(--sky)",
              }}
              aria-pressed={tier === t.value}
            >
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                style={{ borderColor: tier === t.value ? "var(--accent)" : "#c8d3dd" }}
              >
                {tier === t.value && (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />
                )}
              </span>
              <span>
                <span className="block font-bold text-gray-700">{t.label}</span>
                <span className="block text-sm text-gray-400">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-2xl bg-[var(--sky)] p-4 text-sm">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Availability</div>
          <CapabilityLine
            label="Web Speech (this browser)"
            state={webSpeech === null ? "checking" : webSpeech ? "ok" : "off"}
            okText="Supported"
            offText="Not supported"
          />
          <CapabilityLine
            label="Whisper (Pique server)"
            state={
              capabilitiesQuery.isLoading
                ? "checking"
                : capabilitiesQuery.data?.whisper_available
                  ? "ok"
                  : "off"
            }
            okText="Available"
            offText="Unavailable"
          />
        </div>
      </section>

      {/* Service health */}
      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-extrabold text-gray-700">Service health</h2>
        <p className="mb-4 text-sm text-gray-400">A quick look at the services Pique relies on.</p>

        <div className="flex flex-col gap-3">
          <HealthCard
            title="Backend"
            detail="Books, characters, and the API."
            state={healthQuery.isLoading ? "checking" : healthQuery.isError ? "off" : "ok"}
            okText="Running"
            offText="Can't reach it — is the backend started?"
          />
          <HealthCard
            title="Picture maker (ComfyUI)"
            detail="Port 8188 · draws characters and page pictures."
            state="hint"
            hintText="Expected at localhost:8188. If pictures fail, make sure ComfyUI is running."
          />
          <HealthCard
            title="Story voice (TTS)"
            detail="Port 8100 · narration and word-help audio."
            state="hint"
            hintText="Expected at localhost:8100. If narration naps, make sure the TTS service is running."
          />
        </div>
      </section>
    </main>
  );
}

type LineState = "checking" | "ok" | "off";

function CapabilityLine({
  label,
  state,
  okText,
  offText,
}: {
  label: string;
  state: LineState;
  okText: string;
  offText: string;
}) {
  const dot = state === "ok" ? "#6cc24a" : state === "off" ? "#e8632f" : "#c8d3dd";
  const text = state === "checking" ? "Checking…" : state === "ok" ? okText : offText;
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-semibold text-gray-600">{label}</span>
      <span className="flex items-center gap-2 font-bold text-gray-500">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
        {text}
      </span>
    </div>
  );
}

function HealthCard({
  title,
  detail,
  state,
  okText,
  offText,
  hintText,
}: {
  title: string;
  detail: string;
  state: "checking" | "ok" | "off" | "hint";
  okText?: string;
  offText?: string;
  hintText?: string;
}) {
  const dot =
    state === "ok" ? "#6cc24a" : state === "off" ? "#e8632f" : state === "hint" ? "#c8d3dd" : "#c8d3dd";
  const status =
    state === "checking" ? "Checking…" : state === "ok" ? okText : state === "off" ? offText : hintText;
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[var(--sky)] p-4">
      <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: dot }} />
      <div>
        <div className="font-bold text-gray-700">{title}</div>
        <div className="text-sm text-gray-400">{detail}</div>
        <div className="mt-1 text-sm font-semibold text-gray-500">{status}</div>
      </div>
    </div>
  );
}
