/**
 * Just enough semver to answer "is that release newer than what is running".
 *
 * Hand-written rather than pulled in as a dependency: the comparison is thirty
 * lines, it is the one piece of update logic that must never be wrong, and a
 * local implementation can be tested exhaustively against the precedence rules
 * instead of trusted.
 */

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated identifiers after `-`; empty means a final release. */
  readonly prerelease: readonly string[];
}

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(raw: string): ParsedVersion | null {
  const match = PATTERN.exec(raw.trim());
  if (match === null) return null;
  const [, major, minor, patch, pre] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: pre === undefined || pre === '' ? [] : pre.split('.'),
  };
}

/** Negative if `a` precedes `b`, positive if it follows, 0 if equal. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  // 1.0.0-beta precedes 1.0.0, and "no prerelease" is the higher of the two.
  const aPre = a.prerelease.length > 0;
  const bPre = b.prerelease.length > 0;
  if (aPre !== bPre) return aPre ? -1 : 1;
  if (!aPre) return 0;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    // A shorter set of identifiers precedes a longer one with the same prefix.
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftNum = /^\d+$/.test(left);
    const rightNum = /^\d+$/.test(right);
    // Numeric identifiers always rank below alphanumeric ones.
    if (leftNum !== rightNum) return leftNum ? -1 : 1;
    if (leftNum) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/**
 * True only when `candidate` is strictly newer and both parse. An unparseable
 * version is never an update: offering one would be worse than offering none.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  return compareVersions(a, b) > 0;
}
