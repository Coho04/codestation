import { describe, expect, it } from 'vitest';
import { isInsideClaudeProjects } from './destructive-ops.js';

const ROOT = '/Users/dev/.claude/projects';

describe('isInsideClaudeProjects', () => {
  it('accepts a transcript inside the root', () => {
    expect(isInsideClaudeProjects(ROOT, `${ROOT}/-Users-dev-proj/abc.jsonl`)).toBe(true);
  });

  it('accepts the root itself', () => {
    expect(isInsideClaudeProjects(ROOT, ROOT)).toBe(true);
  });

  it('refuses a sibling directory whose name merely starts the same', () => {
    // The classic prefix bug: '/…/projects-backup' must not count as inside
    // '/…/projects'.
    expect(isInsideClaudeProjects(ROOT, '/Users/dev/.claude/projects-backup/x')).toBe(false);
  });

  it('refuses an escape through ..', () => {
    expect(isInsideClaudeProjects(ROOT, `${ROOT}/../../../etc/passwd`)).toBe(false);
    expect(isInsideClaudeProjects(ROOT, `${ROOT}/x/../../sessions`)).toBe(false);
  });

  it('refuses anything outside the root', () => {
    for (const path of ['/', '/etc', '/Users/dev', '/Users/dev/.claude', '/Users/dev/Documents/code']) {
      expect(isInsideClaudeProjects(ROOT, path)).toBe(false);
    }
  });

  it('normalises redundant separators rather than being fooled by them', () => {
    expect(isInsideClaudeProjects(ROOT, `${ROOT}//sub///file.jsonl`)).toBe(true);
  });
});
