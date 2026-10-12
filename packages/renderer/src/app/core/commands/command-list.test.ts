import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { CommandList } from './command-list';
import type { Command } from './command';

const make = (id: string, title: string, over: Partial<Command> = {}): Command => ({
  id,
  title,
  group: 'project',
  run: () => undefined,
  ...over,
});

describe('CommandList', () => {
  it('finds commands by title and by keyword', () => {
    const registry = new CommandList();
    registry.register(make('p.open', 'Projekt öffnen: DashSphere', { keywords: ['/Users/dev/DashSphere'] }));

    expect(registry.search('dashsphere')).toHaveLength(1);
    // The path is what someone actually types when projects share a name.
    expect(registry.search('/users/dev')).toHaveLength(1);
    expect(registry.search('nichts')).toHaveLength(0);
  });

  it('includes commands derived from data', () => {
    const registry = new CommandList();
    const projects = signal(['a', 'b']);
    registry.registerSource({
      commands: () => projects().map((name) => make(`open:${name}`, `Öffnen ${name}`)),
    });
    expect(registry.all()).toHaveLength(2);

    projects.set(['a', 'b', 'c']);
    // Derived commands must follow the data, not a snapshot of it.
    expect(registry.all()).toHaveLength(3);
  });

  it('does not run a disabled command', async () => {
    const registry = new CommandList();
    const run = vi.fn();
    registry.register(make('x', 'X', { run, disabled: signal(true) }));
    await registry.run('x');
    expect(run).not.toHaveBeenCalled();
  });

  it('ignores an unknown id instead of throwing', async () => {
    const registry = new CommandList();
    await expect(registry.run('does.not.exist')).resolves.toBeUndefined();
  });

  it('unregisters cleanly', () => {
    const registry = new CommandList();
    const remove = registry.register(make('a', 'A'), make('b', 'B'));
    expect(registry.all()).toHaveLength(2);
    remove();
    expect(registry.all()).toHaveLength(0);
  });
});
