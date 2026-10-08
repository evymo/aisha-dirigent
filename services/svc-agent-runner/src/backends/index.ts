export interface RunInput {
  runId: string;
  kind: string;
  image: string;
  brokerToken: string;
  // `BROKER_URL` běhu neurčuje volající: je to vždy broker-proxy runneru v uzavřené síti
  // běhů (broker-proxy.ts). Klíč k mesh síti běh nedostává vůbec (2026-10-06, volba A).
  payload: Record<string, unknown>;
  /**
   * ENV s payloadem pro kontejner (broker-proxy.ts `payloadDoEnv`): `PLUGIN_PAYLOAD=…`,
   * nebo prázdné, když se payload do ENV nevejde a běh si ho vyzvedne přes proxy.
   * Chybí = backend složí `PLUGIN_PAYLOAD` sám (běhy mimo routes/runs.ts).
   */
  payloadEnv?: string[];
  timeoutMs: number;
  /** Execution profile selects VMM runtime: 'docker' | 'kata-firecracker' | 'kata-dragonball'. */
  profile?: string;
  /** Branch the run produces/pushes (carried into the container env). */
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
