import type { ClaudeLaunchSpec, CliCapabilities } from '@cs/shared';

export interface BuiltArgv {
  readonly argv: readonly string[];
  /** Known up front for 'new', unknown for 'fork' until the CLI writes it. */
  readonly sessionId: string | null;
  readonly background: boolean;
}

/** Control characters and length limits for the one free-form value in argv. */
export function sanitiseName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Builds the command line for a Claude pane.
 *
 * A pure function, and the security boundary: nothing from the renderer reaches
 * a shell. The process is spawned with an argv array and never with
 * `shell: true`, so the only free-form value — the display name — cannot do
 * anything but be a name.
 *
 * `--session-id` is passed for new sessions so the id is known before the
 * process writes it. That is what later makes "resume this pane" possible after
 * the app has been restarted and the PTY is gone.
 */
export function buildClaudeArgv(
  spec: ClaudeLaunchSpec,
  capabilities: CliCapabilities,
  newSessionId: () => string,
): BuiltArgv {
  const argv: string[] = [];
  let sessionId: string | null = null;

  switch (spec.mode.type) {
    case 'new':
      sessionId = newSessionId();
      if (capabilities.supportsSessionId) argv.push('--session-id', sessionId);
      break;
    case 'resume':
      sessionId = spec.mode.sessionId;
      argv.push('--resume', spec.mode.sessionId);
      break;
    case 'fork':
      argv.push('--resume', spec.mode.sessionId);
      if (capabilities.supportsForkSession) argv.push('--fork-session');
      // The forked session gets a fresh id that only the CLI knows.
      sessionId = null;
      break;
    case 'attach':
      return { argv: ['attach', spec.mode.backgroundId], sessionId: null, background: false };
  }

  if (spec.name !== undefined) {
    const name = sanitiseName(spec.name);
    if (name.length > 0) argv.push('-n', name);
  }
  if (spec.model !== undefined) argv.push('--model', spec.model);
  if (spec.effort !== undefined && capabilities.supportsEffort) argv.push('--effort', spec.effort);
  if (spec.permissionMode !== undefined) argv.push('--permission-mode', spec.permissionMode);
  for (const dir of spec.addDirs ?? []) argv.push('--add-dir', dir);

  const background = spec.background === true && capabilities.supportsBackground;
  if (background) argv.push('--bg');

  return { argv, sessionId, background };
}
