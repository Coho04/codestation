import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  throwAppError,
  paneId as toPaneId,
  sessionId as toSessionId,
  type AppEvent,
  type PaneHandle,
  type PaneId,
  type PaneSpec,
  type SessionId,
} from '@cs/shared';
import { buildClaudeArgv } from './argv-builder.js';
import { FlowControl } from './flow-control.js';
import { OutputCoalescer } from './output-coalescer.js';
import { PaneRegistry, type PaneRecord } from './pane-registry.js';
import { RingBuffer } from './ring-buffer.js';
import type { PtyPort } from './pty-port.js';
import type { ClaudeBinaryResolver } from '../runtime/claude-binary-resolver.js';
import type { ShellEnvResolver } from '../runtime/shell-env-resolver.js';

const COALESCE_BYTES = 8 * 1024;
const COALESCE_DELAY_MS = 8;
const RING_BUFFER_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 3000;

export interface PtyManagerDeps {
  readonly pty: PtyPort;
  readonly env: ShellEnvResolver;
  readonly claude: ClaudeBinaryResolver;
  readonly claudeBinaryOverride: () => string | null;
  readonly sendData: (paneId: PaneId, chunk: string) => void;
  readonly emit: (event: AppEvent) => void;
}

export class PtyManager {
  readonly registry = new PaneRegistry();

  constructor(private readonly deps: PtyManagerDeps) {}

  async open(spec: PaneSpec): Promise<PaneHandle> {
    // Fail fast on a project that has been moved or deleted: spawning into a
    // missing cwd produces an error that looks like a Claude problem.
    const dir = await stat(spec.projectPath).catch(() => null);
    if (dir === null || !dir.isDirectory()) {
      throwAppError('CWD_MISSING', `Projektordner existiert nicht: ${spec.projectPath}`);
    }

    const { env } = await this.deps.env.resolve();
    const paneIdValue = toPaneId(randomUUID());

    let file: string;
    let args: readonly string[];
    let sessionId: SessionId | null = null;
    let title: string;
    let cliVersion: string | null = null;

    if (spec.kind === 'claude') {
      const info = await this.deps.claude.resolve(this.deps.claudeBinaryOverride());
      if (info.path === null || info.version === null) {
        throwAppError('CLAUDE_NOT_FOUND', info.error ?? 'Claude-CLI nicht gefunden');
      }
      const built = buildClaudeArgv(spec.launch, info.capabilities, () => randomUUID());
      // Spawned directly, not through a shell: pty.pid is then exactly the pid in
      // ~/.claude/sessions/<pid>.json, which makes the correlation exact rather
      // than a guess.
      file = info.path;
      args = built.argv;
      sessionId = built.sessionId === null ? null : toSessionId(built.sessionId);
      cliVersion = info.version;
      title = spec.launch.name ?? basename(spec.projectPath);
    } else {
      const { shell } = await this.deps.env.resolve();
      file = shell;
      args = ['-l', '-i'];
      title = basename(spec.projectPath);
    }

    const flow = new FlowControl(
      () => record.pty?.pause(),
      () => record.pty?.resume(),
    );
    const buffer = new RingBuffer(RING_BUFFER_BYTES);
    const coalescer = new OutputCoalescer({
      maxBytes: COALESCE_BYTES,
      maxDelayMs: COALESCE_DELAY_MS,
      onFlush: (chunk) => {
        buffer.push(chunk);
        flow.sent(chunk.length);
        this.deps.sendData(paneIdValue, chunk);
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });

    const record: PaneRecord = {
      paneId: paneIdValue,
      spec,
      title,
      state: { type: 'starting' },
      pty: null,
      coalescer,
      flow,
      buffer,
      spawnedAt: Date.now(),
      sessionId,
      cliVersion,
      cols: 80,
      rows: 24,
    };
    this.registry.add(record);

    try {
      record.pty = this.deps.pty.spawn({
        file,
        args,
        cwd: spec.projectPath,
        env,
        cols: record.cols,
        rows: record.rows,
      });
    } catch (error) {
      record.state = { type: 'failed', reason: error instanceof Error ? error.message : String(error) };
      this.#emitState(record);
      throwAppError('SPAWN_FAILED', record.state.reason);
    }

    record.state =
      sessionId === null
        ? { type: 'binding', pid: record.pty.pid }
        : { type: 'running', pid: record.pty.pid, sessionId };
    this.#emitState(record);

    record.pty.onData((chunk) => coalescer.push(chunk));
    record.pty.onExit((exitCode, signal) => {
      coalescer.flush();
      record.state = { type: 'exited', exitCode, signal, at: Date.now() };
      record.pty = null;
      flow.reset();
      this.deps.emit({ type: 'pane.exit', paneId: record.paneId, exitCode, signal });
      this.#emitState(record);
    });

    return this.registry.toHandle(record);
  }

  write(paneId: PaneId, data: string): void {
    this.registry.get(paneId)?.pty?.write(data);
  }

  acknowledge(paneId: PaneId, bytes: number): void {
    this.registry.get(paneId)?.flow.acknowledged(bytes);
  }

  resize(paneId: PaneId, cols: number, rows: number): void {
    const record = this.registry.get(paneId);
    if (record === null || cols <= 0 || rows <= 0) return;
    record.cols = cols;
    record.rows = rows;
    record.pty?.resize(cols, rows);
  }

  replayBuffer(paneId: PaneId): string {
    const record = this.registry.get(paneId);
    if (record === null) return '';
    record.flow.reset();
    return record.buffer.read();
  }

  /** Called by the correlator once ~/.claude/sessions reveals the real id. */
  bind(paneId: PaneId, pid: number, sessionId: SessionId): void {
    const record = this.registry.get(paneId);
    if (record === null || record.sessionId !== null) return;
    record.sessionId = sessionId;
    record.state = { type: 'running', pid, sessionId };
    this.deps.emit({ type: 'pane.bound', paneId, pid, sessionId });
    this.#emitState(record);
  }

  async close(paneId: PaneId, force: boolean): Promise<void> {
    const record = this.registry.get(paneId);
    if (record === null) return;

    if (record.pty !== null) {
      record.pty.kill(force ? 'SIGKILL' : 'SIGHUP');
      if (!force) {
        await new Promise<void>((resolve) => setTimeout(resolve, KILL_GRACE_MS));
        record.pty?.kill('SIGKILL');
      }
    }
    record.coalescer.dispose();
    this.registry.remove(paneId);
  }

  list(): PaneHandle[] {
    return this.registry.all().map((record) => this.registry.toHandle(record));
  }

  livePaneCount(): number {
    return this.registry.all().filter((record) => record.pty !== null).length;
  }

  async disposeAll(): Promise<void> {
    await Promise.all(this.registry.all().map((record) => this.close(record.paneId, true)));
  }

  #emitState(record: PaneRecord): void {
    this.deps.emit({ type: 'pane.state', paneId: record.paneId, state: record.state });
  }
}
