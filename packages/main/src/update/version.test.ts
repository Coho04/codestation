import { describe, expect, it } from 'vitest';
import { compareVersions, isNewer, parseVersion } from './version.js';

const cmp = (a: string, b: string): number =>
  compareVersions(parseVersion(a)!, parseVersion(b)!);

describe('parseVersion', () => {
  it('accepts a tag with and without the v prefix', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('splits the prerelease into identifiers and drops build metadata', () => {
    expect(parseVersion('1.0.0-beta.2+build.7')?.prerelease).toEqual(['beta', '2']);
  });

  it('rejects anything that is not a release version', () => {
    for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'v1.2.x', 'nightly-2026-10-12']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(cmp('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(cmp('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(cmp('1.1.2', '1.1.3')).toBeLessThan(0);
    expect(cmp('1.1.1', '1.1.1')).toBe(0);
  });

  it('compares numerically, not as text', () => {
    // The bug this guards: '10' < '9' as strings, so 0.10.0 would look older.
    expect(cmp('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(cmp('1.0.0', '0.100.0')).toBeGreaterThan(0);
  });

  it('ranks a prerelease below the matching release', () => {
    expect(cmp('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(cmp('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });

  it('follows semver precedence inside the prerelease', () => {
    expect(cmp('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(cmp('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0);
    // Numeric identifiers rank below alphanumeric ones.
    expect(cmp('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0);
    // A shorter identifier set precedes a longer one with the same prefix.
    expect(cmp('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
  });
});

describe('isNewer', () => {
  it('is strict: the same version is not an update', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('v1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('1.0.0', '1.0.1')).toBe(false);
  });

  it('never offers an update it cannot understand', () => {
    expect(isNewer('nightly', '1.0.0')).toBe(false);
    expect(isNewer('2.0.0', 'unknown')).toBe(false);
  });
});
