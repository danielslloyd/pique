"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { createWizardBook, draftStory, reviseStoryPage } from "@/lib/wizard-api";
import { useWizardStore } from "@/stores/wizardStore";
import AutoTextarea from "./AutoTextarea";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^\d+\s\w[\w\s]*:\s*/, "");
  return "Something went wrong.";
}

export default function Step3Story() {
  const toast = useToast();

  const characterIds = useWizardStore((s) => s.characterIds);
  const theme = useWizardStore((s) => s.theme);
  const readingLevel = useWizardStore((s) => s.readingLevel);
  const pageCount = useWizardStore((s) => s.pageCount);
  const title = useWizardStore((s) => s.title);
  const pages = useWizardStore((s) => s.pages);
  const setDraft = useWizardStore((s) => s.setDraft);
  const setTitle = useWizardStore((s) => s.setTitle);
  const updatePageDraft = useWizardStore((s) => s.updatePageDraft);
  const replacePage = useWizardStore((s) => s.replacePage);
  const setBookId = useWizardStore((s) => s.setBookId);
  const setStep = useWizardStore((s) => s.setStep);

  const startedRef = useRef(false);

  const draftMutation = useMutation({
    mutationFn: draftStory,
    onSuccess: (res) => setDraft(res.title, res.pages),
    onError: (e) => toast(errorMessage(e), "error"),
  });

  function runDraft() {
    draftMutation.mutate({
      character_ids: characterIds,
      theme,
      reading_level: readingLevel,
      page_count: pageCount,
    });
  }

  // Kick off the draft exactly once when we arrive at this step with no story yet.
  useEffect(() => {
    if (pages.length === 0 && !startedRef.current) {
      startedRef.current = true;
      runDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startOverStory() {
    startedRef.current = true;
    setDraft("", []);
    runDraft();
  }

  // ---------- Per-page rewrite ----------
  const [revisingPageNo, setRevisingPageNo] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");

  const reviseMutation = useMutation({
    mutationFn: () => {
      if (revisingPageNo === null) throw new Error("No page selected.");
      return reviseStoryPage({
        title,
        pages,
        page_no: revisingPageNo,
        instruction,
        reading_level: readingLevel,
        character_ids: characterIds,
      });
    },
    onSuccess: (res) => {
      replacePage(res.page);
      toast("Page rewritten!", "success");
      setRevisingPageNo(null);
      setInstruction("");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const createBookMutation = useMutation({
    mutationFn: () =>
      createWizardBook({
        title,
        character_ids: characterIds,
        reading_level: readingLevel,
        pages: [...pages]
          .sort((a, b) => a.page_no - b.page_no)
          .map((p) => ({ text: p.text, image_prompt: p.image_prompt })),
      }),
    onSuccess: (book) => {
      setBookId(book.id);
      setStep(4);
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const isDrafting = draftMutation.isPending || (pages.length === 0 && !draftMutation.isError);

  if (isDrafting) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="animate-bounce text-7xl">✍️</div>
        <p className="text-2xl font-extrabold text-gray-500">Writing your story… ✍️</p>
        <p className="max-w-sm text-sm font-semibold text-gray-400">
          This can take a couple of minutes while the storyteller dreams up the perfect tale.
        </p>
      </div>
    );
  }

  if (draftMutation.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-xl font-bold">{errorMessage(draftMutation.error)}</p>
        <button
          onClick={runDraft}
          className="rounded-full px-6 py-3 text-lg font-bold text-white"
          style={{ background: "var(--accent)" }}
        >
          Try again
        </button>
      </div>
    );
  }

  const sortedPages = [...pages].sort((a, b) => a.page_no - b.page_no);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="text-center">
        <h1 className="text-4xl font-black" style={{ color: "var(--accent-deep)" }}>
          Your story 📝
        </h1>
      </div>

      <section className="rounded-3xl bg-white p-6 shadow-md">
        <label className="mb-2 block text-sm font-extrabold text-gray-500">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-2xl border-2 border-transparent bg-[var(--sky)] px-5 py-4 text-2xl font-black outline-none focus:border-[var(--accent)]"
        />
      </section>

      {sortedPages.map((page) => (
        <section key={page.page_no} className="rounded-3xl bg-white p-6 shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-extrabold text-gray-400">Page {page.page_no}</span>
            {revisingPageNo !== page.page_no && (
              <button
                onClick={() => {
                  setRevisingPageNo(page.page_no);
                  setInstruction("");
                }}
                disabled={reviseMutation.isPending}
                className="rounded-full bg-[var(--sky)] px-4 py-1.5 text-xs font-extrabold text-gray-600 disabled:opacity-50"
              >
                ✨ Rewrite
              </button>
            )}
          </div>

          <AutoTextarea
            value={page.text}
            onChange={(v) => updatePageDraft(page.page_no, { text: v })}
            className="w-full rounded-2xl bg-[var(--sky)] px-5 py-4 text-lg font-semibold outline-none"
          />

          {revisingPageNo === page.page_no && (
            <div className="pop-in mt-3 rounded-2xl bg-[var(--sky)] p-4">
              <label className="mb-1 block text-xs font-bold text-gray-500">How should we change this page?</label>
              <input
                autoFocus
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Make it funnier"
                className="mb-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-bold outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setRevisingPageNo(null)}
                  className="rounded-full bg-white px-4 py-2 text-xs font-bold text-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() => reviseMutation.mutate()}
                  disabled={!instruction.trim() || reviseMutation.isPending}
                  className="rounded-full px-5 py-2 text-xs font-extrabold text-white shadow disabled:opacity-40"
                  style={{ background: "var(--accent)" }}
                >
                  {reviseMutation.isPending ? "Rewriting…" : "Rewrite page"}
                </button>
              </div>
            </div>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-extrabold text-gray-400">🎨 Picture idea</summary>
            <AutoTextarea
              value={page.image_prompt}
              onChange={(v) => updatePageDraft(page.page_no, { image_prompt: v })}
              className="mt-2 w-full rounded-2xl bg-[var(--sky)] px-4 py-3 text-sm font-semibold outline-none"
              minRows={2}
            />
          </details>
        </section>
      ))}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-4">
        <button
          onClick={() => setStep(2)}
          className="rounded-full bg-white px-6 py-3 text-lg font-extrabold text-gray-500 shadow"
        >
          ← Back
        </button>
        <button
          onClick={startOverStory}
          className="text-xs font-bold text-gray-400 underline decoration-dotted hover:text-gray-500"
        >
          Write a different story
        </button>
        <button
          onClick={() => createBookMutation.mutate()}
          disabled={createBookMutation.isPending || sortedPages.length === 0 || !title.trim()}
          className="rounded-full px-8 py-4 text-xl font-extrabold text-white shadow-md disabled:opacity-40"
          style={{ background: "var(--leaf)" }}
        >
          {createBookMutation.isPending ? "Setting up…" : "Looks good → make the pictures! 🎨"}
        </button>
      </div>
    </div>
  );
}
