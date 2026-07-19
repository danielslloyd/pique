// Friendlier copy for image-job failures. ComfyUI is a separate service; when it isn't
// running the backend surfaces a connection/unreachable error that means nothing to a
// parent, so we translate those into a plain-language hint.

export function friendlyJobError(raw: string | null | undefined, fallback: string): string {
  const msg = raw ?? fallback;
  if (/connection|unreachable/i.test(msg)) {
    return "Couldn't reach the picture maker. Make sure ComfyUI is running (it draws the pictures).";
  }
  return msg;
}
