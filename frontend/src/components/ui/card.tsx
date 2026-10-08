import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "warning" | "success"; children: React.ReactNode }) {
  const tones = {
    danger: "bg-danger-soft text-danger",
    warning: "bg-warning-soft text-warning",
    success: "bg-success-soft text-success",
  };
  return (
    <div role="alert" className={cn("rounded-lg px-3 py-2.5 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

/**
 * A titled block of form fields laid out on a responsive grid. Use one per logical group
 * (basics, tax, inventory …) so long forms read as sections rather than one wall of inputs.
 */
export function FormSection({ title, description, action, columns = 2, className, children }: { title: string; description?: string; action?: React.ReactNode; columns?: 1 | 2 | 3 | 4; className?: string; children: React.ReactNode }) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columns];
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <div className={cn("grid gap-4 px-5 py-4", grid)}>{children}</div>
    </Card>
  );
}
