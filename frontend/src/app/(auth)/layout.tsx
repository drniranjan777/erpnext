import { Factory } from "lucide-react";

const highlights = [
  "GST, e-Invoice & e-Way Bill built in",
  "Purchase, sales, inventory, accounts and production in one place",
  "AI copilot that drafts documents for you to approve",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Factory className="size-6" aria-hidden />
          NextGen ERP
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Run your factory, not your spreadsheets.</h1>
          <ul className="mt-6 space-y-3 text-sm opacity-90">
            {highlights.map((h) => (
              <li key={h} className="flex gap-2">
                <span aria-hidden>✓</span>
                {h}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs opacity-70">Data hosted in India · DPDP-ready</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
