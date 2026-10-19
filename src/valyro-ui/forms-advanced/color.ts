/** Colour conversions for ColorPicker. Channels: r/g/b 0–255, h 0–360, s/v/a 0–1. */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSVA {
  h: number;
  s: number;
  v: number;
  a: number;
}

const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parses #rgb, #rgba, #rrggbb and #rrggbbaa (the leading # is optional). */
export function parseHex(input: string): RGBA | null {
  const match = HEX_RE.exec(input.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: hex.length === 8 ? Math.round((channel(6) / 255) * 1000) / 1000 : 1,
  };
}

const toHexByte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when the colour is not fully opaque. */
export function rgbToHex({ r, g, b, a }: RGBA): string {
  const hex = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  return a < 1 ? hex + toHexByte(a * 255) : hex;
}

export function rgbToHsv({ r, g, b, a }: RGBA): HSVA {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const delta = max - Math.min(rn, gn, bn);
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max, a };
}

export function hsvToRgb({ h, s, v, a }: HSVA): RGBA {
  const hue = (((h % 360) + 360) % 360) / 60;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = v - chroma;
  const [r, g, b] =
    hue < 1 ? [chroma, x, 0]
    : hue < 2 ? [x, chroma, 0]
    : hue < 3 ? [0, chroma, x]
    : hue < 4 ? [0, x, chroma]
    : hue < 5 ? [x, 0, chroma]
    : [chroma, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a,
  };
}

export function hexToHsv(hex: string): HSVA | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv: HSVA): string {
  return rgbToHex(hsvToRgb(hsv));
}

/** Canonical lowercase form used to compare colours written differently (#FFF vs #ffffff). */
export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToHex(rgb) : null;
}
