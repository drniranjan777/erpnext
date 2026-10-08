/**
 * White-label rules: colours with enough contrast for white text, safe logos, domain and sender-ID
 * formats, and the DNS TXT proof of control.
 */

const HEX = /^#[0-9a-f]{6}$/i;

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** Buttons put white text on the primary colour: it needs a 4.5:1 contrast (WCAG AA). */
export function colourProblem(hex: string | null | undefined) {
  if (!hex) return null;
  if (!HEX.test(hex)) return 'Colours are written as #rrggbb';
  const c = contrast(hex, '#ffffff');
  return c < 4.5 ? `White text on ${hex} has a contrast of ${c}:1; choose a darker colour (at least 4.5:1)` : null;
}

const LOGO = /^data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/=]+)$/;

/** A logo is a PNG, JPEG or SVG data URL up to 200 KB; SVGs may not carry scripts or external references. */
export function logoProblem(dataUrl: string | null | undefined) {
  if (!dataUrl) return null;
  const m = LOGO.exec(dataUrl);
  if (!m) return 'The logo must be a PNG, JPEG or SVG image';
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 200 * 1024) return 'The logo must be at most 200 KB';
  if (m[1] === 'svg+xml') {
    const svg = bytes.toString('utf8').toLowerCase();
    if (/<script|on[a-z]+\s*=|javascript:|<foreignobject|xlink:href\s*=\s*["']https?:|href\s*=\s*["']https?:/.test(svg)) return 'SVG logos may not contain scripts, event handlers or external links';
  }
  return null;
}

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A custom domain is a host name the customer controls, not one of ours. */
export function domainProblem(host: string | null | undefined, ownDomains: string[]) {
  if (!host) return null;
  const h = host.toLowerCase();
  if (!HOST.test(h)) return 'Enter a host name like erp.example.com';
  if (ownDomains.some((d) => h === d || h.endsWith(`.${d}`))) return 'Use your own domain, not ours';
  return null;
}

/** TRAI DLT header: 6 letters. */
export const senderIdProblem = (id: string | null | undefined) => (!id ? null : /^[A-Z]{6}$/.test(id) ? null : 'The SMS sender ID (DLT header) is 6 capital letters');

export const emailDomain = (address: string) => address.split('@')[1]?.toLowerCase() ?? '';

/** The TXT record that proves control of a domain. */
export const txtRecord = (token: string) => `nextgen-verify=${token}`;

/** True when one of the domain's TXT records carries the token (records may be split in chunks). */
export function txtMatches(records: string[][], token: string) {
  return records.some((chunks) => chunks.join('').trim() === txtRecord(token));
}
