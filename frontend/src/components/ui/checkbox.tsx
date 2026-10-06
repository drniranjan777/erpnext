"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  indeterminate?: boolean;
}

export function Checkbox({ label, description, indeterminate, className, disabled, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);

  const box = (
    <input
      ref={ref}
      type="checkbox"
      disabled={disabled}
      className="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--primary)] disabled:opacity-50"
      {...props}
    />
  );
  if (!label) return box;
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5", disabled && "cursor-not-allowed opacity-70", className)}>
      {box}
      <span className="text-sm">
        <span className="block">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}
