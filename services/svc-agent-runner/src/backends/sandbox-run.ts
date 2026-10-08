import { config } from '../config.js';
import { zajistiCestuKBrokeru } from '../broker-proxy.js';
import { dockerJSON, dockerRequest, dockerStart } from './docker-http.js';
import { assertImageAllowed } from './image-guard.js';
import type { RunInput, RunResult } from './index.js';
import { createRunContainer } from './run-container.js';
import { parseMemoryLimit } from './run-container-spec.js';
import { parseSentinelLogs } from './sentinel.js';

/**
 * Běh pluginu (plugin-exec, workflow-exec, repo-agent, doc-agent) — společný pro Docker
 * i Kata. Dřív měl každý backend vlastní kopii požadavku na kontejner a kata v ní neměla
 * kořen jen pro čtení ani `CapDrop` (rada cb M9). Liší se jen runtime VM.
 *
 * Běh dostane JEN: id běhu, adresu broker-proxy runneru, token brokeru, payload (nebo nic,
 * když se payload do ENV nevejde — vyzvedne si ho přes proxy) a lhůtu. Žádný klíč k mesh
 * síti (2026-10-06, volba A — klíč se běhu vůbec nerazí) a žádné HTTPS_PROXY: běh pluginu
 * smí ven jen na broker (jeho token nemá povolený výstup přes CONNECT).
 */
export async function runSandboxContainer(
  input: RunInput,
  opts: { runtime?: string; hostLabel: string; timeoutLabel: string },
): Promise<RunResult> {
  assertImageAllowed(input.image); // defence-in-depth: opt-in registry-prefix allowlist
  // Síť běhů uzavřená + runner v ní pod aliasem proxy — měřeno u KAŽDÉHO běhu.
  const brokerUrl = await zajistiCestuKBrokeru();
  const startedAt = Date.now();
  const host = opts.hostLabel + '@' + (process.env.HOSTNAME ?? 'unknown');
  const apiBase = '/' + config.dockerApiVersion;

  const containerId = await createRunContainer(apiBase, {
    image: input.image,
    network: config.dockerExecNetwork,
    env: [
      'RUN_ID=' + input.runId,
      'BROKER_URL=' + brokerUrl,
      'BROKER_TOKEN=' + input.brokerToken,
      // Payload do ENV jen malý (broker-proxy.ts payloadDoEnv); větší si běh vyzvedne
      // přes proxy na token běhu. Chybí = běh mimo routes/runs.ts → malý payload v ENV.
      ...(input.payloadEnv ?? ['PLUGIN_PAYLOAD=' + JSON.stringify(input.payload)]),
      'EXEC_TIMEOUT_MS=' + input.timeoutMs,
    ],
    user: config.execRunUser,
    pidsLimit: config.execPidsLimit,
    memoryBytes: parseMemoryLimit(config.execMemoryLimit),
    cpuQuota: config.execCpuQuota,
    cpuPeriod: config.execCpuPeriod,
    readonlyRootfs: true,
    tmpfs: { '/tmp': 'size=32m,noexec,nosuid' },
    ...(opts.runtime ? { runtime: opts.runtime } : {}),
  });

  try {
    await dockerStart(apiBase, containerId);

    const waitResult = await Promise.race([
      dockerJSON<{ StatusCode: number }>('POST', apiBase + '/containers/' + containerId + '/wait?condition=not-running'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(opts.timeoutLabel + ' timeout after ' + input.timeoutMs + 'ms')), input.timeoutMs + 5000),
      ),
    ]);

    const logsRes = await dockerRequest('GET', apiBase + '/containers/' + containerId + '/logs?stdout=1&stderr=1');
    const { logs, result, schedules } = parseSentinelLogs(logsRes.body);

    return { exitCode: waitResult.StatusCode, result, schedules, logs, host, durationMs: Date.now() - startedAt };
  } finally {
    await dockerRequest('DELETE', apiBase + '/containers/' + containerId + '?force=true').catch(() => {});
  }
}
