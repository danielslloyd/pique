"use client";

import { useEffect } from "react";
import { useReaderStore } from "@/stores/readerStore";

const KIND_STYLES: Record<string, string> = {
  success: "bg-green-500",
  encourage: "bg-amber-400",
  info: "bg-sky-500",
  error: "bg-red-400",
};

export default function FeedbackToast() {
  const feedback = useReaderStore((s) => s.feedback);
  const clearFeedback = useReaderStore((s) => s.clearFeedback);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(clearFeedback, 2500);
    return () => clearTimeout(t);
  }, [feedback, clearFeedback]);

  if (!feedback) return null;
  return (
    <div
      key={feedback.id}
      className={`pop-in fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-2xl px-6 py-3 text-2xl font-extrabold text-white shadow-lg ${KIND_STYLES[feedback.kind]}`}
    >
      {feedback.text}
    </div>
  );
}
