// Shape-validate ENS names before passing to resolver. Cuts wasted RPC
// calls and caps attacker-controlled input length.

const ENS_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i;
export const MAX_ENS_LEN = 253;

export function isValidEns(name: string | null | undefined): name is string {
  if (!name) return false;
  if (name.length > MAX_ENS_LEN) return false;
  return ENS_RE.test(name);
}

export function clampNum(
  v: number | null | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

// Comma-separated ENS list, capped at maxLen entries, each shape-validated.
export function parseSeed(raw: string | null, maxLen = 50): string[] | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > maxLen) return null;
  if (!parts.every(isValidEns)) return null;
  return parts;
}
