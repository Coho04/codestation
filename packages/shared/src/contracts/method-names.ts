import type { IndexApi } from './index-api.js';
import type { TerminalApi } from './terminal-api.js';

/**
 * Explicit method lists.
 *
 * `contextBridge.exposeInMainWorld` copies own enumerable properties, so the
 * Proxy-based RPC client cannot be handed to the renderer directly — it has no
 * own keys and would arrive empty. The preload builds a concrete object from
 * these lists instead.
 *
 * `AssertExhaustive` below turns a forgotten entry into a compile error, so the
 * lists cannot drift away from the interfaces they mirror.
 */
export const INDEX_API_METHODS = [
  'listProjects',
  'getProject',
  'patchProject',
  'addProject',
  'listSessions',
  'getSession',
  'getSessionCosts',
  'getTranscript',
  'getSessionTree',
  'getRawLine',
  'getToolUses',
  'getToolResult',
  'getFileTouches',
  'search',
  'listPlans',
  'getPlan',
  'getLiveSessions',
  'getProgress',
  'getDailyCosts',
  'setProjectArchived',
  'setSessionArchived',
  'forgetProject',
  'forgetSession',
  'listTombstones',
  'restoreTombstone',
  'resolveProjectPaths',
  'resolveSessionPaths',
  'rebuildIndex',
  'refresh',
] as const;

export const TERMINAL_API_METHODS = [
  'openPane',
  'closePane',
  'resizePane',
  'listPanes',
  'replayBuffer',
  'listProfiles',
  'getClaudeInfo',
  'setClaudeBinaryPath',
  'loadWorkspace',
  'saveWorkspace',
  'pickDirectory',
  'openExternal',
  'revealInFinder',
  'focusSession',
  'setBadgeCount',
  'deleteSessionData',
  'deleteProjectData',
  'getUpdateStatus',
  'checkForUpdates',
  'downloadUpdate',
  'installUpdate',
  'setUpdateChecksEnabled',
] as const;

type AssertExhaustive<Keys extends string, Listed extends string> =
  Exclude<Keys, Listed> extends never
    ? Exclude<Listed, Keys> extends never
      ? true
      : ['extra entries in list:', Exclude<Listed, Keys>]
    : ['missing from list:', Exclude<Keys, Listed>];

type _IndexListComplete = AssertExhaustive<keyof IndexApi, (typeof INDEX_API_METHODS)[number]>;
type _TerminalListComplete = AssertExhaustive<
  keyof TerminalApi,
  (typeof TERMINAL_API_METHODS)[number]
>;

const _indexOk: _IndexListComplete = true;
const _terminalOk: _TerminalListComplete = true;
void _indexOk;
void _terminalOk;
