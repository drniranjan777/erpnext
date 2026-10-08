/** The current Indian financial year as "2026-27". */
export function currentFy() {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** This financial year and the two before it. */
export function fyOptions() {
  const y = Number(currentFy().slice(0, 4));
  return [0, 1, 2].map((n) => `${y - n}-${String((y - n + 1) % 100).padStart(2, "0")}`);
}
