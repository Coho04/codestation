import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TranscriptFactory } from '../support/transcript-factory';

export interface FixtureHome {
  readonly home: string;
  readonly projectPath: string;
  readonly sessionId: string;
}

/**
 * Builds a throwaway ~/.claude so the end-to-end run is deterministic and never
 * reads — or writes near — the user's real data.
 */
export function createFixtureHome(): FixtureHome {
  const home = mkdtempSync(join(tmpdir(), 'codestation-e2e-'));
  const projectPath = join(home, 'projekt');
  const encoded = projectPath.replace(/[/_. ]/g, '-');
  const claude = join(home, '.claude');
  const projectsDir = join(claude, 'projects', encoded);

  mkdirSync(projectPath, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(join(claude, 'sessions'), { recursive: true });
  mkdirSync(join(claude, 'plans'), { recursive: true });

  const sessionId = '11111111-2222-4333-8444-555555555501';
  const factory = new TranscriptFactory(sessionId, projectPath);
  factory
    .prompt('Wie läuft die Prüfung der Pipeline?')
    .assistant('Schau in src/app/pipeline.ts und führe die Tests aus.')
    .toolUse('Bash', { command: 'npm test' }, 'alles grün')
    .title('Pipeline prüfen')
    .lastPrompt();

  writeFileSync(join(projectsDir, `${sessionId}.jsonl`), factory.build());

  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      projects: { [projectPath]: { lastSessionId: sessionId, hasTrustDialogAccepted: true } },
      userID: 'should-never-be-read',
    }),
  );

  writeFileSync(
    join(claude, 'history.jsonl'),
    `${JSON.stringify({
      display: 'Wie prüfe ich die Pipeline?',
      pastedContents: {},
      timestamp: Date.now(),
      project: projectPath,
      sessionId,
    })}\n`,
  );

  writeFileSync(join(claude, 'plans', 'pipeline-reparieren-lucky-pike.md'), '# Pipeline reparieren\n\nSchritt eins.\n');

  return { home, projectPath, sessionId };
}
