/**
 * Plánovač pluginů: zabere splatné rozvrhy a spustí jejich capability.
 *
 * ⛔ NAMĚŘENO 2026-09-16: cron capability pluginů nikdy neběžely — rozvrhy nikdo
 * nezapisoval ani nečetl. Tady je čtenář: `claim_due_plugin_schedules` zabírá
 * atomicky (SKIP LOCKED + pronájem), takže víc replik hostu nespustí týž rozvrh
 * dvakrát; po běhu (úspěšném i neúspěšném) se zapíše příští termín.
 *
 * Tenant běhu je tenant ROZVRHU — zapsal ho host po běhu, který autorizoval
 * (reconcile), ne volající. Capability se před spuštěním znovu ověří proti
 * aktuálnímu manifestu (mezi zápisem a během se plugin mohl změnit).
 */
import { rpcService } from '../postgrest.js';
import { resolvePlugin, validateCapabilities } from '../sandbox.js';
import { spustitPlugin, type LogBehu } from '../beh-pluginu.js';
import { pristiBeh } from './cron.js';

/** Konstanty chování, ne fakta nasazení: tik, pronájem > dávka × strop běhu pluginu. */
export const PLANOVAC = { intervalMs: 60_000, pronajemS: 900, davka: 5 } as const;

interface ZabranyRozvrh {
  schedule_id: string;
  plugin_slug: string;
  tenant_id: string;
  handler_capability: string;
  cron_expr: string;
}

export async function jednoKolo(log: LogBehu): Promise<number> {
  let radky: ZabranyRozvrh[];
  try {
    radky = (await rpcService<ZabranyRozvrh[]>('claim_due_plugin_schedules', {
      p_lease_seconds: PLANOVAC.pronajemS,
      p_limit: PLANOVAC.davka,
    })) ?? [];
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'claim_due_plugin_schedules failed');
    return 0;
  }

  for (const r of radky) {
    const plugin = await resolvePlugin(r.plugin_slug).catch(() => null);
    if (!plugin) {
      log.warn({ plugin: r.plugin_slug, schedule: r.schedule_id }, 'Scheduled plugin is not in the catalog (canary/ga) — skipped');
    } else if (!validateCapabilities(plugin.capabilities, [r.handler_capability])) {
      log.warn({ plugin: r.plugin_slug, capability: r.handler_capability }, 'Scheduled capability is no longer declared by the plugin — skipped');
    } else {
      const v = await spustitPlugin(
        {
          plugin,
          action: r.handler_capability,
          params: {},
          tenantId: r.tenant_id,
          userId: r.tenant_id,
          jmenemJineho: false,
          zdroj: 'planovac',
        },
        log,
      );
      if (!v.ok) log.warn({ plugin: r.plugin_slug, capability: r.handler_capability, status: v.status }, 'Scheduled plugin run failed');
    }

    // Příští termín vždy — i po selhání (další pokus až v dalším termínu, ne ve smyčce).
    let dalsi: Date;
    try {
      dalsi = pristiBeh(r.cron_expr, new Date());
    } catch (err) {
      log.error({ schedule: r.schedule_id, error: err instanceof Error ? err.message : String(err) }, 'Schedule cron is invalid — retry in 24 h');
      dalsi = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    await rpcService('set_plugin_schedule_next_run', {
      p_next_run_at: dalsi.toISOString(),
      p_schedule_id: r.schedule_id,
    }).catch((err: unknown) => {
      // Pronájem vyprší a rozvrh se zabere znovu — hlasitě, ne tiše.
      log.error({ schedule: r.schedule_id, error: err instanceof Error ? err.message : String(err) }, 'set_plugin_schedule_next_run failed');
    });
  }
  return radky.length;
}

/** Vyhrazená akce obalu pluginu: zavolá init() (deklarace rozvrhů) a skončí — žádné stahování. */
export const AKCE_JEN_DEKLARUJ = '__declare';

interface KandidatZapaleni {
  plugin_slug: string;
  tenant_id: string;
  source_slug: string;
  plugin_version: string;
}

/**
 * Zapálení rozvrhů: schválený plugin aktivního zdroje, který ještě nemá rozvrhy
 * (nebo vyšla nová verze, nebo minulé zapálení selhalo), se spustí v režimu
 * jen-deklaruj. Rozvrhy zapíše tentýž reconcile jako po každém běhu.
 *
 * ⛔ NAMĚŘENO 2026-09-24 (produkce instance): plugin_schedules = 0 — rozvrhy
 * vznikaly jen po úspěšném běhu, ale první běh nespouštělo nic. Žádný plugin
 * nikdy neběžel a nikdo to nehlásil.
 *
 * Tenant = vlastník zdroje (list_plugins_to_declare ho odvodí, zdroj bez
 * vlastníka se nezapálí). Výsledek — i selhání — se zapíše, aby hlídač stavu
 * zdrojů měl co ukázat a opakování nebylo smyčka každou minutou.
 */
export async function zapalitPluginy(log: LogBehu): Promise<number> {
  let kandidati: KandidatZapaleni[];
  try {
    kandidati = (await rpcService<KandidatZapaleni[]>('list_plugins_to_declare', {
      p_limit: PLANOVAC.davka,
      p_retry_minutes: 60,
    })) ?? [];
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'list_plugins_to_declare failed');
    return 0;
  }

  for (const k of kandidati) {
    const zapsat = (status: 'ok' | 'failed', verze: string, detail: Record<string, unknown>) =>
      rpcService('record_plugin_declaration', {
        p_detail: detail,
        p_plugin_slug: k.plugin_slug,
        p_plugin_version: verze,
        p_status: status,
        p_tenant_id: k.tenant_id,
      }).catch((err: unknown) => {
        log.error({ plugin: k.plugin_slug, error: err instanceof Error ? err.message : String(err) }, 'record_plugin_declaration failed');
      });

    const plugin = await resolvePlugin(k.plugin_slug).catch(() => null);
    if (!plugin) {
      await zapsat('failed', k.plugin_version, { duvod: 'plugin není v katalogu v provozu (canary/ga)' });
      continue;
    }
    const v = await spustitPlugin(
      {
        plugin,
        action: AKCE_JEN_DEKLARUJ,
        params: {},
        tenantId: k.tenant_id,
        userId: k.tenant_id,
        jmenemJineho: false,
        zdroj: 'zapaleni',
      },
      log,
    );
    if (!v.ok) {
      await zapsat('failed', plugin.version, { duvod: 'běh jen-deklaruj selhal', status: v.status, chyba: String(v.body?.error ?? '').slice(0, 200) });
      continue;
    }
    if (!v.rozvrhy) {
      await zapsat('failed', plugin.version, { duvod: 'runner nevydal deklarace rozvrhů nebo je DB nezapsala' });
      continue;
    }
    await zapsat('ok', plugin.version, {
      zapsano: v.rozvrhy.zapsano,
      vypnuto: v.rozvrhy.vypnuto,
      odmitnuto: v.rozvrhy.odmitnuto.length,
      // důvody bez hodnot konfigurace — jen co DB/host řekly o deklaraci
      duvody: v.rozvrhy.odmitnuto.slice(0, 5),
    });
    log.info({ plugin: k.plugin_slug, zdroj: k.source_slug, zapsano: v.rozvrhy.zapsano, odmitnuto: v.rozvrhy.odmitnuto.length }, 'Plugin ignited (schedules declared)');
  }
  return kandidati.length;
}

/** Spustí plánovač (samoplánující se smyčka, bez souběhu kol). Vrací stop. */
export function spustitPlanovac(log: LogBehu): () => void {
  let zastaveno = false;
  let casovac: ReturnType<typeof setTimeout> | undefined;
  const kolo = async () => {
    if (zastaveno) return;
    try {
      // Nejdřív zapálit (vzniknou rozvrhy), pak spouštět splatné.
      await zapalitPluginy(log);
      await jednoKolo(log);
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'Plugin scheduler round failed');
    } finally {
      if (!zastaveno) casovac = setTimeout(kolo, PLANOVAC.intervalMs);
    }
  };
  casovac = setTimeout(kolo, PLANOVAC.intervalMs);
  return () => {
    zastaveno = true;
    if (casovac) clearTimeout(casovac);
  };
}
