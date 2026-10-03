import type { RunInput, RunResult, RunnerBackend } from './index.js';
import { parseSentinelLogs } from './sentinel.js';
import { config } from '../config.js';
import { assertImageAllowed } from './image-guard.js';
import { dockerJSON, dockerRequest, dockerStart, ensureExecNetwork } from './docker-http.js';

// Kata Containers runs as a Docker-compatible runtime via containerd shim.
// The Docker socket is the same — only RuntimeClass differs ('kata-fc' for Firecracker).
// This allows sandboxed VM-level isolation without a separate gRPC CRI client.

/**
 * Map AISHA execution profile to containerd Runtime name.
 * - 'kata-firecracker' → 'kata-fc' (Firecracker VMM, ~100ms cold start, sealed/stateless)
 * - 'kata-dragonball' → 'kata-dragonball' (DragonBall VMM, container-native, workspace-friendly)
 * Falls back to config default or 'kata-fc'.
 */
function runtimeFromProfile(profile: string | undefined): string {
  if (profile === 'kata-firecracker') return 'kata-fc';
  if (profile === 'kata-dragonball') return 'kata-dragonball';
  return config.kataGrpcEndpoint || 'kata-fc';
}

export class KataBackend implements RunnerBackend {
  async execute(input: RunInput): Promise<RunResult> {
    assertImageAllowed(input.image); // defence-in-depth: opt-in registry-prefix allowlist
    if (!config.dockerSocket) {
      throw new Error('Kata backend requires DOCKER_SOCKET (containerd-backed Docker daemon with kata-fc runtime).');
    }

    const startedAt = Date.now();
    const host = 'kata@' + (process.env.HOSTNAME ?? 'unknown');
    const kataRuntime = runtimeFromProfile(input.profile);
    const apiBase = '/' + config.dockerApiVersion;
    await ensureExecNetwork();

    const created = await dockerJSON<{ Id: string }>('POST', apiBase + '/containers/create', {
      Image: input.image,
      // Izolační síť běhů jako u DockerBackend. Dřív napevno `aisha-network` —
      // jméno sítě jiné instance (naměřeno 2026-09-30 na riq, viz backends/docker.ts).
      NetworkingConfig: {
        EndpointsConfig: {
          [config.dockerExecNetwork]: {},
        },
      },
      HostConfig: {
        NetworkMode: config.dockerExecNetwork,
        // kata-fc = Firecracker VMM; kata-dragonball = DragonBall VMM
        Runtime: kataRuntime,
        Memory: parseMemoryLimit(config.execMemoryLimit),
        CpuQuota: config.execCpuQuota,
        CpuPeriod: config.execCpuPeriod,
        SecurityOpt: ['no-new-privileges:true'],
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
          setTimeout(() => reject(new Error('Kata container timeout after ' + input.timeoutMs + 'ms')), input.timeoutMs + 5000),
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
