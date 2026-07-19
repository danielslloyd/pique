"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

interface ToastItem {
  id: number;
  text: string;
  kind: "success" | "error" | "info";
}

const ToastContext = createContext<(text: string, kind?: ToastItem["kind"]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((text: string, kind: ToastItem["kind"] = "info") => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pop-in rounded-2xl px-5 py-3 text-lg font-bold text-white shadow-lg ${
              t.kind === "success" ? "bg-green-500" : t.kind === "error" ? "bg-red-400" : "bg-sky-500"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
