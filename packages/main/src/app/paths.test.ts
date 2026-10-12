import { describe, expect, it } from 'vitest';
import { resolveUnpacked } from './paths.js';

describe('resolveUnpacked', () => {
  it('returns the plain path for an unpackaged build', () => {
    expect(resolveUnpacked('/repo', 'packages/indexer/dist/indexer.cjs')).toBe(
      '/repo/packages/indexer/dist/indexer.cjs',
    );
  });

  it('falls back to the packed path when no unpacked copy exists', () => {
    // Nothing is on disk under this fake asar path, so it must not invent one.
    expect(resolveUnpacked('/App.app/Contents/Resources/app.asar', 'a/b.cjs')).toBe(
      '/App.app/Contents/Resources/app.asar/a/b.cjs',
    );
  });
});
