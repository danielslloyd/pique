"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { friendlyJobError } from "@/lib/job-errors";
import {
  createRefCrop,
  deleteCharacter,
  generateBaseImage,
  generateIdentityPrompt,
  generateSheet,
  getCharacter,
  getJob,
  lockCharacter,
  mediaUrl,
  unlockCharacter,
  updateCharacter,
} from "@/lib/characters-api";

function isConflict(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("409");
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^\d+\s\w[\w\s]*:\s*/, "");
  return "Something went wrong.";
}

type ActiveJob = { id: number | string; kind: "base-image" | "sheet" } | null;

export default function CharacterStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const characterQuery = useQuery({ queryKey: ["character", id], queryFn: () => getCharacter(id) });
  const character = characterQuery.data;

  const refetchCharacter = () => queryClient.invalidateQueries({ queryKey: ["character", id] });

  // ---------- Header: inline name edit ----------
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    if (character && !editingName) setNameDraft(character.name);
  }, [character, editingName]);

  const renameMutation = useMutation({
    mutationFn: (name: string) => updateCharacter(id, { name }),
    onSuccess: () => {
      toast("Name updated!", "success");
      setEditingName(false);
      refetchCharacter();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCharacter(id),
    onSuccess: () => {
      toast("Character deleted.", "info");
      router.push("/characters");
    },
    onError: (e) => {
      if (isConflict(e)) toast("This character is starring in a book, so it can't be deleted.", "error");
      else toast(errorMessage(e), "error");
    },
  });

  // ---------- Job polling (draw / sheet) ----------
  const [activeJob, setActiveJob] = useState<ActiveJob>(null);
  const jobQuery = useQuery({
    queryKey: ["job", activeJob?.id],
    queryFn: () => getJob(activeJob!.id),
    enabled: !!activeJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "error" ? false : 2000;
    },
  });

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !activeJob) return;
    if (job.status === "done") {
      toast(
        activeJob.kind === "base-image" ? "Your character is drawn!" : "Character sheet is ready!",
        "success"
      );
      setActiveJob(null);
      refetchCharacter();
    } else if (job.status === "error") {
      toast(friendlyJobError(job.error, "That didn't work."), "error");
      setActiveJob(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobQuery.data]);

  const drawMutation = useMutation({
    mutationFn: () => generateBaseImage(id),
    onSuccess: (res) => setActiveJob({ id: res.job_id, kind: "base-image" }),
    onError: (e) => toast(errorMessage(e), "error"),
  });

  // ---------- Candidate selection + sheet ----------
  const images = character?.images ?? [];
  const sourcePhoto = images.find((img) => img.kind === "source_photo");
  const candidates = images.filter((img) => img.kind === "source_photo" || img.kind === "base_candidate");

  const [selectedImageId, setSelectedImageId] = useState<number | null>(null);
  useEffect(() => {
    if (selectedImageId === null && candidates.length > 0) {
      setSelectedImageId(sourcePhoto?.id ?? candidates[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.length]);

  const sheetMutation = useMutation({
    mutationFn: () => generateSheet(id, selectedImageId ? { source_image_id: selectedImageId } : undefined),
    onSuccess: (res) => setActiveJob({ id: res.job_id, kind: "sheet" }),
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const showDrawButton = character?.status === "draft" && !character.source_photo_url && candidates.length === 0;
  const canMakeSheet = !!selectedImageId || !!character?.source_photo_url;

  // ---------- Sheet image + crop picker ----------
  const sheetImage = images.find((img) => img.kind === "sheet");
  const sheetUrl = character?.sheet_image_url ?? sheetImage?.url ?? null;

  const [cropMode, setCropMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [finalRect, setFinalRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  function imageRect() {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0, w: 0, h: 0 };
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!naturalSize) return { x: 0, y: 0, w: cw, h: ch };
    const containerRatio = cw / ch;
    const imageRatio = naturalSize.w / naturalSize.h;
    let w: number, h: number;
    if (imageRatio > containerRatio) {
      w = cw;
      h = cw / imageRatio;
    } else {
      h = ch;
      w = ch * imageRatio;
    }
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  function clampToImage(x: number, y: number) {
    const rect = imageRect();
    return {
      x: Math.min(Math.max(x, rect.x), rect.x + rect.w),
      y: Math.min(Math.max(y, rect.y), rect.y + rect.h),
    };
  }

  function localCoords(e: React.MouseEvent) {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const bounds = container.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!cropMode) return;
    const { x, y } = localCoords(e);
    const p = clampToImage(x, y);
    setDragStart(p);
    setDragCurrent(p);
    setFinalRect(null);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!cropMode || !dragStart) return;
    const { x, y } = localCoords(e);
    setDragCurrent(clampToImage(x, y));
  }

  function onMouseUp() {
    if (!cropMode || !dragStart || !dragCurrent) return;
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    setDragStart(null);
    setDragCurrent(null);
    if (w > 8 && h > 8) setFinalRect({ x, y, w, h });
  }

  const dragRectPx =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          w: Math.abs(dragCurrent.x - dragStart.x),
          h: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;
  const visibleRect = dragRectPx ?? finalRect;

  const refCropMutation = useMutation({
    mutationFn: () => {
      if (!finalRect || !sheetImage) throw new Error("Pick a crop first.");
      const rect = imageRect();
      const x = (finalRect.x - rect.x) / rect.w;
      const y = (finalRect.y - rect.y) / rect.h;
      const w = finalRect.w / rect.w;
      const h = finalRect.h / rect.h;
      return createRefCrop(id, {
        image_id: sheetImage.id,
        x: clamp01(x),
        y: clamp01(y),
        w: clamp01(w),
        h: clamp01(h),
      });
    },
    onSuccess: () => {
      toast("Reference crop saved!", "success");
      setCropMode(false);
      setFinalRect(null);
      refetchCharacter();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  // ---------- Identity prompt ----------
  const [identityPrompt, setIdentityPrompt] = useState("");
  const identityInitialized = useRef(false);
  useEffect(() => {
    if (character && !identityInitialized.current) {
      setIdentityPrompt(character.identity_prompt ?? "");
      identityInitialized.current = true;
    }
  }, [character]);

  const identityMutation = useMutation({
    mutationFn: () => generateIdentityPrompt(id),
    onSuccess: (res) => {
      setIdentityPrompt(res.identity_prompt);
      toast("Description written!", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  // ---------- Lock / unlock ----------
  const canLock = !!character?.ref_image_url && identityPrompt.trim().length > 0;

  const lockMutation = useMutation({
    mutationFn: () =>
      lockCharacter(id, {
        ref_image_id: images.find((img) => img.kind === "ref_crop")?.id,
        identity_prompt: identityPrompt,
      }),
    onSuccess: () => {
      toast("Character locked! Ready to star in a story.", "success");
      refetchCharacter();
    },
    onError: (e) => {
      if (isConflict(e)) toast("Couldn't lock — this character is already in a book.", "error");
      else toast(errorMessage(e), "error");
    },
  });

  const unlockMutation = useMutation({
    mutationFn: () => unlockCharacter(id),
    onSuccess: () => {
      toast("Character unlocked for editing.", "info");
      refetchCharacter();
    },
    onError: (e) => {
      if (isConflict(e)) toast("Couldn't unlock — this character is already in a book.", "error");
      else toast(errorMessage(e), "error");
    },
  });

  if (characterQuery.isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-2xl font-bold">Loading…</main>;
  }
  if (characterQuery.isError || !character) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-2xl font-bold">Couldn&apos;t load this character.</p>
        <Link href="/characters" className="rounded-full bg-white px-6 py-3 font-bold text-gray-500 shadow">
          Back to Characters
        </Link>
      </main>
    );
  }

  const isDraft = character.status === "draft";
  const refImageUrl = mediaUrl(character.ref_image_url);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-8">
      {/* Header */}
      <header className="rounded-3xl bg-white p-6 shadow-md">
        <div className="mb-3 flex items-center justify-between">
          <Link href="/characters" className="rounded-full bg-[var(--sky)] px-4 py-2 text-sm font-bold text-gray-500">
            ← Characters
          </Link>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-4 py-1 text-sm font-extrabold"
              style={{ background: "var(--sky)", color: "var(--accent-deep)" }}
            >
              {character.style.name}
            </span>
            <span
              className={`rounded-full px-4 py-1 text-sm font-extrabold ${
                isDraft ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700"
              }`}
            >
              {isDraft ? "Draft" : "🔒 Locked"}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          {editingName && isDraft ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => nameDraft.trim() && renameMutation.mutate(nameDraft.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setNameDraft(character.name);
                  setEditingName(false);
                }
              }}
              className="w-full rounded-2xl bg-[var(--sky)] px-4 py-2 text-4xl font-black outline-none"
            />
          ) : (
            <h1
              onClick={() => isDraft && setEditingName(true)}
              className={`text-4xl font-black ${isDraft ? "cursor-pointer hover:opacity-70" : ""}`}
              style={{ color: "var(--accent-deep)" }}
              title={isDraft ? "Click to rename" : undefined}
            >
              {character.name} {isDraft && <span className="text-lg text-gray-300">✎</span>}
            </h1>
          )}

          {isDraft && (
            <button
              onClick={() => {
                if (window.confirm(`Delete ${character.name}? This can't be undone.`)) deleteMutation.mutate();
              }}
              className="shrink-0 rounded-full bg-red-50 px-5 py-2 text-sm font-extrabold text-red-400 hover:bg-red-100"
            >
              Delete
            </button>
          )}
        </div>

        {character.description && <p className="mt-2 text-gray-400">{character.description}</p>}
      </header>

      {/* Draw from scratch */}
      {showDrawButton && (
        <section className="flex flex-col items-center gap-4 rounded-3xl bg-white p-10 text-center shadow-md">
          <div className="text-6xl">🖌️</div>
          <p className="max-w-sm text-lg font-semibold text-gray-400">
            No photo yet — let&apos;s draw {character.name} from the description instead.
          </p>
          <button
            onClick={() => drawMutation.mutate()}
            disabled={drawMutation.isPending || !!activeJob}
            className="rounded-full px-8 py-4 text-xl font-extrabold text-white shadow-md disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {drawMutation.isPending ? "Starting…" : "Draw my character"}
          </button>
        </section>
      )}

      {activeJob && (
        <JobProgress
          label={
            activeJob.kind === "base-image"
              ? "Drawing your character…"
              : "Making the character sheet — this takes a few minutes…"
          }
          progress={jobQuery.data?.progress ?? 0}
        />
      )}

      {/* Candidate strip */}
      {candidates.length > 0 && (
        <section className="rounded-3xl bg-white p-6 shadow-md">
          <h2 className="mb-4 text-xl font-extrabold">Pick a starting image</h2>
          <div className="mb-4 flex flex-wrap gap-4">
            {candidates.map((img) => (
              <button
                key={img.id}
                onClick={() => setSelectedImageId(img.id)}
                className="w-28 shrink-0 overflow-hidden rounded-2xl shadow transition-transform hover:-translate-y-0.5"
                style={
                  selectedImageId === img.id
                    ? { boxShadow: "0 0 0 4px var(--accent)" }
                    : { boxShadow: "0 0 0 2px transparent" }
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(img.url) ?? ""} alt="" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
          <button
            onClick={() => sheetMutation.mutate()}
            disabled={!canMakeSheet || sheetMutation.isPending || !!activeJob}
            className="rounded-full px-6 py-3 text-lg font-extrabold text-white shadow disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {sheetMutation.isPending ? "Starting…" : "Make character sheet"}
          </button>
        </section>
      )}

      {/* Sheet + crop */}
      {sheetUrl && (
        <section className="rounded-3xl bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-extrabold">Character sheet</h2>
            {!isDraft ? null : !cropMode ? (
              <button
                onClick={() => {
                  setCropMode(true);
                  setFinalRect(null);
                }}
                className="rounded-full bg-[var(--sky)] px-5 py-2 text-sm font-extrabold text-gray-600"
              >
                Pick reference crop
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCropMode(false);
                    setFinalRect(null);
                  }}
                  className="rounded-full bg-gray-100 px-4 py-2 text-sm font-bold text-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() => refCropMutation.mutate()}
                  disabled={!finalRect || refCropMutation.isPending}
                  className="rounded-full px-5 py-2 text-sm font-extrabold text-white shadow disabled:opacity-40"
                  style={{ background: "var(--accent)" }}
                >
                  {refCropMutation.isPending ? "Saving…" : "Use this crop"}
                </button>
              </div>
            )}
          </div>

          {cropMode && (
            <p className="mb-3 text-sm font-semibold text-gray-400">
              Drag a box over the sheet to pick the best reference pose.
            </p>
          )}

          <div
            ref={containerRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-2xl"
            style={{ background: "var(--sky)", cursor: cropMode ? "crosshair" : "default" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(sheetUrl) ?? ""}
              alt="Character sheet"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              className="absolute inset-0 h-full w-full object-contain"
            />
            {cropMode && visibleRect && (
              <div
                className="pointer-events-none absolute border-4"
                style={{
                  left: visibleRect.x,
                  top: visibleRect.y,
                  width: visibleRect.w,
                  height: visibleRect.h,
                  borderColor: "var(--accent)",
                  background: "rgba(255,138,92,0.2)",
                }}
              />
            )}
          </div>

          {refImageUrl && (
            <div className="mt-4">
              <div className="mb-1 text-sm font-extrabold text-gray-500">Reference crop</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={refImageUrl} alt="Reference crop" className="h-32 w-32 rounded-2xl object-cover shadow" />
            </div>
          )}
        </section>
      )}

      {/* Identity prompt */}
      {sheetUrl && (
        <section className="rounded-3xl bg-white p-6 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl font-extrabold">Character description</h2>
            {isDraft && (
              <button
                onClick={() => identityMutation.mutate()}
                disabled={identityMutation.isPending}
                className="rounded-full bg-[var(--sky)] px-5 py-2 text-sm font-extrabold text-gray-600 disabled:opacity-50"
              >
                {identityMutation.isPending ? "Writing…" : "Describe my character"}
              </button>
            )}
          </div>
          <p className="mb-3 text-sm font-semibold text-gray-400">
            This description keeps {character.name} looking the same in every story.
          </p>
          <textarea
            value={identityPrompt}
            onChange={(e) => setIdentityPrompt(e.target.value)}
            readOnly={!isDraft}
            rows={4}
            placeholder="A description will appear here…"
            className="w-full rounded-2xl bg-[var(--sky)] px-5 py-4 text-base font-semibold outline-none focus:ring-2 read-only:opacity-70"
            style={{ outlineColor: "var(--accent)" }}
          />
        </section>
      )}

      {/* Lock */}
      {sheetUrl && (
        <section className="flex flex-col items-center gap-3 rounded-3xl bg-white p-8 text-center shadow-md">
          {isDraft ? (
            <>
              <button
                onClick={() => lockMutation.mutate()}
                disabled={!canLock || lockMutation.isPending}
                className="rounded-full px-10 py-4 text-2xl font-extrabold text-white shadow-md disabled:opacity-40"
                style={{ background: "var(--leaf)" }}
              >
                {lockMutation.isPending ? "Locking…" : "Lock character 🔒"}
              </button>
              {!canLock && (
                <p className="text-sm font-semibold text-gray-400">
                  Pick a reference crop and write a description first.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-lg font-extrabold text-green-700">🔒 This character is locked and ready for stories!</p>
              <p className="max-w-sm text-sm font-semibold text-gray-400">
                Unlocking lets you change the look and description again, but any books already using this character
                won&apos;t be affected.
              </p>
              <button
                onClick={() => unlockMutation.mutate()}
                disabled={unlockMutation.isPending}
                className="rounded-full bg-red-50 px-6 py-3 text-lg font-extrabold text-red-400 hover:bg-red-100 disabled:opacity-50"
              >
                {unlockMutation.isPending ? "Unlocking…" : "Unlock character"}
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function JobProgress({ label, progress }: { label: string; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <section className="rounded-3xl bg-white p-6 shadow-md">
      <p className="mb-3 text-center text-lg font-extrabold text-gray-500">{label}</p>
      <div className="h-4 w-full overflow-hidden rounded-full" style={{ background: "var(--sky)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
    </section>
  );
}
