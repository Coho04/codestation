/**
 * Lenient field access.
 *
 * Decoders read only what they need and never validate exhaustively: six record
 * types and three fields turned up on this machine that a careful earlier survey
 * of the same installation had not seen. Strict schemas would turn each of those
 * into a crash instead of a row.
 */
export type Json = Record<string, unknown>;

export const asObject = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};

export const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export const bool = (value: unknown): boolean => value === true;

export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const int = (value: unknown, fallback = 0): number => {
  const n = num(value);
  return n === null ? fallback : Math.trunc(n);
};

/** ISO-8601 UTC in transcripts, epoch ms elsewhere; both appear. */
export function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
