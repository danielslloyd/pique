"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { listCharacters, mediaUrl, type CharacterSummary } from "@/lib/characters-api";
import { useWizardStore } from "@/stores/wizardStore";

export default function Step1Characters() {
  const charactersQuery = useQuery({ queryKey: ["characters"], queryFn: listCharacters });

  const characterIds = useWizardStore((s) => s.characterIds);
  const styleId = useWizardStore((s) => s.styleId);
  const toggleCharacter = useWizardStore((s) => s.toggleCharacter);
  const setStep = useWizardStore((s) => s.setStep);

  const locked = (charactersQuery.data ?? []).filter((c) => c.status === "locked");

  const groups = new Map<string, CharacterSummary[]>();
  for (const c of locked) {
    const list = groups.get(c.style_name) ?? [];
    list.push(c);
    groups.set(c.style_name, list);
  }

  const canContinue = characterIds.length >= 1 && characterIds.length <= 3;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="text-center">
        <h1 className="text-4xl font-black" style={{ color: "var(--accent-deep)" }}>
          Pick your stars 🌟
        </h1>
        <p className="mt-2 text-lg font-semibold text-gray-400">
          Choose 1&ndash;3 characters to star in this story. They&apos;ll all need to share one art style.
        </p>
      </div>

      {charactersQuery.isLoading && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-3xl bg-white/70" />
          ))}
        </div>
      )}

      {charactersQuery.isError && (
        <div className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow">
          <p className="mb-4 text-xl font-bold">Can&apos;t reach the backend — is it running?</p>
          <button
            onClick={() => charactersQuery.refetch()}
            className="rounded-full px-6 py-3 text-lg font-bold text-white"
            style={{ background: "var(--accent)" }}
          >
            Try again
          </button>
        </div>
      )}

      {charactersQuery.data && locked.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-3xl bg-white p-10 text-center shadow-md">
          <div className="text-6xl">🔒</div>
          <p className="max-w-sm text-lg font-semibold text-gray-500">
            You don&apos;t have any locked characters yet. Lock a character in the Character Studio before starting a
            story.
          </p>
          <Link
            href="/characters"
            className="rounded-full px-6 py-3 text-lg font-extrabold text-white shadow"
            style={{ background: "var(--accent)" }}
          >
            Go to Character Studio
          </Link>
        </div>
      )}

      {[...groups.entries()].map(([name, chars]) => {
        const groupStyleId = chars[0].style_id;
        const disabledGroup = styleId !== null && styleId !== groupStyleId;
        return (
          <section key={name} className="rounded-3xl bg-white p-6 shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-gray-600">{name}</h2>
              {disabledGroup && (
                <span className="pop-in rounded-full bg-[var(--sky)] px-4 py-1 text-xs font-bold text-gray-500">
                  A book uses one style — deselect your picks to choose from here instead
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {chars.map((c) => {
                const selected = characterIds.includes(c.id);
                const disabled = disabledGroup && !selected;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleCharacter(c.id, c.style_id)}
                    className="flex flex-col overflow-hidden rounded-2xl text-left shadow transition-transform disabled:opacity-35"
                    style={
                      selected
                        ? { boxShadow: "0 0 0 4px var(--accent)" }
                        : { boxShadow: "0 0 0 2px transparent" }
                    }
                  >
                    <div className="relative aspect-square w-full overflow-hidden" style={{ background: "var(--sky)" }}>
                      {c.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaUrl(c.thumbnail_url) ?? ""} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-4xl">🧑‍🎨</div>
                      )}
                      {selected && (
                        <div className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-sm shadow">
                          ✅
                        </div>
                      )}
                    </div>
                    <div className="p-2 text-sm font-extrabold leading-tight">{c.name}</div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="mt-auto flex justify-end pt-4">
        <button
          onClick={() => setStep(2)}
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
