import { afterEach, describe, expect, it } from 'vitest';
import { resolveRuntimeEnv } from './env.js';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('resolveRuntimeEnv', () => {
  it('serves the built bundle when CS_DEV is unset', () => {
    delete process.env['CS_DEV'];
    const env = resolveRuntimeEnv();
    expect(env.useDevServer).toBe(false);
    expect(env.devServerOrigin).toBeNull();
  });

  it('does not treat an unpackaged build as a dev build', () => {
    // Regression guard: `app.isPackaged` is false for `electron .` against a
    // built renderer, which previously made the app wait for a dev server that
    // was never started.
    process.env['CS_DEV'] = '0';
    expect(resolveRuntimeEnv().useDevServer).toBe(false);
  });

  it('points at the dev server only when the dev script asked for it', () => {
    process.env['CS_DEV'] = '1';
    expect(resolveRuntimeEnv().devServerOrigin).toBe('http://localhost:4200');
  });

  it('honours a custom dev port', () => {
    process.env['CS_DEV'] = '1';
    process.env['CS_DEV_PORT'] = '4300';
    expect(resolveRuntimeEnv().devServerOrigin).toBe('http://localhost:4300');
  });
});
