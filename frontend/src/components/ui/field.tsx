import { useId } from "react";
import { cn } from "@/lib/cn";

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted " +
  "focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary disabled:opacity-60 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/30";

export const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input className={cn(inputClass, className)} {...props} />
);

export const Select = ({ className, ...props }: React.ComponentProps<"select">) => (
  <select className={cn(inputClass, "pr-8", className)} {...props} />
);

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Receives the generated id + aria props to spread on the control. */
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
