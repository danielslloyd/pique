"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef } from "react";
import { useToast } from "@/components/Toast";
import { importLegacyCharacters, listCharacters, mediaUrl } from "@/lib/characters-api";

export default function CharactersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const charactersQuery = useQuery({ queryKey: ["characters"], queryFn: listCharacters });

  const importMutation = useMutation({
    mutationFn: importLegacyCharacters,
    onSuccess: (res) => {
      toast(`Imported ${res.imported} character${res.imported === 1 ? "" : "s"}!`, "success");
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
    onError: (e: Error) => toast(`Import failed: ${e.message}`, "error"),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <header className="relative mb-8 flex items-center justify-between">
        <Link href="/" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-gray-500 shadow">
          ← Library
        </Link>
        <h1 className="text-5xl font-black" style={{ color: "var(--accent-deep)" }}>
          Character Studio
        </h1>
        <div className="w-24" />

        <input
          ref={fileInput}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importMutation.mutate(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={importMutation.isPending}
          className="absolute right-0 top-full mt-2 rounded-full bg-white/60 px-3 py-1 text-xs font-bold text-gray-400 shadow-sm hover:text-gray-600 disabled:opacity-50"
          title="Import characters from a legacy .zip export"
        >
          {importMutation.isPending ? "Importing…" : "Import legacy characters"}
        </button>
      </header>

      {charactersQuery.isLoading && (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-3xl bg-white/70" />
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

      {charactersQuery.data && (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          <Link
            href="/characters/new"
            className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-3xl border-4 border-dashed shadow-md transition-transform hover:-translate-y-1 hover:shadow-xl"
            style={{ borderColor: "var(--accent)", color: "var(--accent-deep)" }}
          >
            <div className="text-6xl">➕</div>
            <div className="text-xl font-extrabold">New character</div>
          </Link>

          {charactersQuery.data.map((character) => (
            <Link
              key={character.id}
              href={`/characters/${character.id}`}
              className="group relative flex flex-col overflow-hidden rounded-3xl bg-white shadow-md transition-transform hover:-translate-y-1 hover:shadow-xl"
            >
              {character.status === "locked" && (
                <div className="absolute right-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1 text-lg shadow">
                  🔒
                </div>
              )}
              <div className="aspect-square w-full overflow-hidden" style={{ background: "var(--sky)" }}>
                {character.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(character.thumbnail_url) ?? ""}
                    alt=""
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-6xl">🧑‍🎨</div>
                )}
              </div>
              <div className="p-4">
                <div className="text-xl font-extrabold leading-tight">{character.name}</div>
                <div className="mt-1 text-sm font-semibold text-gray-400">{character.style_name}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
