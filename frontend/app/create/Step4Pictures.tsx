"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { friendlyJobError } from "@/lib/job-errors";
import {
  approvePageImage,
  generatePageImage,
  getJob,
  getWizardBook,
  mediaUrl,
  type WizardPageInfo,
} from "@/lib/wizard-api";
import { useWizardStore } from "@/stores/wizardStore";
import AutoTextarea from "./AutoTextarea";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^\d+\s\w[\w\s]*:\s*/, "");
  return "Something went wrong.";
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

type ActiveJob = { pageNo: number; jobId: number | string } | null;

export default function Step4Pictures() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const bookId = useWizardStore((s) => s.bookId);
  const setStep = useWizardStore((s) => s.setStep);

  const bookQuery = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getWizardBook(bookId!),
    enabled: !!bookId,
  });

  const invalidateBook = () => queryClient.invalidateQueries({ queryKey: ["book", bookId] });

  const [activeJob, setActiveJob] = useState<ActiveJob>(null);
  const [autoQueue, setAutoQueue] = useState(false);
  const [editingPromptPageNo, setEditingPromptPageNo] = useState<number | null>(null);
  const [promptDraft, setPromptDraft] = useState("");

  const jobQuery = useQuery({
    queryKey: ["job", activeJob?.jobId],
    queryFn: () => getJob(activeJob!.jobId),
    enabled: !!activeJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "error" ? false : 2000;
    },
  });

  const generateMutation = useMutation({
    mutationFn: ({ pageNo, opts }: { pageNo: number; opts?: { seed?: number; prompt_override?: string } }) =>
      generatePageImage(bookId!, pageNo, opts),
    onSuccess: (res, vars) => setActiveJob({ pageNo: vars.pageNo, jobId: res.job_id }),
    onError: (e) => {
      toast(errorMessage(e), "error");
      setAutoQueue(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (pageNo: number) => approvePageImage(bookId!, pageNo),
    onSuccess: () => {
      toast("Kept!", "success");
      invalidateBook();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  function startGenerate(pageNo: number, opts?: { seed?: number; prompt_override?: string }) {
    generateMutation.mutate({ pageNo, opts });
  }

  // React to job completion/failure.
  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !activeJob) return;
    if (job.status === "done") {
      invalidateBook();
      setActiveJob(null);
    } else if (job.status === "error") {
      toast(friendlyJobError(job.error, "That picture didn't work out."), "error");
      setActiveJob(null);
      setAutoQueue(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobQuery.data]);

  // Auto-queue: whenever nothing is running and the queue is on, paint the next pending page.
  useEffect(() => {
    if (!autoQueue || activeJob) return;
    const book = bookQuery.data;
    if (!book) return;
    const next = book.pages.find((p) => p.image_status === "pending");
    if (next) {
      startGenerate(next.page_no);
    } else {
      setAutoQueue(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoQueue, activeJob, bookQuery.data]);

  if (!bookId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-xl font-bold">No book yet — go back and write the story first.</p>
        <button
          onClick={() => setStep(3)}
          className="rounded-full bg-white px-6 py-3 text-lg font-extrabold text-gray-500 shadow"
        >
          ← Back to story
        </button>
      </div>
    );
  }

  if (bookQuery.isLoading) {
    return <div className="flex flex-1 items-center justify-center text-2xl font-bold">Loading…</div>;
  }

  if (bookQuery.isError || !bookQuery.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-xl font-bold">Couldn&apos;t load this book.</p>
        <button
          onClick={() => bookQuery.refetch()}
          className="rounded-full px-6 py-3 text-lg font-bold text-white"
          style={{ background: "var(--accent)" }}
        >
          Try again
        </button>
      </div>
    );
  }

  const book = bookQuery.data;
  const sortedPages = [...book.pages].sort((a, b) => a.page_no - b.page_no);
  const isGenerating = !!activeJob;
  const pendingCount = sortedPages.filter((p) => p.image_status === "pending").length;
  const allApproved = sortedPages.length > 0 && sortedPages.every((p) => p.image_status === "approved");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="text-center">
        <h1 className="text-4xl font-black" style={{ color: "var(--accent-deep)" }}>
          The pictures 🎨
        </h1>
        <p className="mt-2 text-lg font-semibold text-gray-400">{book.title}</p>
      </div>

      {pendingCount > 0 && (
        <div className="flex justify-center">
          <button
            onClick={() => setAutoQueue((v) => !v)}
            disabled={isGenerating && !autoQueue}
            className="rounded-full px-6 py-3 text-lg font-extrabold text-white shadow disabled:opacity-40"
            style={{ background: autoQueue ? "var(--ink)" : "var(--leaf)" }}
          >
            {autoQueue ? "Stop painting" : `🖌️ Paint all remaining (${pendingCount})`}
          </button>
        </div>
      )}

      {sortedPages.map((page) => (
        <PageCard
          key={page.page_no}
          page={page}
          isThisJobRunning={activeJob?.pageNo === page.page_no}
          jobProgress={jobQuery.data?.progress ?? 0}
          isGenerating={isGenerating}
          onPaint={() => startGenerate(page.page_no)}
          onKeep={() => approveMutation.mutate(page.page_no)}
          onTryAgain={() => startGenerate(page.page_no, { seed: randomSeed() })}
          editingPrompt={editingPromptPageNo === page.page_no}
          promptDraft={promptDraft}
          onOpenPromptEditor={() => {
            setEditingPromptPageNo(page.page_no);
            setPromptDraft(page.image_prompt);
          }}
          onClosePromptEditor={() => setEditingPromptPageNo(null)}
          onPromptDraftChange={setPromptDraft}
          onRegenerateWithPrompt={() => {
            startGenerate(page.page_no, { prompt_override: promptDraft });
            setEditingPromptPageNo(null);
          }}
          approvePending={approveMutation.isPending}
        />
      ))}

      <div className="mt-auto flex items-center justify-between gap-4 pt-4">
        <button
          onClick={() => setStep(3)}
          className="rounded-full bg-white px-6 py-3 text-lg font-extrabold text-gray-500 shadow"
        >
          ← Back
        </button>
        {allApproved ? (
          <button
            onClick={() => setStep(5)}
            className="pop-in rounded-full px-8 py-4 text-xl font-extrabold text-white shadow-md"
            style={{ background: "var(--accent)" }}
          >
            Finish my book! 🎉
          </button>
        ) : (
          <span className="text-sm font-semibold text-gray-400">Keep every page&apos;s picture to finish.</span>
        )}
      </div>
    </div>
  );
}

function PageCard({
  page,
  isThisJobRunning,
  jobProgress,
  isGenerating,
  onPaint,
  onKeep,
  onTryAgain,
  editingPrompt,
  promptDraft,
  onOpenPromptEditor,
  onClosePromptEditor,
  onPromptDraftChange,
  onRegenerateWithPrompt,
  approvePending,
}: {
  page: WizardPageInfo;
  isThisJobRunning: boolean;
  jobProgress: number;
  isGenerating: boolean;
  onPaint: () => void;
  onKeep: () => void;
  onTryAgain: () => void;
  editingPrompt: boolean;
  promptDraft: string;
  onOpenPromptEditor: () => void;
  onClosePromptEditor: () => void;
  onPromptDraftChange: (v: string) => void;
  onRegenerateWithPrompt: () => void;
  approvePending: boolean;
}) {
  const imageUrl = mediaUrl(page.image_url);

  return (
    <section className="rounded-3xl bg-white p-6 shadow-md">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-extrabold text-gray-400">Page {page.page_no}</span>
        {page.image_status === "approved" && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-extrabold text-green-700">
            ✅ Approved
          </span>
        )}
      </div>

      <p className="mb-4 text-lg font-semibold">{page.text}</p>

      <div
        className="relative mb-4 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl"
        style={{ background: "var(--sky)" }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="text-5xl">🖼️</div>
        )}
      </div>

      {isThisJobRunning ? (
        <JobProgress progress={jobProgress} />
      ) : page.image_status === "pending" ? (
        <button
          onClick={onPaint}
          disabled={isGenerating}
          className="rounded-full px-6 py-3 text-lg font-extrabold text-white shadow disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          Paint this page 🎨
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {page.image_status !== "approved" && (
            <button
              onClick={onKeep}
              disabled={approvePending}
              className="rounded-full px-5 py-2 text-sm font-extrabold text-white shadow disabled:opacity-40"
              style={{ background: "var(--leaf)" }}
            >
              ❤️ Keep it
            </button>
          )}
          <button
            onClick={onTryAgain}
            disabled={isGenerating}
            className="rounded-full bg-[var(--sky)] px-5 py-2 text-sm font-extrabold text-gray-600 disabled:opacity-40"
          >
            🎲 Try again
          </button>
          {!editingPrompt && (
            <button
              onClick={onOpenPromptEditor}
              disabled={isGenerating}
              className="rounded-full bg-[var(--sky)] px-5 py-2 text-sm font-extrabold text-gray-600 disabled:opacity-40"
            >
              ✏️ Change the scene
            </button>
          )}
        </div>
      )}

      {editingPrompt && (
        <div className="pop-in mt-3 rounded-2xl bg-[var(--sky)] p-4">
          <label className="mb-1 block text-xs font-bold text-gray-500">Describe the picture</label>
          <AutoTextarea
            value={promptDraft}
            onChange={onPromptDraftChange}
            className="mb-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold outline-none"
            minRows={2}
          />
          <div className="flex gap-2">
            <button onClick={onClosePromptEditor} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-gray-500">
              Cancel
            </button>
            <button
              onClick={onRegenerateWithPrompt}
              disabled={isGenerating || !promptDraft.trim()}
              className="rounded-full px-5 py-2 text-xs font-extrabold text-white shadow disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              Repaint with this scene
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function JobProgress({ progress }: { progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div>
      <p className="mb-2 text-sm font-extrabold text-gray-500">Painting… 🎨</p>
      <div className="h-4 w-full overflow-hidden rounded-full" style={{ background: "var(--sky)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}
