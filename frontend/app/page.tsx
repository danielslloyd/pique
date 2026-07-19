"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef } from "react";
import { importRbook, listBooks, mediaUrl } from "@/lib/api";
import { useToast } from "@/components/Toast";

export default function LibraryPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: listBooks });

  const importMutation = useMutation({
    mutationFn: importRbook,
    onSuccess: (book) => {
      toast(`Added "${book.title}"!`, "success");
      queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (e: Error) => toast(`Import failed: ${e.message}`, "error"),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
      <h1 className="mb-8 text-center text-5xl font-black" style={{ color: "var(--accent-deep)" }}>
        My Books
      </h1>

      {booksQuery.isLoading && (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-3xl bg-white/70" />
          ))}
        </div>
      )}

      {booksQuery.isError && (
        <div className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow">
          <p className="mb-4 text-xl font-bold">Can&apos;t reach the backend — is it running?</p>
          <p className="mb-4 text-sm text-gray-500">Start it with scripts/dev.ps1</p>
          <button
            onClick={() => booksQuery.refetch()}
            className="rounded-full px-6 py-3 text-lg font-bold text-white"
            style={{ background: "var(--accent)" }}
          >
            Try again
          </button>
        </div>
      )}

      {booksQuery.data && booksQuery.data.length === 0 && (
        <p className="text-center text-2xl font-semibold text-gray-500">
          No books yet — import one below, or make a new story!
        </p>
      )}

      <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
        {booksQuery.data?.map((book) => (
          <Link
            key={book.id}
            href={`/read/${book.id}`}
            className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-md transition-transform hover:-translate-y-1 hover:shadow-xl"
          >
            <div className="aspect-square w-full overflow-hidden" style={{ background: "var(--sky)" }}>
              {book.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(book.thumbnail_url) ?? ""}
                  alt=""
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-6xl">📖</div>
              )}
            </div>
            <div className="p-4">
              <div className="text-xl font-extrabold leading-tight">{book.title}</div>
              <div className="mt-1 text-sm font-semibold text-gray-400">
                {book.page_count} pages
              </div>
            </div>
          </Link>
        ))}
      </div>

      <footer className="mt-auto flex items-center justify-center gap-4 pt-12 text-sm">
        <input
          ref={fileInput}
          type="file"
          accept=".rbook"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importMutation.mutate(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded-full bg-white px-5 py-2 font-bold text-gray-500 shadow hover:text-gray-700"
        >
          {importMutation.isPending ? "Importing…" : "Import book"}
        </button>
        <Link href="/characters" className="rounded-full bg-white px-5 py-2 font-bold text-gray-500 shadow hover:text-gray-700">
          Characters
        </Link>
        <Link href="/create" className="rounded-full bg-white px-5 py-2 font-bold text-gray-500 shadow hover:text-gray-700">
          New Story
        </Link>
        <Link href="/settings" className="rounded-full bg-white px-5 py-2 font-bold text-gray-500 shadow hover:text-gray-700">
          Settings
        </Link>
      </footer>
    </main>
  );
}
