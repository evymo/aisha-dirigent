/**
 * Edge Function: deployment-executor
 *
 * Central deployment orchestrator with multi-provider adapter pattern.
 * Resolves story → environment → provider → execute deployment.
 *
 * Supported providers:
 *   - coolify      — Coolify API webhook/redeploy
 *   - ssh_shell    — SSH connect + execute deploy script
 *   - docker_compose_remote — SSH + docker compose pull/up
 *   - ansible      — SSH + ansible-playbook execution
 *   - manual       — No-op, logs event only
 *
 * Flow: resolve target → get secrets → pre-deploy check → execute →
 *       post-deploy verify → update story_environments → audit
 *
 * Auth: service_role only (called from n8n workflows or internal edge functions)
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import type { SupabaseClient } from "../_shared/deps.ts";
import { preflightResponse } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeployRequest {
  story_id: string;
  environment: string;
  trigger: string; // 'push', 'manual', 'scaffold', 'retry'
  force?: boolean;
}

interface DeployConfig {
  deploy_provider: string;
  deploy_id?: string;
  config: Record<string, unknown>;
  url?: string;
  branch?: string;
}

interface DeployResult {
  ok: boolean;
  provider: string;
  status: "deployed" | "failed" | "skipped";
  duration_ms: number;
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

async function deployCoolify(
  config: DeployConfig,
  _db: SupabaseClient,
): Promise<DeployResult> {
  const startMs = Date.now();
  const coolifyConfig = config.config as {
    app_uuid?: string;
    stack_uuid?: string;
    domain?: string;
    coolify_url?: string;
    coolify_token?: string;
  };

  const coolifyUrl =
    coolifyConfig.coolify_url ||
    Deno.env.get("COOLIFY_URL") ||
    "";
  const coolifyToken =
    coolifyConfig.coolify_token ||
    Deno.env.get("COOLIFY_TOKEN") ||
    "";

  if (!coolifyUrl || !coolifyToken) {
    return {
      ok: false,
      provider: "coolify",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: "Missing Coolify URL or token",
    };
  }

  const targetId = coolifyConfig.app_uuid || coolifyConfig.stack_uuid;
  if (!targetId) {
    return {
      ok: false,
      provider: "coolify",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: "Missing app_uuid or stack_uuid in config",
    };
  }

  // Determine endpoint: application or stack
  const endpoint = coolifyConfig.stack_uuid
    ? `${coolifyUrl}/api/v1/services/${targetId}/restart`
    : `${coolifyUrl}/api/v1/applications/${targetId}/restart`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${coolifyToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        provider: "coolify",
        status: "failed",
        duration_ms: Date.now() - startMs,
        message: `Coolify API ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    return {
      ok: true,
      provider: "coolify",
      status: "deployed",
      duration_ms: Date.now() - startMs,
      message: `Coolify restart triggered for ${targetId}`,
      details: { target_id: targetId, endpoint },
    };
  } catch (err) {
    return {
      ok: false,
      provider: "coolify",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: `Coolify error: ${(err as Error).message}`,
    };
  }
}

async function deploySshShell(
  config: DeployConfig,
  db: SupabaseClient,
): Promise<DeployResult> {
  const startMs = Date.now();
  const sshConfig = config.config as {
    host: string;
    port?: number;
    user?: string;
    key_secret_ref?: string;
    deploy_script_path: string;
    deploy_args?: string[];
  };

  if (!sshConfig.host || !sshConfig.deploy_script_path) {
    return {
      ok: false,
      provider: "ssh_shell",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: "Missing host or deploy_script_path in config",
    };
  }

  // Resolve SSH key from app_secrets if referenced
  let sshKey: string | undefined;
  if (sshConfig.key_secret_ref) {
    const { data: secretData } = await db.rpc("get_app_secret", {
      p_key: sshConfig.key_secret_ref,
    });
    sshKey = secretData as string | undefined;
  }

  // Build SSH command via Deno subprocess
  const sshArgs = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=10",
    "-p", String(sshConfig.port || 22),
  ];

  if (sshKey) {
    // Write temp key file
    const tmpKey = await Deno.makeTempFile({ prefix: "deploy_key_" });
    await Deno.writeTextFile(tmpKey, sshKey);
    await Deno.chmod(tmpKey, 0o600);
    sshArgs.push("-i", tmpKey);
  }

  const userHost = `${sshConfig.user || "deploy"}@${sshConfig.host}`;
  const remoteCmd = sshConfig.deploy_args
    ? `${sshConfig.deploy_script_path} ${sshConfig.deploy_args.join(" ")}`
    : sshConfig.deploy_script_path;

  try {
    const cmd = new Deno.Command("ssh", {
      args: [...sshArgs, userHost, remoteCmd],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);

    if (!output.success) {
      return {
        ok: false,
        provider: "ssh_shell",
        status: "failed",
        duration_ms: Date.now() - startMs,
        message: `SSH deploy failed (exit ${output.code}): ${stderr.slice(0, 300)}`,
        details: { exit_code: output.code, stderr: stderr.slice(0, 500) },
      };
    }

    return {
      ok: true,
      provider: "ssh_shell",
      status: "deployed",
      duration_ms: Date.now() - startMs,
      message: `SSH deploy completed on ${sshConfig.host}`,
      details: {
        host: sshConfig.host,
        script: sshConfig.deploy_script_path,
        stdout: stdout.slice(0, 500),
      },
    };
  } catch (err) {
    return {
      ok: false,
      provider: "ssh_shell",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: `SSH error: ${(err as Error).message}`,
    };
  }
}

async function deployDockerCompose(
  config: DeployConfig,
  db: SupabaseClient,
): Promise<DeployResult> {
  const startMs = Date.now();
  const dcConfig = config.config as {
    host: string;
    port?: number;
    user?: string;
    key_secret_ref?: string;
    compose_path: string;
    project_name?: string;
  };

  if (!dcConfig.host || !dcConfig.compose_path) {
    return {
      ok: false,
      provider: "docker_compose_remote",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: "Missing host or compose_path in config",
    };
  }

  // Resolve SSH key
  let sshKey: string | undefined;
  if (dcConfig.key_secret_ref) {
    const { data: secretData } = await db.rpc("get_app_secret", {
      p_key: dcConfig.key_secret_ref,
    });
    sshKey = secretData as string | undefined;
  }

  const sshArgs = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=10",
    "-p", String(dcConfig.port || 22),
  ];

  if (sshKey) {
    const tmpKey = await Deno.makeTempFile({ prefix: "deploy_key_" });
    await Deno.writeTextFile(tmpKey, sshKey);
    await Deno.chmod(tmpKey, 0o600);
    sshArgs.push("-i", tmpKey);
  }

  const userHost = `${dcConfig.user || "deploy"}@${dcConfig.host}`;
  const projectFlag = dcConfig.project_name
    ? `-p ${dcConfig.project_name}`
    : "";
  const composePath = dcConfig.compose_path;
  const remoteCmd = `cd $(dirname ${composePath}) && docker compose ${projectFlag} pull && docker compose ${projectFlag} up -d --remove-orphans`;

  try {
    const cmd = new Deno.Command("ssh", {
      args: [...sshArgs, userHost, remoteCmd],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);

    if (!output.success) {
      return {
        ok: false,
        provider: "docker_compose_remote",
        status: "failed",
        duration_ms: Date.now() - startMs,
        message: `Docker Compose deploy failed (exit ${output.code}): ${stderr.slice(0, 300)}`,
        details: { exit_code: output.code, stderr: stderr.slice(0, 500) },
      };
    }

    return {
      ok: true,
      provider: "docker_compose_remote",
      status: "deployed",
      duration_ms: Date.now() - startMs,
      message: `Docker Compose deployed on ${dcConfig.host}`,
      details: {
        host: dcConfig.host,
        compose_path: composePath,
        stdout: stdout.slice(0, 500),
      },
    };
  } catch (err) {
    return {
      ok: false,
      provider: "docker_compose_remote",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: `Docker Compose error: ${(err as Error).message}`,
    };
  }
}

async function deployAnsible(
  config: DeployConfig,
  db: SupabaseClient,
): Promise<DeployResult> {
  const startMs = Date.now();
  const ansConfig = config.config as {
    host: string;
    port?: number;
    user?: string;
    key_secret_ref?: string;
    inventory_ref?: string;
    playbook_path: string;
    extra_vars?: Record<string, unknown>;
  };

  if (!ansConfig.playbook_path) {
    return {
      ok: false,
      provider: "ansible",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: "Missing playbook_path in config",
    };
  }

  // Resolve SSH key
  let sshKeyPath: string | undefined;
  if (ansConfig.key_secret_ref) {
    const { data: secretData } = await db.rpc("get_app_secret", {
      p_key: ansConfig.key_secret_ref,
    });
    if (secretData) {
      const tmpKey = await Deno.makeTempFile({ prefix: "ansible_key_" });
      await Deno.writeTextFile(tmpKey, secretData as string);
      await Deno.chmod(tmpKey, 0o600);
      sshKeyPath = tmpKey;
    }
  }

  const args: string[] = [];

  // Inventory
  if (ansConfig.inventory_ref) {
    args.push("-i", ansConfig.inventory_ref);
  } else if (ansConfig.host) {
    // Create ad-hoc inventory
    const hostStr = `${ansConfig.host},`;
    args.push("-i", hostStr);
  }

  // SSH key
  if (sshKeyPath) {
    args.push("--private-key", sshKeyPath);
  }

  // User
  if (ansConfig.user) {
    args.push("-u", ansConfig.user);
  }

  // Extra vars
  if (ansConfig.extra_vars) {
    args.push("--extra-vars", JSON.stringify(ansConfig.extra_vars));
  }

  args.push(ansConfig.playbook_path);

  try {
    const cmd = new Deno.Command("ansible-playbook", {
      args,
      stdout: "piped",
      stderr: "piped",
      env: {
        ANSIBLE_HOST_KEY_CHECKING: "False",
        ANSIBLE_SSH_ARGS: `-o ConnectTimeout=10 -p ${ansConfig.port || 22}`,
      },
    });

    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);

    if (!output.success) {
      return {
        ok: false,
        provider: "ansible",
        status: "failed",
        duration_ms: Date.now() - startMs,
        message: `Ansible deploy failed (exit ${output.code}): ${stderr.slice(0, 300)}`,
        details: { exit_code: output.code, stderr: stderr.slice(0, 500) },
      };
    }

    return {
      ok: true,
      provider: "ansible",
      status: "deployed",
      duration_ms: Date.now() - startMs,
      message: `Ansible playbook completed: ${ansConfig.playbook_path}`,
      details: {
        playbook: ansConfig.playbook_path,
        stdout: stdout.slice(0, 500),
      },
    };
  } catch (err) {
    return {
      ok: false,
      provider: "ansible",
      status: "failed",
      duration_ms: Date.now() - startMs,
      message: `Ansible error: ${(err as Error).message}`,
    };
  }
}

function deployManual(config: DeployConfig): DeployResult {
  return {
    ok: true,
    provider: "manual",
    status: "skipped",
    duration_ms: 0,
    message: "Manual deploy provider — event logged, no automatic action",
    details: { url: config.url, branch: config.branch },
  };
}

// ---------------------------------------------------------------------------
// Provider router
// ---------------------------------------------------------------------------

async function executeDeployment(
  provider: string,
  config: DeployConfig,
  db: SupabaseClient,
): Promise<DeployResult> {
  switch (provider) {
    case "coolify":
      return deployCoolify(config, db);
    case "ssh_shell":
      return deploySshShell(config, db);
    case "docker_compose_remote":
      return deployDockerCompose(config, db);
    case "ansible":
      return deployAnsible(config, db);
    case "manual":
    case "other":
      return deployManual(config);
    default:
      return {
        ok: false,
        provider,
        status: "failed",
        duration_ms: 0,
        message: `Unknown deploy provider: ${provider}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(req, Deno.env.get("ALLOWED_ORIGINS"));
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Auth: require service_role
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ ok: false, error: "Server not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  if (token !== supabaseServiceKey) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = (await req.json()) as DeployRequest;
    const { story_id, environment, trigger, force } = body;

    if (!story_id || !environment) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing story_id or environment" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 1. Resolve story environment config
    const { data: envData, error: envError } = await db.rpc(
      "get_story_environments",
      { p_story_id: story_id },
    );

    if (envError) {
      return new Response(
        JSON.stringify({ ok: false, error: `Failed to resolve environment: ${envError.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const envList = Array.isArray(envData) ? envData : [];
    const targetEnv = envList.find(
      (e: Record<string, unknown>) => e.environment === environment,
    );

    if (!targetEnv) {
      return new Response(
        JSON.stringify({ ok: false, error: `Environment '${environment}' not found for story ${story_id}` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const deployConfig: DeployConfig = {
      deploy_provider: (targetEnv.deploy_provider as string) || "manual",
      deploy_id: targetEnv.deploy_id as string | undefined,
      config: (targetEnv.config as Record<string, unknown>) || {},
      url: targetEnv.url as string | undefined,
      branch: targetEnv.branch as string | undefined,
    };

    // 2. Check if already deploying (unless force)
    if (!force && targetEnv.deploy_status === "building") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Deployment already in progress",
          deploy_status: "building",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Update status to building
    await db.rpc("upsert_story_environment", {
      p_deploy_status: "building",
      p_environment: environment,
      p_story_id: story_id,
    });

    // 4. Record integration event  
    await db.rpc("record_integration_event", {
      p_event_source: "deployment",
      p_event_type: `deploy_${deployConfig.deploy_provider}`,
      p_external_id: `deploy-${story_id}-${environment}-${Date.now()}`,
      p_routed_to: `deployment-executor/${deployConfig.deploy_provider}`,
      p_story_id: story_id,
    });

    // 5. Execute deployment
    const result = await executeDeployment(
      deployConfig.deploy_provider,
      deployConfig,
      db,
    );

    // 6. Update story_environments with result
    const finalStatus = result.ok ? "deployed" : "failed";
    await db.rpc("upsert_story_environment", {
      p_branch: deployConfig.branch,
      p_deploy_provider: deployConfig.deploy_provider,
      p_deploy_status: finalStatus,
      p_environment: environment,
      p_story_id: story_id,
      p_url: deployConfig.url,
    });

    // 7. Audit journal
    await db.rpc("log_integration_action", {
      p_action: `deploy_${deployConfig.deploy_provider}`,
      p_action_detail: {
        story_id,
        environment,
        trigger,
        provider: deployConfig.deploy_provider,
        status: finalStatus,
        duration_ms: result.duration_ms,
        message: result.message,
      },
      p_duration_ms: result.duration_ms,
      p_service_name: "deployment-executor",
      p_status: result.ok ? "success" : "failure",
    });

    return new Response(
      JSON.stringify({
        ok: result.ok,
        provider: result.provider,
        status: result.status,
        duration_ms: result.duration_ms,
        message: result.message,
        details: result.details,
      }),
      {
        status: result.ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
