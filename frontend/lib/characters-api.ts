import { mediaUrl } from "@/lib/api";

export { mediaUrl };

export interface Style {
  id: number;
  name: string;
  is_preset: boolean;
  master_prompt: string;
  negative_prompt: string | null;
  thumbnail_url: string | null;
}

export type CharacterStatus = "draft" | "locked";

export interface CharacterSummary {
  id: number;
  name: string;
  status: CharacterStatus;
  description: string;
  style_id: number;
  style_name: string;
  thumbnail_url: string | null;
}

export type ImageKind = "source_photo" | "base_candidate" | "sheet" | "sheet_extra" | "ref_crop";

export interface CharacterImage {
  id: number;
  kind: ImageKind;
  url: string;
  seed: number | null;
}

export interface CharacterDetail {
  id: number;
  name: string;
  description: string;
  status: CharacterStatus;
  style: { id: number; name: string; master_prompt: string };
  identity_prompt: string | null;
  source_photo_url: string | null;
  ref_image_url: string | null;
  sheet_image_url: string | null;
  seed: number | null;
  images: CharacterImage[];
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: number | string;
  kind: string;
  status: JobStatus;
  progress: number;
  result: unknown;
  error: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function patchJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------- Styles ----------

export function listStyles(): Promise<Style[]> {
  return request<Style[]>("/api/styles");
}

export function createStyle(input: { name: string; master_prompt: string; negative_prompt?: string }): Promise<Style> {
  return postJson<Style>("/api/styles", input);
}

export function updateStyle(
  id: number,
  patch: Partial<{ name: string; master_prompt: string; negative_prompt: string }>
): Promise<Style> {
  return patchJson<Style>(`/api/styles/${id}`, patch);
}

export function deleteStyle(id: number): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/api/styles/${id}`, { method: "DELETE" });
}

// ---------- Characters ----------

export function listCharacters(): Promise<CharacterSummary[]> {
  return request<CharacterSummary[]>("/api/characters");
}

export function getCharacter(id: number | string): Promise<CharacterDetail> {
  return request<CharacterDetail>(`/api/characters/${id}`);
}

export function createCharacter(input: {
  name: string;
  description: string;
  style_id: number;
  photo?: File | null;
}): Promise<CharacterDetail> {
  const form = new FormData();
  form.append("name", input.name);
  form.append("description", input.description);
  form.append("style_id", String(input.style_id));
  if (input.photo) form.append("photo", input.photo);
  return request<CharacterDetail>("/api/characters", { method: "POST", body: form });
}

export function updateCharacter(
  id: number | string,
  patch: Partial<{ name: string; description: string; style_id: number }>
): Promise<CharacterDetail> {
  return patchJson<CharacterDetail>(`/api/characters/${id}`, patch);
}

export function deleteCharacter(id: number | string): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/api/characters/${id}`, { method: "DELETE" });
}

export function generateBaseImage(
  id: number | string,
  input?: { prompt_override?: string; seed?: number; count?: number }
): Promise<{ job_id: number | string }> {
  return postJson(`/api/characters/${id}/base-image`, input ?? {});
}

export function generateSheet(
  id: number | string,
  input?: { seed?: number; source_image_id?: number }
): Promise<{ job_id: number | string }> {
  return postJson(`/api/characters/${id}/sheet`, input ?? {});
}

export function createRefCrop(
  id: number | string,
  input: { image_id: number; x: number; y: number; w: number; h: number }
): Promise<CharacterImage> {
  return postJson<CharacterImage>(`/api/characters/${id}/ref-crop`, input);
}

export function generateIdentityPrompt(id: number | string): Promise<{ identity_prompt: string }> {
  return postJson(`/api/characters/${id}/identity-prompt`);
}

export function lockCharacter(
  id: number | string,
  input?: { ref_image_id?: number; identity_prompt?: string }
): Promise<CharacterDetail> {
  return postJson<CharacterDetail>(`/api/characters/${id}/lock`, input ?? {});
}

export function unlockCharacter(id: number | string): Promise<CharacterDetail> {
  return postJson<CharacterDetail>(`/api/characters/${id}/unlock`);
}

export interface ImportLegacyResult {
  imported: number;
  characters: number[];
  errors: { index: number; error: string }[];
}

export function importLegacyCharacters(file: File): Promise<ImportLegacyResult> {
  const form = new FormData();
  form.append("file", file);
  return request<ImportLegacyResult>("/api/characters/import-legacy", { method: "POST", body: form });
}

// ---------- Jobs ----------

export function getJob(id: number | string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`);
}
