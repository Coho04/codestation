import { describe, expect, it } from 'vitest';
import { appError, err, ok } from './result.js';

describe('Result', () => {
  it('narrows to the value on ok', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('carries a discriminating code across a process boundary', () => {
    // Electron flattens thrown Errors to their message; the code must survive
    // structured cloning as plain data.
    const original = err(appError('CWD_MISSING', 'Projektordner fehlt', '/tmp/gone'));
    const cloned = structuredClone(original);
    expect(cloned).toEqual(original);
    if (!cloned.ok) expect(cloned.error.code).toBe('CWD_MISSING');
  });

  it('omits detail when none was given', () => {
    expect(appError('INTERNAL', 'boom')).not.toHaveProperty('detail');
  });
});
