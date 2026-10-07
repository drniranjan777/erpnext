import Link from "next/link";
import { formatQty } from "@/lib/documents";
import { refHref, refLabel, type Peg } from "@/lib/planning";

/** What a planned order covers, linked to the documents behind it. */
export function Pegs({ pegs, limit = 3 }: { pegs: Peg[]; limit?: number }) {
  const shown = pegs.slice(0, limit);
  return (
    <span className="flex flex-wrap gap-x-2">
      {shown.map((g, i) => {
        const href = refHref(g);
        const text = `${refLabel(g)} · ${formatQty(String(g.qty))}`;
        return href ? <Link key={i} href={href} className="underline">{text}</Link> : <span key={i}>{text}</span>;
      })}
      {pegs.length > limit && <span className="text-muted">+{pegs.length - limit} more</span>}
    </span>
  );
}
