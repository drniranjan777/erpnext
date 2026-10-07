"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/documents";
import { usePortalMe } from "@/lib/portal";

export default function PortalHome() {
  const me = usePortalMe().data;
  if (!me) return null;
  const tiles = [
    { label: "Outstanding", value: formatMoney(me.outstanding), sub: Number(me.overdue) > 0 ? `${formatMoney(me.overdue)} overdue` : "Nothing overdue", href: "/portal/invoices", danger: Number(me.overdue) > 0 },
    { label: "Open orders", value: String(me.openOrders), sub: me.requests ? `${me.requests} new order(s) awaiting confirmation` : "Place a new order", href: "/portal/orders" },
    { label: "Service requests", value: String(me.openTickets), sub: "open", href: "/portal/tickets" },
    ...(me.dealer ? [{ label: "Schemes running", value: String(me.dealer.activeSchemes), sub: me.dealer.pendingClaims ? `${me.dealer.pendingClaims} claim(s) being reviewed` : "No claims pending", href: "/portal/dealer" }] : []),
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hello, {me.name}</h1>
        <p className="text-sm text-muted">{me.party.name}{me.party.gstin && ` · GSTIN ${me.party.gstin}`}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="h-full px-5 py-4 hover:border-primary">
              <p className="text-xs uppercase text-muted">{t.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</p>
              <p className={`text-xs ${"danger" in t && t.danger ? "text-danger" : "text-muted"}`}>{t.sub}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
