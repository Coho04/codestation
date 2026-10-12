import { describe, expect, it } from 'vitest';
import { summariseToolInput } from './tool-input-summary.js';

describe('summariseToolInput', () => {
  it('shows the command for Bash', () => {
    expect(summariseToolInput('Bash', { command: 'git status', description: 'Show status' }).summary)
      .toBe('git status');
  });

  it('shows the path for file tools and exposes it separately', () => {
    const result = summariseToolInput('Edit', { file_path: '/p/src/app.ts', oldString: 'a', newString: 'b' });
    expect(result.summary).toBe('/p/src/app.ts');
    expect(result.targetPath).toBe('/p/src/app.ts');
  });

  it('combines pattern and scope for search tools', () => {
    expect(summariseToolInput('Grep', { pattern: 'TODO', path: 'src' }).summary).toBe('TODO — src');
  });

  it('names the subagent and its brief for Task', () => {
    expect(summariseToolInput('Task', { subagent_type: 'Explore', description: 'Map data layer' }).summary)
      .toBe('Explore — Map data layer');
  });

  it('falls back to a short field for tools it does not know', () => {
    const result = summariseToolInput('mcp__jira__create_issue', { summary_text: 'Bug im Login' });
    expect(result.summary).toContain('Bug im Login');
  });

  it('collapses whitespace and clamps long values', () => {
    const result = summariseToolInput('Bash', { command: `echo\n   ${'x'.repeat(900)}` });
    expect(result.summary.length).toBeLessThanOrEqual(512);
    expect(result.summary).not.toContain('\n');
    expect(result.summary.endsWith('…')).toBe(true);
  });

  it('never throws on a missing or malformed input', () => {
    expect(summariseToolInput('Bash', undefined).summary).toBe('');
    expect(summariseToolInput('Read', 'not an object').summary).toBe('');
    expect(summariseToolInput('Glob', { pattern: null }).summary).toBe('');
  });

  it('reports the in-progress item for a todo update', () => {
    const result = summariseToolInput('TodoWrite', {
      todos: [
        { content: 'erledigt', status: 'completed' },
        { content: 'Index anbinden', status: 'in_progress' },
      ],
    });
    expect(result.summary).toBe('Index anbinden (2 todos)');
  });
});
