import { describe, expect, it } from 'vitest';
import { buildClaudeArgv, sanitiseName } from './argv-builder.js';
import type { ClaudeLaunchSpec, CliCapabilities, SessionId } from '@cs/shared';

const CAPS: CliCapabilities = {
  supportsSessionId: true,
  supportsBackground: true,
  supportsEffort: true,
  supportsForkSession: true,
  supportsAgentsJson: true,
};

const FIXED_ID = '11111111-2222-4333-8444-555555555555';
const newId = (): string => FIXED_ID;
const build = (spec: ClaudeLaunchSpec, caps: CliCapabilities = CAPS) => buildClaudeArgv(spec, caps, newId);

describe('buildClaudeArgv', () => {
  it('pins the session id for a new session', () => {
    // Knowing the id before the process writes it is what makes "resume this
    // pane" work after an app restart.
    const result = build({ mode: { type: 'new' } });
    expect(result.argv).toEqual(['--session-id', FIXED_ID]);
    expect(result.sessionId).toBe(FIXED_ID);
  });

  it('resumes by id', () => {
    const result = build({ mode: { type: 'resume', sessionId: 'abc' as SessionId } });
    expect(result.argv).toEqual(['--resume', 'abc']);
    expect(result.sessionId).toBe('abc');
  });

  it('reports an unknown id for a fork', () => {
    const result = build({ mode: { type: 'fork', sessionId: 'abc' as SessionId } });
    expect(result.argv).toEqual(['--resume', 'abc', '--fork-session']);
    expect(result.sessionId).toBeNull();
  });

  it('builds an attach command for a background agent', () => {
    const result = build({ mode: { type: 'attach', backgroundId: 'eb903e4b' } });
    expect(result.argv).toEqual(['attach', 'eb903e4b']);
  });

  it('passes model, effort and permission mode through', () => {
    const result = build({
      mode: { type: 'new' },
      model: 'claude-opus-5',
      effort: 'high',
      permissionMode: 'acceptEdits',
    });
    expect(result.argv).toEqual([
      '--session-id', FIXED_ID,
      '--model', 'claude-opus-5',
      '--effort', 'high',
      '--permission-mode', 'acceptEdits',
    ]);
  });

  it('omits flags the installed CLI does not support', () => {
    const limited: CliCapabilities = {
      ...CAPS,
      supportsSessionId: false,
      supportsEffort: false,
      supportsBackground: false,
      supportsForkSession: false,
    };
    const result = build({ mode: { type: 'new' }, effort: 'max', background: true }, limited);
    expect(result.argv).toEqual([]);
    expect(result.background).toBe(false);
  });

  it('keeps the name as a single argv element', () => {
    const result = build({ mode: { type: 'new' }, name: 'Mein Projekt' });
    expect(result.argv).toContain('-n');
    expect(result.argv[result.argv.indexOf('-n') + 1]).toBe('Mein Projekt');
  });

  it('strips control characters from the one free-form value', () => {
    // The display name is the only thing in argv that comes from the user. It is
    // never passed through a shell, but it should not be able to corrupt the
    // terminal title either.
    expect(sanitiseName('a\u0000b\nc\u001b[31m')).toBe('a b c [31m');
    expect(sanitiseName('   ')).toBe('');
    expect(sanitiseName('x'.repeat(200))).toHaveLength(80);
  });

  it('drops an empty name rather than passing an empty argument', () => {
    const result = build({ mode: { type: 'new' }, name: '   ' });
    expect(result.argv).not.toContain('-n');
  });

  it('adds extra directories', () => {
    const result = build({ mode: { type: 'new' }, addDirs: ['/a', '/b'] });
    expect(result.argv).toEqual(['--session-id', FIXED_ID, '--add-dir', '/a', '--add-dir', '/b']);
  });

  it('never emits a shell metacharacter as part of a single token', () => {
    const result = build({ mode: { type: 'new' }, name: 'x; rm -rf /' });
    // The value stays one argv element; with no shell involved it is just text.
    expect(result.argv).toContain('x; rm -rf /');
  });
});
