import { mediaUrl } from "@/lib/api";
import type { Job } from "@/lib/characters-api";

export { mediaUrl };
export type { Job };

export type ReadingLevel = "pre-k" | "k" | "1st";

export interface DraftPage {
  page_no: number;
  text: string;
  image_prompt: string;
}

export interface DraftResult {
  title: string;
  pages: DraftPage[];
}

export type ImageStatus = "pending" | "candidate" | "approved";

export interface WizardPageInfo {
  id: number;
  page_no: number;
  text: string;
  image_prompt: string;
  image_seed: number | null;
  image_url: string | null;
  image_status: ImageStatus;
}

export interface WizardBookDetail {
  id: number;
  title: string;
  author: string;
  status: string;
  source: string;
  reading_level: string;
  page_count: number;
  thumbnail_url: string | null;
  description: string;
  pages: WizardPageInfo[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

function postJson<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
}

function patchJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------- Story drafting (LLM — can take 60-180s) ----------

/** Long-timeout POST for the story draft/revise calls, which invoke a slow LLM. */
function postJsonLongTimeout<T>(path: string, body: unknown, timeoutMs = 240_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return postJson<T>(path, body, controller.signal).finally(() => clearTimeout(timer));
}

export function draftStory(input: {
  character_ids: number[];
  theme: string;
  reading_level: ReadingLevel;
  page_count: number;
}): Promise<DraftResult> {
  return postJsonLongTimeout<DraftResult>("/api/stories/draft", input);
}

export function reviseStoryPage(input: {
  title: string;
  pages: DraftPage[];
  page_no: number;
  instruction: string;
  reading_level: ReadingLevel;
  character_ids: number[];
}): Promise<{ page: DraftPage }> {
  return postJsonLongTimeout<{ page: DraftPage }>("/api/stories/revise", input);
}

// ---------- Wizard book creation ----------

export function createWizardBook(input: {
  title: string;
  character_ids: number[];
  reading_level: ReadingLevel;
  pages: { text: string; image_prompt: string }[];
}): Promise<WizardBookDetail> {
  return postJson<WizardBookDetail>("/api/books/wizard", input);
}

export function getWizardBook(id: number | string): Promise<WizardBookDetail> {
  return request<WizardBookDetail>(`/api/books/${id}`);
}

export function generatePageImage(
  bookId: number | string,
  pageNo: number,
  input?: { seed?: number; prompt_override?: string }
): Promise<{ job_id: number | string }> {
  return postJson(`/api/books/${bookId}/pages/${pageNo}/image`, input ?? {});
}

export function approvePageImage(
  bookId: number | string,
  pageNo: number
): Promise<{ approved: boolean }> {
  return postJson(`/api/books/${bookId}/pages/${pageNo}/approve`);
}

export function updateWizardPage(
  bookId: number | string,
  pageNo: number,
  patch: Partial<{ text: string; image_prompt: string }>
): Promise<WizardPageInfo> {
  return patchJson<WizardPageInfo>(`/api/books/${bookId}/pages/${pageNo}`, patch);
}

export function finalizeBook(
  bookId: number | string,
  input: { engine: "kokoro"; voice: "af_heart" }
): Promise<{ job_id: number | string }> {
  return postJson(`/api/books/${bookId}/finalize`, input);
}

// ---------- Jobs (shared with character studio) ----------

export function getJob(id: number | string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`);
}
