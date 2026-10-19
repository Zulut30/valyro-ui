/** File helpers for FileUploader: accept matching, size formatting and accept descriptions. */

/** Same semantics as `<input accept>`: extensions (`.pdf`), wildcards (`image/*`) and exact MIME types. */
export function matchesAccept(file: { name: string; type: string }, accept?: string): boolean {
  const tokens = acceptTokens(accept);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    const t = token.toLowerCase();
    if (t.startsWith('.')) return name.endsWith(t);
    if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1));
    return type === t;
  });
}

/** `"image/*, .pdf"` → `["image/*", ".pdf"]`. */
export function acceptTokens(accept?: string): string[] {
  return (accept ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

const WILDCARD_NAMES: Record<string, string> = { image: 'Images', video: 'Videos', audio: 'Audio', text: 'Text' };

/** Short English name of an accept token for hints: `.pdf` → PDF, `image/svg+xml` → SVG, `image/*` → Images. */
export function describeAcceptToken(token: string): string {
  if (token.startsWith('.')) return token.slice(1).toUpperCase();
  const [type, subtype = ''] = token.split('/');
  if (subtype === '*') return WILDCARD_NAMES[type] ?? `${type} files`;
  return subtype.replace(/^x-/, '').split(/[+.;]/)[0].toUpperCase();
}

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** 1536 → "1.5 kB" (en) / "1,5 кБ" (ru), 4 → "4 bytes". Uses 1024-based steps and at most one decimal. */
export function formatBytes(bytes: number, locale?: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    // Short "byte" reads oddly ("4 byte"); spelled out it is "4 bytes" / "4 байта".
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: digits,
  })
    .format(value)
    // Number and unit stay on one line ("5 МБ" never wraps as "5 / МБ").
    .replace(/ /g, '\u00a0');
}
