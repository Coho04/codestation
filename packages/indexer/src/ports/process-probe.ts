export interface ProcessProbePort {
  /**
   * Maps pid → process start time, exactly as `procStart` in
   * ~/.claude/sessions/<pid>.json spells it. One call for all pids.
   */
  probe(pids: readonly number[]): Promise<ReadonlyMap<number, string>>;
}

export interface CliProbePort {
  /** `claude agents --json --all`, or null when the CLI is unavailable. */
  listAgents(): Promise<readonly CliAgent[] | null>;
}

export interface CliAgent {
  readonly sessionId: string;
  readonly cwd: string;
  readonly kind: 'interactive' | 'background';
  readonly startedAt: number | null;
  readonly name: string | null;
  readonly pid: number | null;
  readonly id: string | null;
  readonly status: string | null;
  readonly state: string | null;
  readonly waitingFor: string | null;
}
