"use client";

import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Toolbar + paper area for pages printed straight from the app (count sheets, labels).
 * The toolbar and grey background disappear when printing.
 */
export function PrintShell({
  title,
  toolbar,
  children,
  ready = true,
}: {
  title: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  ready?: boolean;
}) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <div className="min-h-screen bg-surface-muted print:bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 print:hidden">
        <p className="font-medium">{title}</p>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <button
            disabled={!ready}
            onClick={() => window.print()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Printer className="size-4" aria-hidden /> Print
          </button>
        </div>
      </div>
      <div className="p-4 print:p-0">{children}</div>
    </div>
  );
}
