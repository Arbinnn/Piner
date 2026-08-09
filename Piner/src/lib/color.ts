/** Color conversion between piner's `#RRGGBBAA` and the CSS/HTML color world. */

const HEX8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

/** piner `#RRGGBB[AA]` -> CSS `rgba(r, g, b, a)`. Falls back to a visible default on garbage input. */
export function pineColorToRgba(hex: string | null | undefined, fallback = '#787b8688'): string {
  const match = HEX8.exec(hex ?? '');
  const source = match ? hex! : fallback;
  const m = HEX8.exec(source)!;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/** piner `#RRGGBB[AA]` -> HTML `<input type="color">` value `#RRGGBB` (alpha dropped, browser can't show it). */
export function pineColorToHtml(hex: string | null | undefined, fallback = '#787b86'): string {
  const match = HEX8.exec(hex ?? '');
  return match ? `#${match[1]}` : fallback;
}

/** HTML `#RRGGBB` -> piner `#RRGGBBAA`, preserving a previously-known alpha byte. */
export function htmlColorToPine(html: string, previousAlphaHex = 'FF'): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(html);
  if (!m) return `${html}${previousAlphaHex}`;
  return `#${m[1]}${previousAlphaHex}`;
}

/** Extracts the `AA` alpha byte (e.g. "FF") from a piner `#RRGGBBAA` color, if present. */
export function pineColorAlphaHex(hex: string | null | undefined): string {
  const match = HEX8.exec(hex ?? '');
  return match?.[2] ?? 'FF';
}
