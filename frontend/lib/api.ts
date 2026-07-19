export const MEDIA_BASE = "http://localhost:8010";

export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  return `${MEDIA_BASE}${path}`;
}

export interface BookSummary {
  id: number;
  title: string;
  author: string;
  status: string;
  source: string;
  reading_level: string;
  page_count: number;
  thumbnail_url: string | null;
}

export interface PageInfo {
  id: number;
  page_no: number;
  text: string;
  image_url: string | null;
  image_status: string;
}

export interface BookDetail extends BookSummary {
  description: string;
  pages: PageInfo[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function listBooks(): Promise<BookSummary[]> {
  return request<BookSummary[]>("/api/books");
}

export function getBook(id: number | string): Promise<BookDetail> {
  return request<BookDetail>(`/api/books/${id}`);
}

export function importRbook(file: File): Promise<BookSummary> {
  const form = new FormData();
  form.append("file", file);
  return request<BookSummary>("/api/books/import-rbook", { method: "POST", body: form });
}

export function deleteBook(id: number): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/api/books/${id}`, { method: "DELETE" });
}
