"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// A submit button that says it is working while its form's server action runs. Works without
// JavaScript too: then it is a plain submit button.
export function PendingButton({ children, pendingText, className, name, value, label }: { children: ReactNode; pendingText: string; className: string; name?: string; value?: string; label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} aria-label={label} aria-disabled={pending || undefined} disabled={pending} className={`${className} disabled:cursor-progress disabled:opacity-70`}>
      {pending ? pendingText : children}
    </button>
  );
}
