/** Indian identity and bank number checks used on the employee master. */

// Verhoeff tables (Aadhaar's check digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(num: string) {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][digits[i]]];
  return c === 0;
}

/** 12 digits, not starting with 0 or 1, with a valid Verhoeff check digit. */
export function aadhaarValid(v: string) {
  return /^[2-9]\d{11}$/.test(v) && verhoeffValid(v);
}

/** ABCDE1234F; the fourth letter is the holder type (P = individual). */
export function panValid(v: string) {
  return /^[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]$/.test(v);
}

export function ifscValid(v: string) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v);
}

export function uanValid(v: string) {
  return /^\d{12}$/.test(v);
}

/** ESIC insurance number: 10 or 17 digits. */
export function esicValid(v: string) {
  return /^(\d{10}|\d{17})$/.test(v);
}

/** AB XXX 1234F: hides the holder's surname letters. */
export const maskPan = (v: string) => `${v.slice(0, 2)}XXX${v.slice(5)}`;
