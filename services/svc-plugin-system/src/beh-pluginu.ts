/**
 * Jeden běh pluginu — sdílený HTTP routou /execute i plánovačem.
 *
 * Autorizace (kdo, za jakého tenanta, jakou akci) je věc VOLAJÍCÍHO: route ji
 * odvozuje z ověřené identity, plánovač z rozvrhu, který zapsal host. Tady se
 * už jen spouští: stažení a ověření artefaktu, izolovaný runner, audit a zápis
 * rozvrhů, které plugin v init() deklaroval.
 */
import { config } from './config.js';
import { rpcService } from './postgrest.js';
import { downloadAndVerifyArtifact, type PluginManifest } from './sandbox.js';
import { runPluginInSandbox, type ScheduleDeclaration } from './runner-client.js';
import { pristiBeh } from './planovac/cron.js';
import { vyzvednoutMetr } from './mereni.js';

export interface LogBehu {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

type LogLine = { level: string; message: string; meta?: Record<string, unknown> };

/** Co z deklarací init() skončilo v plugin_schedules — null = reconcile se nepovedl nebo runner rozvrhy nevydal. */
export interface SouhrnRozvrhu {
  zapsano: number;
  vypnuto: number;
  odmitnuto: unknown[];
}

export type VysledekBehu =
  | { ok: true; result: unknown; logs: LogLine[]; runId: string; rozvrhy: SouhrnRozvrhu | null }
  | { ok: false; status: 422 | 500 | 503; body: Record<string, unknown> };

export interface ZadaniBehu {
  plugin: PluginManifest;
  /** Capability z manifestu — ověřená volajícím. */
  action: string;
  params: Record<string, unknown>;
  /** Tenant AUTORIZOVANÝ volajícím (identita / rozvrh), nikdy syrové pole požadavku. */
  tenantId: string;
  userId: string;
  jmenemJineho: boolean;
  /** `zapaleni` = běh jen-deklaruj (init bez stahování), který zakládá rozvrhy. */
  zdroj: 'http' | 'planovac' | 'zapaleni';
}

const audit = (action: string, zadani: ZadaniBehu, details: Record<string, unknown>, summary: string) =>
  rpcService('write_audit_journal', {
    p_action_type: action,
    p_area: 'plugin',
    p_details: { plugin_slug: zadani.plugin.slug, zdroj: zadani.zdroj, tenant_id: zadani.tenantId, ...details },
    p_entity_id: zadani.plugin.slug,
    p_entity_type: 'plugin',
    p_summary: summary,
    p_user_id: zadani.userId,
  }).catch(() => {});

/**
 * Telemetrie běhu → plugin_health_events (jedna událost na běh): doba, výsledek,
 * volání ven a zápisy z metru brokeru. Čte z ní hlídač stavu zdrojů
 * (get_data_source_feed_health_block). Selhání zápisu telemetrie běh NEshodí.
 */
async function zapsatUdalost(
  zadani: ZadaniBehu,
  druh: 'invoke' | 'error' | 'timeout',
  ms: number,
  runId: string | undefined,
  chyba: string | null,
  log: LogBehu,
): Promise<void> {
  if (!zadani.plugin.id) {
    log.warn({ plugin: zadani.plugin.slug }, 'Plugin run telemetry skipped: catalog id unknown');
    return;
  }
  const metr = vyzvednoutMetr(runId);
  await rpcService('register_plugin_event', {
    p_error: chyba ? chyba.slice(0, 200) : null,
    p_event_kind: druh,
    p_latency_ms: Math.max(0, Math.round(ms)),
    p_metadata: {
      capability: zadani.action,
      trigger: zadani.zdroj,
      run_id: runId ?? null,
      // null = NEMĚŘENO (běh bez metru), ne nula
      http: metr ? metr.http : null,
      zapsano: metr ? metr.zapsano : null,
      zapsano_celkem: metr ? metr.zapsano_celkem : null,
    },
    p_plugin_id: zadani.plugin.id,
    p_tenant_id: zadani.tenantId || null,
  }).catch((err: unknown) => {
    log.warn({ plugin: zadani.plugin.slug, error: err instanceof Error ? err.message : String(err) }, 'Plugin run telemetry not recorded');
  });
}

export async function spustitPlugin(zadani: ZadaniBehu, log: LogBehu): Promise<VysledekBehu> {
  const { plugin } = zadani;

  // Isolated runner is mandatory — refuse legacy in-process execution.
  if (!config.agentRunnerEnabled) {
    log.error({ plugin: plugin.slug }, 'Plugin execution rejected: AGENT_RUNNER_ENABLED is false');
    await audit('plugin.execute.rejected', zadani, { reason: 'agent_runner_disabled' }, 'Plugin execution rejected — isolated runner disabled');
    return {
      ok: false,
      status: 503,
      body: { error: 'Plugin execution unavailable', detail: 'Isolated runner (svc-agent-runner) is required. Set AGENT_RUNNER_ENABLED=true.' },
    };
  }

  const zacatek = Date.now();
  let code: string;
  try {
    code = await downloadAndVerifyArtifact(plugin.artifactUrl, plugin.sha256);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await zapsatUdalost(zadani, 'error', Date.now() - zacatek, undefined, `artefakt: ${message}`, log);
    return { ok: false, status: 422, body: { error: `Plugin artifact error: ${message}` } };
  }

  let runnerResult: Awaited<ReturnType<typeof runPluginInSandbox>>;
  try {
    runnerResult = await runPluginInSandbox({
      pluginSlug: plugin.slug,
      action: zadani.action,
      params: zadani.params,
      image: config.agentRunnerImage,
      codeB64: Buffer.from(code).toString('base64'),
      codeSha256: plugin.sha256,
      userId: zadani.userId,
      timeoutMs: config.pluginTimeoutMs,
      serviceToken: config.postgrestServiceToken,
      pluginVersion: plugin.version,
      tenantId: zadani.tenantId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Runner error';
    log.error({ plugin: plugin.slug, error: message }, 'Plugin runner failed');
    await audit('plugin.execute.failed', zadani, { error: message.slice(0, 200) }, 'Plugin runner dispatch failed');
    await zapsatUdalost(zadani, 'error', Date.now() - zacatek, undefined, `runner: ${message}`, log);
    return { ok: false, status: 500, body: { error: 'Plugin execution failed', detail: message } };
  }

  if (runnerResult.status !== 'succeeded') {
    const posledni = [...(runnerResult.logs ?? [])].reverse().find((l) => l.level === 'error');
    await zapsatUdalost(
      zadani,
      runnerResult.status === 'timeout' ? 'timeout' : 'error',
      Date.now() - zacatek,
      runnerResult.run_id,
      posledni?.message ?? runnerResult.status,
      log,
    );
    return { ok: false, status: 500, body: { error: 'Plugin execution failed', logs: runnerResult.logs } };
  }

  await audit(
    'plugin.execute.success',
    zadani,
    { action: zadani.action, runner: 'isolated', jmenem_jineho_tenanta: zadani.jmenemJineho },
    'Plugin executed successfully (isolated runner)',
  );

  // Starší runner pole nevydá — pak se rozvrhy nepřepisují (prázdné pole by je vypnulo).
  let rozvrhy: SouhrnRozvrhu | null = null;
  if (Array.isArray(runnerResult.schedules)) {
    rozvrhy = await zapsatRozvrhy(zadani, runnerResult.schedules, log);
  }
  await zapsatUdalost(zadani, 'invoke', Date.now() - zacatek, runnerResult.run_id, null, log);

  return { ok: true, result: runnerResult.result, logs: runnerResult.logs, runId: runnerResult.run_id, rozvrhy };
}

/**
 * Deklarace z init() → plugin_schedules (reconcile_plugin_schedules validuje proti
 * manifestu a vypne nedeklarované). Příští termín spočítá host; cron, který parser
 * odmítne, se nezapíše a nahlásí se v auditu spolu s tím, co odmítla DB.
 */
export async function zapsatRozvrhy(zadani: ZadaniBehu, deklarace: ScheduleDeclaration[], log: LogBehu): Promise<SouhrnRozvrhu | null> {
  const ted = new Date();
  const kZapisu: Array<Record<string, unknown>> = [];
  const odmitnuto: Array<Record<string, unknown>> = [];
  for (const d of deklarace) {
    if (!d.capability) {
      kZapisu.push({ cron: d.cron, capability: null }); // DB ji odmítne s důvodem
      continue;
    }
    try {
      kZapisu.push({ cron: d.cron, capability: d.capability, next_run_at: pristiBeh(d.cron, ted).toISOString() });
    } catch (err) {
      odmitnuto.push({ deklarace: d, duvod: err instanceof Error ? err.message : String(err) });
    }
  }
  let vysledek: { zapsano?: number; vypnuto?: number; odmitnuto?: unknown[] } | null = null;
  try {
    vysledek = await rpcService<{ zapsano?: number; vypnuto?: number; odmitnuto?: unknown[] }>('reconcile_plugin_schedules', {
      p_declarations: kZapisu,
      p_plugin_slug: zadani.plugin.slug,
      p_tenant_id: zadani.tenantId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ plugin: zadani.plugin.slug, error: message }, 'Plugin schedules reconcile failed');
    await audit('plugin.schedule.reconcile_failed', zadani, { error: message.slice(0, 200) }, 'Plugin schedules could not be recorded');
    return null;
  }
  const vse = [...odmitnuto, ...(Array.isArray(vysledek?.odmitnuto) ? vysledek!.odmitnuto : [])];
  if (vse.length > 0) {
    log.warn({ plugin: zadani.plugin.slug, odmitnuto: vse }, 'Plugin schedule declarations rejected');
    await audit('plugin.schedule.rejected', zadani, { odmitnuto: vse }, 'Plugin schedule declarations rejected');
  }
  return { zapsano: vysledek?.zapsano ?? 0, vypnuto: vysledek?.vypnuto ?? 0, odmitnuto: vse };
}
