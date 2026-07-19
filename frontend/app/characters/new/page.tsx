"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { createCharacter, createStyle, listStyles, mediaUrl, type Style } from "@/lib/characters-api";

export default function NewCharacterPage() {
  const router = useRouter();
  const toast = useToast();

  const stylesQuery = useQuery({ queryKey: ["styles"], queryFn: listStyles });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [selectedStyleId, setSelectedStyleId] = useState<number | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");

  const presets = stylesQuery.data ?? [];
  const selectedPreset = presets.find((s) => s.id === selectedStyleId) ?? null;

  // Default the selection to the first preset once loaded.
  useEffect(() => {
    if (selectedStyleId === null && presets.length > 0) {
      setSelectedStyleId(presets[0].id);
    }
  }, [presets, selectedStyleId]);

  function selectStyle(style: Style) {
    setSelectedStyleId(style.id);
    setCustomizing(false);
  }

  function openCustomize() {
    if (selectedPreset) {
      setCustomName(`${selectedPreset.name} (custom)`);
      setCustomPrompt(selectedPreset.master_prompt);
    }
    setCustomizing(true);
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPhoto(f);
    setPhotoPreview(f ? URL.createObjectURL(f) : null);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Please give your character a name.");
      if (!selectedPreset) throw new Error("Please pick a style.");

      let styleId = selectedPreset.id;
      if (customizing) {
        if (!customPrompt.trim()) throw new Error("Custom style needs a prompt.");
        const style = await createStyle({
          name: customName.trim() || `${selectedPreset.name} (custom)`,
          master_prompt: customPrompt,
        });
        styleId = style.id;
      }

      return createCharacter({
        name: name.trim(),
        description: description.trim(),
        style_id: styleId,
        photo,
      });
    },
    onSuccess: (character) => {
      toast(`${character.name} is ready to draw!`, "success");
      router.push(`/characters/${character.id}`);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/characters" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-gray-500 shadow">
          ← Characters
        </Link>
        <h1 className="text-4xl font-black" style={{ color: "var(--accent-deep)" }}>
          New Character
        </h1>
        <div className="w-24" />
      </header>

      <section className="mb-6 rounded-3xl bg-white p-8 shadow-md">
        <label className="mb-2 block text-lg font-extrabold">What&apos;s their name?</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Captain Pip"
          className="mb-6 w-full rounded-2xl border-2 border-transparent bg-[var(--sky)] px-5 py-4 text-2xl font-bold outline-none focus:border-[var(--accent)]"
        />

        <label className="mb-2 block text-lg font-extrabold">Tell us about them</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A brave little fox who loves adventures…"
          rows={3}
          className="w-full rounded-2xl border-2 border-transparent bg-[var(--sky)] px-5 py-4 text-lg font-semibold outline-none focus:border-[var(--accent)]"
        />
      </section>

      <section className="mb-6 rounded-3xl bg-white p-8 shadow-md">
        <label className="mb-4 block text-lg font-extrabold">Start from a photo? (optional)</label>
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onPhotoChange} />
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileInput.current?.click()}
            type="button"
            className="flex h-32 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-3xl border-4 border-dashed text-center"
            style={{ borderColor: "var(--sky)" }}
          >
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="Selected photo" className="h-full w-full rounded-2xl object-cover" />
            ) : (
              <>
                <div className="text-4xl">📷</div>
                <div className="text-xs font-bold text-gray-400">Upload</div>
              </>
            )}
          </button>
          <div className="text-sm font-semibold text-gray-400">
            {photo ? (
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  setPhotoPreview(null);
                }}
                className="rounded-full bg-[var(--sky)] px-4 py-2 font-bold text-gray-500"
              >
                Remove photo
              </button>
            ) : (
              "Without a photo, we'll draw your character from the description."
            )}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-white p-8 shadow-md">
        <label className="mb-4 block text-lg font-extrabold">Pick a style</label>

        {stylesQuery.isLoading && <div className="text-gray-400">Loading styles…</div>}

        <div className="flex flex-wrap gap-4">
          {presets.map((style) => {
            const selected = style.id === selectedStyleId && !customizing;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => selectStyle(style)}
                className={`w-40 shrink-0 rounded-3xl p-3 text-left shadow transition-transform hover:-translate-y-0.5 ${
                  selected ? "ring-4" : ""
                }`}
                style={{
                  background: selected ? "var(--sky)" : "#fff",
                  ...(selected ? { boxShadow: "0 0 0 4px var(--accent)" } : {}),
                }}
              >
                <div className="mb-2 aspect-square w-full overflow-hidden rounded-2xl" style={{ background: "var(--cream)" }}>
                  {style.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(style.thumbnail_url) ?? ""} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-4xl">🎨</div>
                  )}
                </div>
                <div className="text-sm font-extrabold leading-tight">{style.name}</div>
                <div className="mt-1 line-clamp-2 text-xs font-semibold text-gray-400">
                  {style.master_prompt.split(" ").slice(0, 8).join(" ")}…
                </div>
              </button>
            );
          })}
        </div>

        {selectedPreset && (
          <div className="mt-6">
            {!customizing ? (
              <button
                type="button"
                onClick={openCustomize}
                className="text-sm font-bold text-gray-400 underline decoration-dotted hover:text-gray-500"
              >
                Customize style…
              </button>
            ) : (
              <div className="pop-in rounded-2xl bg-[var(--sky)] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-extrabold text-gray-500">Customizing a copy of &quot;{selectedPreset.name}&quot;</span>
                  <button
                    type="button"
                    onClick={() => setCustomizing(false)}
                    className="text-xs font-bold text-gray-400 underline"
                  >
                    Cancel
                  </button>
                </div>
                <label className="mb-1 block text-xs font-bold text-gray-500">Style name</label>
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="mb-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-bold outline-none"
                />
                <label className="mb-1 block text-xs font-bold text-gray-500">Master prompt</label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold outline-none"
                />
              </div>
            )}
          </div>
        )}
      </section>

      <button
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
        className="rounded-full px-8 py-4 text-xl font-extrabold text-white shadow-md disabled:opacity-50"
        style={{ background: "var(--accent)" }}
      >
        {createMutation.isPending ? "Creating…" : "Create character"}
      </button>
    </main>
  );
}
