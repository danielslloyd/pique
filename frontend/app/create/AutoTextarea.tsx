"use client";

import { useEffect, useRef } from "react";

/** A textarea that grows to fit its content instead of scrolling. */
export default function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
  readOnly,
  minRows = 2,
}: {
  value: string;
  onChange?: (value: string) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(resize, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      rows={minRows}
      className={className}
      style={{ resize: "none", overflow: "hidden" }}
    />
  );
}
