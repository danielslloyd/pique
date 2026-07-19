"use client";

import type { WizardStep } from "@/stores/wizardStore";

const STEPS: { step: WizardStep; label: string; emoji: string }[] = [
  { step: 1, label: "Stars", emoji: "🌟" },
  { step: 2, label: "Idea", emoji: "💡" },
  { step: 3, label: "Story", emoji: "📝" },
  { step: 4, label: "Pictures", emoji: "🎨" },
  { step: 5, label: "Finish", emoji: "🎉" },
];

export default function WizardShell({
  step,
  onStartOver,
  children,
}: {
  step: WizardStep;
  onStartOver: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-full bg-white/70 p-1 shadow-sm md:gap-2 md:p-2">
          {STEPS.map((s) => {
            const active = s.step === step;
            const done = s.step < step;
            return (
              <div
                key={s.step}
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold transition-all md:h-10 md:w-10 md:text-base"
                style={
                  active
                    ? { background: "var(--accent)", color: "white" }
                    : done
                      ? { background: "var(--leaf)", color: "white" }
                      : { background: "transparent", color: "var(--ink)", opacity: 0.4 }
                }
                title={s.label}
              >
                {done ? "✓" : s.emoji}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => {
            if (window.confirm("Start over? This will clear your story wizard progress.")) onStartOver();
          }}
          className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-bold text-gray-400 shadow hover:text-gray-600"
        >
          Start over
        </button>
      </header>

      {children}
    </main>
  );
}
