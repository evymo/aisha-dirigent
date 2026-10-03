/**
 * Kam smí plugin z sandboxu volat — ze SCHVÁLENÉ sandbox politiky pluginu.
 *
 * ⛔ NAMĚŘENO 2026-09-26 (produkce instance): broker bral povolené hostitele
 * i RPC jen z proměnných služby `PLUGIN_NETWORK_ALLOWLIST` / `PLUGIN_RPC_WHITELIST`
 * a ty byly prázdné — každý schválený plugin by na prvním volání dodavatele
 * i na prvním zápisu dostal 403. Manifest přitom hostitele nesl
 * (`sandbox.network_allowlist`), jen ho nikdo nečetl.
 *
 * ⭐ Zdroj pravdy je politika v katalogu (`get_plugin_sandbox_policy`): je součástí
 * toho, co člověk schvaluje, a plugin mimo canary/ga dostane prázdné seznamy.
 * Proměnná instance smí seznam jen ZÚŽIT (průnik), nikdy rozšířit — prázdná
 * proměnná znamená „instance nic navíc neomezuje", ne „nic nesmí".
 *
 * Mezipaměť 60 s: plugin volá dodavatele v cyklu (knihy jízd po vozidlech);
 * dotaz do DB na každé volání by zátěž násobil. Odvolané schválení se tedy
 * projeví nejpozději do minuty.
 */
import { config } from './config.js';
import { rpcService } from './postgrest.js';

export interface SandboxPolitika {
  schvaleno: boolean;
  /** Jméno zdroje ze `source_spec` — pod jiným plugin do obecných drah nezapíše. */
  zdroj: string | null;
  hosty: string[];
  rpc: string[];
}

interface PolitikaZDb {
  schvaleno?: boolean;
  source_slug?: unknown;
  network_allowlist?: unknown;
  rpc_allowlist?: unknown;
}

const TTL_MS = 60_000;
const mezipamet = new Map<string, { at: number; politika: SandboxPolitika }>();

const retezce = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

/** Průnik s omezením instance; prázdné omezení = instance nic navíc nezužuje. */
export function zuzit(zManifestu: string[], zInstance: string[]): string[] {
  return zInstance.length === 0 ? zManifestu : zManifestu.filter((x) => zInstance.includes(x));
}

export interface PolitikaDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  ted: () => number;
  instanceHosty: string[];
  instanceRpc: string[];
}

const vychoziDeps = (): PolitikaDeps => ({
  rpc: (fn, args) => rpcService(fn, args),
  ted: () => Date.now(),
  instanceHosty: config.networkAllowlist,
  instanceRpc: config.rpcWhitelist,
});

/**
 * Politika pluginu `slug`. Selhání čtení se NEPŘEKLÁDÁ na povolení ani na zákaz —
 * vyhodí chybu a broker odpoví 503 (plugin to zkusí v dalším termínu).
 */
export async function politikaPluginu(slug: string, deps: PolitikaDeps = vychoziDeps()): Promise<SandboxPolitika> {
  const ulozena = mezipamet.get(slug);
  if (ulozena && deps.ted() - ulozena.at < TTL_MS) return ulozena.politika;

  const z = ((await deps.rpc('get_plugin_sandbox_policy', { p_plugin_slug: slug })) ?? {}) as PolitikaZDb;
  const politika: SandboxPolitika = {
    schvaleno: z.schvaleno === true,
    zdroj: typeof z.source_slug === 'string' && z.source_slug !== '' ? z.source_slug : null,
    hosty: zuzit(retezce(z.network_allowlist), deps.instanceHosty),
    rpc: zuzit(retezce(z.rpc_allowlist), deps.instanceRpc),
  };
  mezipamet.set(slug, { at: deps.ted(), politika });
  return politika;
}

/**
 * Smí plugin volat RPC s těmito argumenty? `p_source_slug` (obecné dráhy jako
 * audience_sync_source_catalog) musí být jméno JEHO zdroje — cizí katalog by
 * jinak mohl přepsat, u snapshotu i smazat. Plugin bez zdroje ho nesmí poslat.
 */
export function zdrojSedi(politika: SandboxPolitika, params: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(params, 'p_source_slug')) return true;
  return politika.zdroj !== null && params.p_source_slug === politika.zdroj;
}

/** Jen pro testy. */
export function vyprazdnitMezipamet(): void {
  mezipamet.clear();
}
