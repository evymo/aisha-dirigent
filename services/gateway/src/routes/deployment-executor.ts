/**
 * Deployment executor — multi-provider deployment orchestrator.
 * Service-role only (called from n8n workflows).
 *
 * Providers: coolify, ssh_shell, docker_compose_remote, ansible, manual.
 * Flow: resolve story env → check status → execute → update → audit.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const POSTGREST = config.postgrestUrl;
const SERVICE_TOKEN = (process.env.POSTGREST_SERVICE_TOKEN ?? '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? '';

// ── SSH host-key verification ──
// Managed known_hosts file with TOFU pinning (StrictHostKeyChecking=accept-new):
// pin the key on first connect, verify it thereafter. Never accept ANY key.
const KNOWN_HOSTS_FILE =
  process.env.DEPLOY_KNOWN_HOSTS ?? join(homedir(), '.ssh', 'aisha_deploy_known_hosts');

function ensureKnownHostsFile(): string {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- KNOWN_HOSTS_FILE is an operator-set env (DEPLOY_KNOWN_HOSTS) or a fixed default under homedir; never user input
    mkdirSync(dirname(KNOWN_HOSTS_FILE), { recursive: true });
  } catch {
    /* best-effort — ssh surfaces a clear error if the file is unwritable */
  }
  return KNOWN_HOSTS_FILE;
}

function sshHostKeyArgs(): string[] {
  return ['-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${ensureKnownHostsFile()}`];
}

// ── Remote-path validation (defense-in-depth) ──
// Remote script/compose paths are interpolated into a shell command on the
// target. Require an absolute path and reject shell metacharacters so a
// malicious env config cannot inject commands.
const SHELL_METACHAR = /[;&|\x60$(){}<>\s\x27\x22\\!*?[\]#\n\r]/;

function isSafeRemotePath(p: unknown): p is string {
  return typeof p === 'string' && p.startsWith('/') && !SHELL_METACHAR.test(p);
}

// ── Types ──

interface DeployRequest {
  environment: string;
  force?: boolean;
  story_id: string;
  trigger: string; // 'push', 'manual', 'scaffold', 'retry'
}

interface DeployConfig {
  branch?: string;
  config: Record<string, unknown>;
  deploy_id?: string;
  deploy_provider: string;
  url?: string;
}

interface DeployResult {
  details?: Record<string, unknown>;
  duration_ms: number;
  message: string;
  ok: boolean;
  provider: string;
  status: 'deployed' | 'failed' | 'skipped';
}

// ── PostgREST RPC ──

async function rpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T | null> {
  const resp = await fetch(`${POSTGREST}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: {
      'Authorization': `Bearer ${SERVICE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

// ── Provider adapters ──

async function deployCoolify(cfg: DeployConfig): Promise<DeployResult> {
  const startMs = Date.now();
  const c = cfg.config as {
    app_uuid?: string;
    coolify_token?: string;
    coolify_url?: string;
    stack_uuid?: string;
  };

  const coolifyUrl = c.coolify_url || process.env.COOLIFY_URL || '';
  const coolifyToken = c.coolify_token || process.env.COOLIFY_TOKEN || '';

  if (!coolifyUrl || !coolifyToken) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: 'Missing Coolify URL or token', ok: false, provider: 'coolify', status: 'failed' };
  }

  const targetId = c.app_uuid || c.stack_uuid;
  if (!targetId) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: 'Missing app_uuid or stack_uuid', ok: false, provider: 'coolify', status: 'failed' };
  }

  const endpoint = c.stack_uuid
    ? `${coolifyUrl}/api/v1/services/${targetId}/restart`
    : `${coolifyUrl}/api/v1/applications/${targetId}/restart`;

  try {
    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${coolifyToken}`, 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return { details: undefined, duration_ms: Date.now() - startMs, message: `Coolify API ${response.status}: ${body.slice(0, 200)}`, ok: false, provider: 'coolify', status: 'failed' };
    }

    return { details: { endpoint, target_id: targetId }, duration_ms: Date.now() - startMs, message: `Coolify restart triggered for ${targetId}`, ok: true, provider: 'coolify', status: 'deployed' };
  } catch (err) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: `Coolify error: ${(err as Error).message}`, ok: false, provider: 'coolify', status: 'failed' };
  }
}

async function deploySshShell(cfg: DeployConfig): Promise<DeployResult> {
  const startMs = Date.now();
  const c = cfg.config as {
    deploy_args?: string[];
    deploy_script_path: string;
    host: string;
    key_secret_ref?: string;
    port?: number;
    user?: string;
  };

  if (!c.host || !c.deploy_script_path) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: 'Missing host or deploy_script_path', ok: false, provider: 'ssh_shell', status: 'failed' };
  }

  if (!isSafeRemotePath(c.deploy_script_path)) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: 'Invalid deploy_script_path: must be an absolute path with no shell metacharacters', ok: false, provider: 'ssh_shell', status: 'failed' };
  }

  // Resolve SSH key from vault
  let sshKey: string | undefined;
  if (c.key_secret_ref) {
    sshKey = await rpc<string>('get_app_secret', { p_key: c.key_secret_ref }) ?? undefined;
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, unlink, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const execFileAsync = promisify(execFile);

  const sshArgs = [...sshHostKeyArgs(), '-o', 'ConnectTimeout=10', '-p', String(c.port || 22)];
  let tmpKeyPath: string | undefined;

  if (sshKey) {
    tmpKeyPath = join(tmpdir(), `deploy_key_${Date.now()}`);
    await writeFile(tmpKeyPath, sshKey, { mode: 0o600 });
    await chmod(tmpKeyPath, 0o600);
    sshArgs.push('-i', tmpKeyPath);
  }

  const userHost = `${c.user || 'deploy'}@${c.host}`;
  const remoteCmd = c.deploy_args ? `${c.deploy_script_path} ${c.deploy_args.join(' ')}` : c.deploy_script_path;

  try {
    const { stdout, stderr } = await execFileAsync('ssh', [...sshArgs, userHost, remoteCmd], { timeout: 120_000 });
    if (tmpKeyPath) await unlink(tmpKeyPath).catch(() => {});
    return { details: { host: c.host, script: c.deploy_script_path, stdout: stdout.slice(0, 500) }, duration_ms: Date.now() - startMs, message: `SSH deploy completed on ${c.host}`, ok: true, provider: 'ssh_shell', status: 'deployed' };
  } catch (err) {
    if (tmpKeyPath) await unlink(tmpKeyPath).catch(() => {});
    const msg = (err as Error & { stderr?: string }).stderr?.slice(0, 300) || (err as Error).message;
    return { details: undefined, duration_ms: Date.now() - startMs, message: `SSH deploy failed: ${msg}`, ok: false, provider: 'ssh_shell', status: 'failed' };
  }
}

async function deployDockerCompose(cfg: DeployConfig): Promise<DeployResult> {
  const startMs = Date.now();
  const c = cfg.config as {
    compose_path: string;
    host: string;
    key_secret_ref?: string;
    port?: number;
    project_name?: string;
    user?: string;
  };

  if (!c.host || !c.compose_path) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: 'Missing host or compose_path', ok: false, provider: 'docker_compose_remote', status: 'failed' };
  }

  if (!isSafeRemotePath(c.compose_path)) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: 'Invalid compose_path: must be an absolute path with no shell metacharacters', ok: false, provider: 'docker_compose_remote', status: 'failed' };
  }

  let sshKey: string | undefined;
  if (c.key_secret_ref) {
    sshKey = await rpc<string>('get_app_secret', { p_key: c.key_secret_ref }) ?? undefined;
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, unlink, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const execFileAsync = promisify(execFile);

  const sshArgs = [...sshHostKeyArgs(), '-o', 'ConnectTimeout=10', '-p', String(c.port || 22)];
  let tmpKeyPath: string | undefined;

  if (sshKey) {
    tmpKeyPath = join(tmpdir(), `deploy_key_${Date.now()}`);
    await writeFile(tmpKeyPath, sshKey, { mode: 0o600 });
    await chmod(tmpKeyPath, 0o600);
    sshArgs.push('-i', tmpKeyPath);
  }

  const userHost = `${c.user || 'deploy'}@${c.host}`;
  const projectFlag = c.project_name ? `-p ${c.project_name}` : '';
  const remoteCmd = `cd $(dirname ${c.compose_path}) && docker compose ${projectFlag} pull && docker compose ${projectFlag} up -d --remove-orphans`;

  try {
    const { stdout } = await execFileAsync('ssh', [...sshArgs, userHost, remoteCmd], { timeout: 300_000 });
    if (tmpKeyPath) await unlink(tmpKeyPath).catch(() => {});
    return { details: { compose_path: c.compose_path, host: c.host, stdout: stdout.slice(0, 500) }, duration_ms: Date.now() - startMs, message: `Docker Compose deployed on ${c.host}`, ok: true, provider: 'docker_compose_remote', status: 'deployed' };
  } catch (err) {
    if (tmpKeyPath) await unlink(tmpKeyPath).catch(() => {});
    const msg = (err as Error & { stderr?: string }).stderr?.slice(0, 300) || (err as Error).message;
    return { details: undefined, duration_ms: Date.now() - startMs, message: `Docker Compose failed: ${msg}`, ok: false, provider: 'docker_compose_remote', status: 'failed' };
  }
}

async function deployAnsible(cfg: DeployConfig): Promise<DeployResult> {
  const startMs = Date.now();
  const c = cfg.config as {
    extra_vars?: Record<string, unknown>;
    host: string;
    inventory_ref?: string;
    key_secret_ref?: string;
    playbook_path: string;
    port?: number;
    user?: string;
  };

  if (!c.playbook_path) {
    return { details: undefined, duration_ms: Date.now() - startMs, message: 'Missing playbook_path', ok: false, provider: 'ansible', status: 'failed' };
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { writeFile, unlink, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const execFileAsync = promisify(execFile);

  let tmpKeyPath: string | undefined;
  if (c.key_secret_ref) {
    const sshKey = await rpc<string>('get_app_secret', { p_key: c.key_secret_ref });
    if (sshKey) {
      tmpKeyPath = join(tmpdir(), `ansible_key_${Date.now()}`);
      await writeFile(tmpKeyPath, sshKey, { mode: 0o600 });
      await chmod(tmpKeyPath, 0o600);
    }
  }

  const args: string[] = [];
  if (c.inventory_ref) {
    args.push('-i', c.inventory_ref);
  } else if (c.host) {
    args.push('-i', `${c.host},`);
  }
  if (tmpKeyPath) args.push('--private-key', tmpKeyPath);
  if (c.user) args.push('-u', c.user);
  if (c.extra_vars) args.push('--extra-vars', JSON.stringify(c.extra_vars));
  args.push(c.playbook_path);

  try {
    const { stdout } = await execFileAsync('ansible-playbook', args, {
      env: {
        ...process.env,
        // Verify host keys (TOFU): pin on first connect via a managed
        // known_hosts, verify thereafter. Never accept ANY key.
        ANSIBLE_HOST_KEY_CHECKING: 'True',
        ANSIBLE_SSH_ARGS: `-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${ensureKnownHostsFile()} -o ConnectTimeout=10 -p ${c.port || 22}`,
      },
      timeout: 600_000,
    });
    if (tmpKeyPath) await unlink(tmpKeyPath).catch(() => {});
    return { details: { playbook: c.playbook_path, stdout: stdout.slice(0, 500) }, duration_ms: Date.now() - startMs, message: `Ansible playbook completed: ${c.playbook_path}`, ok: true, provider: 'ansible', status: 'deployed' };
  } catch (err) {
    if (tmpKeyPath) await unlink(tmpKeyPath).catch(() => {});
    const msg = (err as Error & { stderr?: string }).stderr?.slice(0, 300) || (err as Error).message;
    return { details: undefined, duration_ms: Date.now() - startMs, message: `Ansible failed: ${msg}`, ok: false, provider: 'ansible', status: 'failed' };
  }
}

function deployManual(cfg: DeployConfig): DeployResult {
  return { details: { branch: cfg.branch, url: cfg.url }, duration_ms: 0, message: 'Manual deploy — event logged, no automatic action', ok: true, provider: 'manual', status: 'skipped' };
}

// ── Provider router ──

async function executeDeployment(provider: string, cfg: DeployConfig): Promise<DeployResult> {
  switch (provider) {
    case 'coolify': return deployCoolify(cfg);
    case 'ssh_shell': return deploySshShell(cfg);
    case 'docker_compose_remote': return deployDockerCompose(cfg);
    case 'ansible': return deployAnsible(cfg);
    case 'manual':
    case 'other': return deployManual(cfg);
    default: return { details: undefined, duration_ms: 0, message: `Unknown provider: ${provider}`, ok: false, provider, status: 'failed' };
  }
}

// ── Route ──

export const deploymentExecutorRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  app.post<{ Body: DeployRequest }>('/deployment-executor', async (request, reply) => {
    // Auth: internal API key (called from n8n)
    const authHeader = request.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!INTERNAL_API_KEY || token !== INTERNAL_API_KEY) {
      return reply.code(403).send({ error: 'Service role required', ok: false });
    }

    const { environment, force, story_id, trigger } = request.body;
    if (!story_id || !environment) {
      return reply.code(400).send({ error: 'Missing story_id or environment', ok: false });
    }

    // 1. Resolve story environment config
    const envList = await rpc<Array<Record<string, unknown>>>('get_story_environments', { p_story_id: story_id });
    if (!envList) {
      return reply.code(500).send({ error: 'Failed to resolve environment', ok: false });
    }

    const targetEnv = envList.find((e) => e.environment === environment);
    if (!targetEnv) {
      return reply.code(404).send({ error: `Environment '${environment}' not found for story ${story_id}`, ok: false });
    }

    const deployCfg: DeployConfig = {
      branch: targetEnv.branch as string | undefined,
      config: (targetEnv.config as Record<string, unknown>) || {},
      deploy_id: targetEnv.deploy_id as string | undefined,
      deploy_provider: (targetEnv.deploy_provider as string) || 'manual',
      url: targetEnv.url as string | undefined,
    };

    // 2. Check if already deploying
    if (!force && targetEnv.deploy_status === 'building') {
      return reply.code(409).send({ deploy_status: 'building', error: 'Deployment already in progress', ok: false });
    }

    // 3. Update status to building
    await rpc('upsert_story_environment', { p_deploy_status: 'building', p_environment: environment, p_story_id: story_id });

    // 4. Record integration event
    await rpc('record_integration_event', {
      p_event_source: 'deployment',
      p_event_type: `deploy_${deployCfg.deploy_provider}`,
      p_external_id: `deploy-${story_id}-${environment}-${Date.now()}`,
      p_routed_to: `deployment-executor/${deployCfg.deploy_provider}`,
      p_story_id: story_id,
    });

    // 5. Execute deployment
    const result = await executeDeployment(deployCfg.deploy_provider, deployCfg);

    // 6. Update story_environments with result
    const finalStatus = result.ok ? 'deployed' : 'failed';
    await rpc('upsert_story_environment', {
      p_branch: deployCfg.branch,
      p_deploy_provider: deployCfg.deploy_provider,
      p_deploy_status: finalStatus,
      p_environment: environment,
      p_story_id: story_id,
      p_url: deployCfg.url,
    });

    // 7. Audit journal
    await rpc('log_integration_action', {
      p_action: `deploy_${deployCfg.deploy_provider}`,
      p_action_detail: {
        duration_ms: result.duration_ms,
        environment,
        message: result.message,
        provider: deployCfg.deploy_provider,
        status: finalStatus,
        story_id,
        trigger,
      },
      p_duration_ms: result.duration_ms,
      p_service_name: 'deployment-executor',
      p_status: result.ok ? 'success' : 'failure',
    });

    return reply.code(result.ok ? 200 : 500).send({
      details: result.details,
      duration_ms: result.duration_ms,
      message: result.message,
      ok: result.ok,
      provider: result.provider,
      status: result.status,
    });
  });
};
