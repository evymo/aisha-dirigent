import { config } from '../config.js';
import { dockerJSON, dockerRequest, dockerStart, ensureExecNetwork } from './docker-http.js';
import { assertImageAllowed } from './image-guard.js';
import type { RunInput, RunResult, RunnerBackend } from './index.js';
import { parseSentinelLogs } from './sentinel.js';

export class DockerBackend implements RunnerBackend {
  async execute(input: RunInput): Promise<RunResult> {
    assertImageAllowed(input.image); // defence-in-depth: opt-in registry-prefix allowlist
    await ensureExecNetwork();
    const startedAt = Date.now();
    const host = 'docker@' + (process.env.HOSTNAME ?? 'unknown');
    const apiBase = '/' + config.dockerApiVersion;

    const created = await dockerJSON<{ Id: string }>('POST', apiBase + '/containers/create', {
      Image: input.image,
      // ⛔ JEN exec síť (naměřeno 2026-09-30 na riq). Druhá síť tu byla napevno
      // `aisha-network` — jméno sítě JINÉ instance; na riq neexistuje, takže START
      // kontejneru selhal (Docker ExitCode 128) a nikdo odpověď nečetl. Jméno
      // instance do kódu stacku nepatří; cestu k brokeru (PLUGIN_BROKER_URL je
      // jméno v meshi) řeší mesh, ne cizí sdílená síť.
      NetworkingConfig: {
        EndpointsConfig: {
          [config.dockerExecNetwork]: {},
        },
      },
      HostConfig: {
        NetworkMode: config.dockerExecNetwork,
        Memory: parseMemoryLimit(config.execMemoryLimit),
        CpuQuota: config.execCpuQuota,
        CpuPeriod: config.execCpuPeriod,
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'size=32m,noexec,nosuid' },
        CapDrop: ['ALL'],
        AutoRemove: false,
      },
      Env: [
        'RUN_ID=' + input.runId,
        'BROKER_URL=' + input.brokerUrl,
        'BROKER_TOKEN=' + input.brokerToken,
        'PLUGIN_PAYLOAD=' + JSON.stringify(input.payload),
        'EXEC_TIMEOUT_MS=' + input.timeoutMs,
        ...(config.netbirdEnabled && input.netbirdSetupKey
          ? ['NB_SETUP_KEY=' + input.netbirdSetupKey, 'NB_MANAGEMENT_URL=' + config.netbirdApiUrl]
          : []),
      ],
    });

    const containerId: string = created.Id;
    try {
      await dockerStart(apiBase, containerId);

      const waitResult = await Promise.race([
        dockerJSON<{ StatusCode: number }>('POST', apiBase + '/containers/' + containerId + '/wait?condition=not-running'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Container timeout after ' + input.timeoutMs + 'ms')), input.timeoutMs + 5000),
        ),
      ]);

      const logsRes = await dockerRequest('GET', apiBase + '/containers/' + containerId + '/logs?stdout=1&stderr=1');
      const { logs, result, schedules } = parseSentinelLogs(logsRes.body);

      return { exitCode: waitResult.StatusCode, result, schedules, logs, host, durationMs: Date.now() - startedAt };
    } finally {
      await dockerRequest('DELETE', apiBase + '/containers/' + containerId + '?force=true').catch(() => {});
    }
  }
}

function parseMemoryLimit(limit: string): number {
  const m = limit.match(/^(\d+)([kmg]?)$/i);
  if (!m) return 256 * 1024 * 1024;
  const val = parseInt(m[1] ?? '0', 10);
  switch ((m[2] ?? '').toLowerCase()) {
    case 'k': return val * 1024;
    case 'm': return val * 1024 * 1024;
    case 'g': return val * 1024 * 1024 * 1024;
    default: return val;
  }
}
