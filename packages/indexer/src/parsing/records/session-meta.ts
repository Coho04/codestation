import { asObject, int, num, str, timestamp, type Json } from './field-readers.js';
import type { SessionMetaRecord } from './types.js';

const sessionOf = (line: Json): string | null => str(line['sessionId']) ?? str(line['session_id']);

/**
 * `ai-title` is rewritten on every turn, so the *last* occurrence in a file
 * wins. `custom-title` outranks it — the user named the session deliberately.
 */
export function decodeAiTitle(line: Json): SessionMetaRecord {
  return {
    kind: 'session-meta',
    recordType: 'ai-title',
    sessionId: sessionOf(line),
    ...(str(line['aiTitle']) !== null ? { title: str(line['aiTitle'])!, titleSource: 'ai-title' as const } : {}),
  };
}

export function decodeCustomTitle(line: Json): SessionMetaRecord {
  const title = str(line['customTitle']) ?? str(line['title']);
  return {
    kind: 'session-meta',
    recordType: 'custom-title',
    sessionId: sessionOf(line),
    ...(title !== null ? { title, titleSource: 'custom-title' as const } : {}),
  };
}

export function decodeAgentName(line: Json): SessionMetaRecord {
  const name = str(line['agentName']) ?? str(line['name']);
  return {
    kind: 'session-meta',
    recordType: 'agent-name',
    sessionId: sessionOf(line),
    ...(name !== null ? { title: name, titleSource: 'agent-name' as const } : {}),
  };
}

/** The resume pointer: the tip of the conversation as it currently stands. */
export function decodeLastPrompt(line: Json): SessionMetaRecord {
  return {
    kind: 'session-meta',
    recordType: 'last-prompt',
    sessionId: sessionOf(line),
    ...(str(line['leafUuid']) !== null ? { leafUuid: str(line['leafUuid'])! } : {}),
  };
}

export function decodeRelocated(line: Json): SessionMetaRecord {
  return {
    kind: 'session-meta',
    recordType: 'relocated',
    sessionId: sessionOf(line),
    ...(str(line['relocatedCwd']) !== null ? { relocatedCwd: str(line['relocatedCwd'])! } : {}),
  };
}

export function decodeWorktreeState(line: Json): SessionMetaRecord {
  const worktree = asObject(line['worktreeSession']);
  return {
    kind: 'session-meta',
    recordType: 'worktree-state',
    sessionId: sessionOf(line),
    ...(str(worktree['worktreePath']) !== null ? { worktreePath: str(worktree['worktreePath'])! } : {}),
    ...(str(worktree['worktreeBranch']) !== null
      ? { worktreeBranch: str(worktree['worktreeBranch'])! }
      : {}),
  };
}

export function decodeBridgeSession(line: Json): SessionMetaRecord {
  return {
    kind: 'session-meta',
    recordType: 'bridge-session',
    sessionId: sessionOf(line),
    ...(str(line['bridgeSessionId']) !== null
      ? { bridgeSessionId: str(line['bridgeSessionId'])! }
      : {}),
  };
}

export function decodePrLink(line: Json): SessionMetaRecord {
  const ts = timestamp(line['timestamp']);
  return {
    kind: 'session-meta',
    recordType: 'pr-link',
    sessionId: sessionOf(line),
    ...(str(line['prUrl']) !== null ? { prUrl: str(line['prUrl'])! } : {}),
    ...(num(line['prNumber']) !== null ? { prNumber: int(line['prNumber']) } : {}),
    ...(ts !== null ? { ts } : {}),
  };
}
