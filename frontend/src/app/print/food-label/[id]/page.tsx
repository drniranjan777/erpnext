"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Label { item: { code: string; name: string }; vegMark: string; ingredients: string; netQuantity: string | null; storage: string | null; fssaiLicenceNo: string | null; servingSizeG: number | null; allergenStatement: string; panel: { nutrient: string; per100: number; perServe: number | null; rdaPct: number | null }[] }

const NAMES: Record<string, string> = { energyKcal: "Energy (kcal)", protein: "Protein (g)", carbohydrate: "Carbohydrate (g)", totalSugars: "Total sugars (g)", addedSugars: "Added sugars (g)", totalFat: "Total fat (g)", saturatedFat: "Saturated fat (g)", transFat: "Trans fat (g)", cholesterolMg: "Cholesterol (mg)", sodiumMg: "Sodium (mg)" };

/** Back-of-pack label (FSS Labelling and Display Regulations, 2020). */
export default function FoodLabelPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["/food/labels", id], queryFn: () => api<Label>(`/food/labels/${id}`), enabled: status === "authenticated" });
  const l = q.data;
  return (
    <PrintShell title={l ? `Label — ${l.item.name}` : "Label"} ready={!!l}>
      {l && (
        <div className="mx-auto w-[100mm] space-y-2 border border-black bg-white p-3 text-[9px] leading-snug text-black">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-bold">{l.item.name}</p>
            <span className={`flex size-5 items-center justify-center border-2 ${l.vegMark === "veg" ? "border-green-700" : "border-amber-800"}`} aria-label={l.vegMark === "veg" ? "Vegetarian" : "Non-vegetarian"}>
              {l.vegMark === "veg" ? <span className="size-2.5 rounded-full bg-green-700" /> : <span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-amber-800" />}
            </span>
          </div>
          <p><strong>Ingredients:</strong> {l.ingredients}</p>
          {l.allergenStatement && <p className="font-bold">{l.allergenStatement}</p>}
          <table className="w-full border border-black">
            <thead><tr className="border-b border-black text-left"><th className="px-1">Nutrition</th><th className="px-1 text-right">per 100 g</th>{l.servingSizeG && <th className="px-1 text-right">per serve ({l.servingSizeG} g)</th>}{l.servingSizeG && <th className="px-1 text-right">% RDA*</th>}</tr></thead>
            <tbody>{l.panel.map((r) => <tr key={r.nutrient} className="border-b border-black/30"><td className="px-1">{NAMES[r.nutrient] ?? r.nutrient}</td><td className="px-1 text-right">{r.per100}</td>{l.servingSizeG && <td className="px-1 text-right">{r.perServe}</td>}{l.servingSizeG && <td className="px-1 text-right">{r.rdaPct ?? ""}</td>}</tr>)}</tbody>
          </table>
          {l.servingSizeG && <p>* % of Recommended Dietary Allowance per serve, based on 2000 kcal energy for an average adult.</p>}
          {l.netQuantity && <p><strong>Net quantity:</strong> {l.netQuantity}</p>}
          {l.storage && <p>{l.storage}</p>}
          {l.fssaiLicenceNo && <p className="font-semibold">fssai Lic. No. {l.fssaiLicenceNo}</p>}
        </div>
      )}
    </PrintShell>
  );
}
