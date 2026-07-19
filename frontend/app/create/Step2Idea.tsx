"use client";

import type { ReadingLevel } from "@/lib/wizard-api";
import { useWizardStore } from "@/stores/wizardStore";

const SUGGESTIONS = [
  "A rainy-day adventure",
  "Learning to share",
  "A trip to the moon",
  "The lost teddy",
  "First day of school",
  "A magical garden",
];

const READING_LEVELS: { value: ReadingLevel; label: string; blurb: string }[] = [
  { value: "pre-k", label: "Pre-K", blurb: "Very simple words and short, gentle sentences." },
  { value: "k", label: "Kindergarten", blurb: "Easy sentences with a little more story." },
  { value: "1st", label: "1st Grade", blurb: "Longer sentences and a bit more adventure." },
];

const PAGE_COUNTS = [4, 6, 8];

export default function Step2Idea() {
  const theme = useWizardStore((s) => s.theme);
  const readingLevel = useWizardStore((s) => s.readingLevel);
  const pageCount = useWizardStore((s) => s.pageCount);
  const setTheme = useWizardStore((s) => s.setTheme);
  const setReadingLevel = useWizardStore((s) => s.setReadingLevel);
  const setPageCount = useWizardStore((s) => s.setPageCount);
  const setStep = useWizardStore((s) => s.setStep);

  const canContinue = theme.trim().length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="text-center">
        <h1 className="text-4xl font-black" style={{ color: "var(--accent-deep)" }}>
          What&apos;s the story about? 💡
        </h1>
      </div>

      <section className="rounded-3xl bg-white p-6 shadow-md">
        <label className="mb-2 block text-lg font-extrabold">Story idea</label>
        <textarea
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="e.g. A rainy-day adventure with a brave umbrella"
          rows={3}
          className="mb-4 w-full rounded-2xl border-2 border-transparent bg-[var(--sky)] px-5 py-4 text-xl font-bold outline-none focus:border-[var(--accent)]"
        />
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTheme(s)}
              className={`rounded-full px-4 py-2 text-sm font-bold shadow transition-transform hover:-translate-y-0.5 ${
                theme === s ? "text-white" : "bg-[var(--sky)] text-gray-600"
              }`}
              style={theme === s ? { background: "var(--accent)" } : undefined}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-md">
        <label className="mb-4 block text-lg font-extrabold">Reading level</label>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {READING_LEVELS.map((lvl) => {
            const selected = readingLevel === lvl.value;
            return (
              <button
                key={lvl.value}
                type="button"
                onClick={() => setReadingLevel(lvl.value)}
                className="rounded-2xl p-4 text-left shadow transition-transform hover:-translate-y-0.5"
                style={
                  selected
                    ? { background: "var(--sky)", boxShadow: "0 0 0 4px var(--accent)" }
                    : { background: "#fff", boxShadow: "0 0 0 2px transparent" }
                }
              >
                <div className="text-lg font-extrabold">{lvl.label}</div>
                <div className="mt-1 text-sm font-semibold text-gray-400">{lvl.blurb}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-md">
        <label className="mb-4 block text-lg font-extrabold">How many pages?</label>
        <div className="flex gap-4">
          {PAGE_COUNTS.map((n) => {
            const selected = pageCount === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setPageCount(n)}
                className="flex h-20 w-20 items-center justify-center rounded-2xl text-2xl font-black shadow transition-transform hover:-translate-y-0.5"
                style={
                  selected
                    ? { background: "var(--accent)", color: "white" }
                    : { background: "var(--sky)", color: "var(--ink)" }
                }
              >
                {n}
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-auto flex justify-between pt-4">
        <button
          onClick={() => setStep(1)}
          className="rounded-full bg-white px-6 py-3 text-lg font-extrabold text-gray-500 shadow"
        >
          ← Back
        </button>
        <button
          onClick={() => setStep(3)}
          disabled={!canContinue}
          className="rounded-full px-8 py-4 text-xl font-extrabold text-white shadow-md disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
