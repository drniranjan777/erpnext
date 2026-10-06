/** Target industries (docs/PHASE_PLAN.md §2). Values are stored on the tenant. */
export const INDUSTRIES = [
  {
    group: "Discrete manufacturing",
    items: [
      { value: "auto-components", label: "Automobile / Auto components" },
      { value: "electronics", label: "Electronics" },
      { value: "engineering", label: "Engineering / Fabrication" },
      { value: "plastic", label: "Plastic" },
      { value: "textile", label: "Textile & Apparel" },
      { value: "furniture", label: "Furniture" },
      { value: "packaging", label: "Packaging" },
      { value: "machinery", label: "Machinery" },
    ],
  },
  {
    group: "Process manufacturing",
    items: [
      { value: "pharma", label: "Pharma" },
      { value: "chemical", label: "Chemical" },
      { value: "paint", label: "Paint & Coatings" },
      { value: "lubricants", label: "Lubricants" },
      { value: "cosmetics", label: "Cosmetics" },
      { value: "fmcg", label: "FMCG" },
      { value: "food", label: "Food processing" },
    ],
  },
  { group: "Other", items: [{ value: "other", label: "Other" }] },
] as const;

export function industryLabel(value: string | null | undefined): string | null {
  for (const g of INDUSTRIES) for (const i of g.items) if (i.value === value) return i.label;
  return value ?? null;
}
