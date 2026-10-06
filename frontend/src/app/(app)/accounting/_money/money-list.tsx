"use client";

import { DocList } from "@/components/documents/doc-list";
import { Badge } from "@/components/ui/badge";
import { MODES, MONEY, type MoneyKind } from "@/lib/accounting";
import { formatDate, formatMoney, type DocumentStatus } from "@/lib/documents";

interface Row {
  id: string;
  number: string | null;
  status: DocumentStatus;
  docDate: string;
  party: string | null;
  account: string;
  mode: string;
  instrumentNo: string | null;
  chequeStatus: string | null;
  amount: string;
  onAccount: string;
  reference: string | null;
}

const DESC: Record<MoneyKind, string> = {
  receipt: "Money received from customers (bill-wise or on account), and other income into bank or cash.",
  payment: "Money paid to vendors (bill-wise or advances), and expenses paid from bank or cash.",
  contra: "Transfers between your own bank and cash accounts.",
};

export function MoneyList({ kind }: { kind: MoneyKind }) {
  const m = MONEY[kind];
  return (
    <DocList<Row>
      title={m.title}
      description={DESC[kind]}
      apiPath={m.api}
      route={m.route}
      queryKey={m.api}
      newHref={`${m.route}/new`}
      newLabel={kind === "receipt" ? "Record receipt" : kind === "payment" ? "Record payment" : "New contra"}
      newPermission="accounting.money.manage"
      searchPlaceholder="Number, party, cheque or UTR"
      empty={{ title: `No ${m.title.toLowerCase()}`, description: "Nothing recorded yet." }}
      columns={[
        { label: "Date", render: (r) => <span className="text-muted">{formatDate(r.docDate)}</span> },
        ...(kind === "contra" ? [] : [{ label: kind === "receipt" ? "From" : "To", render: (r: Row) => r.party ?? <span className="text-muted">—</span> }]),
        { label: kind === "receipt" ? "Into" : "From", render: (r) => r.account },
        {
          label: "Mode",
          render: (r) => (
            <>
              {MODES[r.mode] ?? r.mode}
              {r.instrumentNo && <span className="ml-1 font-mono text-xs text-muted">{r.instrumentNo}</span>}
              {r.chequeStatus && r.chequeStatus !== "cleared" && <Badge tone={r.chequeStatus === "bounced" ? "danger" : "warning"} className="ml-1">{r.chequeStatus}</Badge>}
            </>
          ),
        },
        { label: "Amount", align: "right", render: (r) => formatMoney(r.amount) },
        ...(kind === "contra" ? [] : [{ label: "On account", align: "right" as const, render: (r: Row) => (Number(r.onAccount) ? formatMoney(r.onAccount) : "—") }]),
      ]}
    />
  );
}
