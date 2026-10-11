const STOP_WORDS = new Set(
  'a an and are as at be been by can could do does for from has have if in into is it its may must of on or shall should that the their then there this to was when where which will with without user users system'.split(
    ' ',
  ),
);

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Light stemming so "locks"/"locked"/"locking" align. */
function stem(token: string): string {
  return token.replace(/(ing|ed|es|s)$/u, (m, _g, offset: number) => (offset >= 4 ? '' : m));
}

export function tokens(text: string, { dropStopWords = true } = {}): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((t) => t.length > 1 && (!dropStopWords || !STOP_WORDS.has(t)))
    .map(stem);
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

export function shingles(tokenList: string[], n = 2): string[] {
  if (tokenList.length < n) return tokenList.slice();
  const out: string[] = [];
  for (let i = 0; i <= tokenList.length - n; i += 1) out.push(tokenList.slice(i, i + n).join(' '));
  return out;
}

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
