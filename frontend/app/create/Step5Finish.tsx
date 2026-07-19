"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { finalizeBook, getJob } from "@/lib/wizard-api";
import { useWizardStore } from "@/stores/wizardStore";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^\d+\s\w[\w\s]*:\s*/, "");
  return "Something went wrong.";
}

export default function Step5Finish() {
  const toast = useToast();

  const bookId = useWizardStore((s) => s.bookId);
  const finalizeJobId = useWizardStore((s) => s.finalizeJobId);
  const setFinalizeJobId = useWizardStore((s) => s.setFinalizeJobId);
  const reset = useWizardStore((s) => s.reset);

  // Capture the book id once so the celebration screen still has it after reset() clears the store.
  const [finishedBookId] = useState(bookId);
  const startedRef = useRef(false);
  const resetDoneRef = useRef(false);

  const finalizeMutation = useMutation({
    mutationFn: () => finalizeBook(bookId!, { engine: "kokoro", voice: "af_heart" }),
    onSuccess: (res) => setFinalizeJobId(res.job_id),
    onError: (e) => toast(errorMessage(e), "error"),
  });

  useEffect(() => {
    if (bookId && !finalizeJobId && !startedRef.current && !finalizeMutation.isPending) {
      startedRef.current = true;
      finalizeMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, finalizeJobId]);

  const jobQuery = useQuery({
    queryKey: ["job", finalizeJobId],
    queryFn: () => getJob(finalizeJobId!),
    enabled: !!finalizeJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "error" ? false : 2000;
    },
  });

  const job = jobQuery.data;

  useEffect(() => {
    if (job?.status === "done" && !resetDoneRef.current) {
      resetDoneRef.current = true;
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  if (!bookId && !finishedBookId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-xl font-bold">Something went missing — let&apos;s start a new story.</p>
        <Link href="/create" className="rounded-full bg-white px-6 py-3 text-lg font-extrabold text-gray-500 shadow">
          Start over
        </Link>
      </div>
    );
  }

  if (job?.status === "done") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <div className="pop-in text-8xl">🎉</div>
        <h1 className="text-4xl font-black" style={{ color: "var(--accent-deep)" }}>
          Your book is ready!
        </h1>
        <p className="max-w-sm text-lg font-semibold text-gray-400">
          It&apos;s all narrated and waiting in your library.
        </p>
        <div className="flex gap-4">
          <Link
            href={`/read/${finishedBookId}`}
            className="rounded-full px-8 py-4 text-xl font-extrabold text-white shadow-md"
            style={{ background: "var(--accent)" }}
          >
            Read it now 📖
          </Link>
          <Link href="/" className="rounded-full bg-white px-8 py-4 text-xl font-extrabold text-gray-500 shadow">
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  if (job?.status === "error" || finalizeMutation.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-xl font-bold">{job?.error ?? errorMessage(finalizeMutation.error)}</p>
        <button
          onClick={() => {
            setFinalizeJobId(null);
            startedRef.current = true;
            finalizeMutation.mutate();
          }}
          className="rounded-full px-6 py-3 text-lg font-bold text-white"
          style={{ background: "var(--accent)" }}
        >
          Try again
        </button>
      </div>
    );
  }

  const pct = Math.round(Math.min(1, Math.max(0, job?.progress ?? 0)) * 100);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="animate-bounce text-7xl">🎙️</div>
      <p className="text-2xl font-extrabold text-gray-500">Teaching the storyteller your book… 🎙️</p>
      <p className="max-w-sm text-sm font-semibold text-gray-400">
        We&apos;re recording every page so it can be read aloud. Almost there!
      </p>
      <div className="h-4 w-full max-w-sm overflow-hidden rounded-full" style={{ background: "var(--sky)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}
