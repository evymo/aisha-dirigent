export interface RunInput {
  runId: string;
  kind: string;
  image: string;
  brokerToken: string;
  brokerUrl: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  netbirdSetupKey?: string;
  /** Execution profile selects VMM runtime: 'docker' | 'kata-firecracker' | 'kata-dragonball'. */
  profile?: string;
  /**
   * Per-run git worktree on the host (bind-mounted R/W into the container) for
   * kind='claude_cli_task'. The ClaudeCliBackend creates/removes it.
   */
  worktreeHostPath?: string;
  /** Branch the worktree run produces/pushes (carried into the container env). */
  branch?: string;
  /** Structured run inputs (prompt, story_id, …) from agent_runs.inputs. */
  inputs?: Record<string, unknown>;
  /** Per-container memory reservation (e.g. '1g'), resolved dynamically from
   *  system_config at spawn time. Falls back to config.execMemoryLimit. */
  memoryLimit?: string;
}

export interface RunResult {
  exitCode: number;
  result: unknown;
  /** Deklarace rozvrhů z obálky `__result` (plugin-exec); ostatní backendy je nevydávají. */
  schedules?: import('./sentinel.js').ScheduleDeclaration[];
  logs: Array<{ level: string; message: string; meta?: Record<string, unknown> }>;
  host: string;
  durationMs: number;
}

export interface RunnerBackend {
  execute(input: RunInput): Promise<RunResult>;
}
