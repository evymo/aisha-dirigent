/**
 * Čtečka pověření poskytovatelů AI (tokeny, API klíče) — trezor instance první.
 *
 * Každý fork AISHY je vlastní instance s vlastní DB a vlastním trezorem
 * (vault.secrets). Správa si pověření nastaví v administraci
 * (set_provider_credential_admin → `credential:<JMÉNO>`); služby je čtou odtud,
 * ne z `process.env`. Katalog jmen je ODVOZENÝ z dat (auth_env_var poskytovatelů
 * a MCP serverů, credential_env_var runtime) — tahle čtečka žádný seznam jmen nedrží.
 *
 *   get(JMÉNO)
 *     1. trezor (dávkově jedním RPC `get_provider_credentials`, mezipaměť ~60 s),
 *     2. v trezoru není, ale prostředí služby ho má → PŘECHODNĚ hodnota z prostředí
 *        a JEDNOU hlasité varování „nastavte ho v administraci" (nikdy hodnota),
 *     3. jinak null — pověření chybí a volající to musí ukázat (fail-loud).
 *   Trezor nedostupný (RPC selže) → výjimka. Žádný tichý pád na env: nevíme, jestli
 *   správa pověření nezměnila nebo nesmazala.
 *
 *   migrateEnvCredentials(jména) — při startu služby: pro každé deklarované jméno,
 *   které má služba v prostředí, `set_provider_credential_if_absent`. Do trezoru se
 *   zapíše jen tam, kde ještě nic není — hodnotu z administrace nepřepíše. Tím si
 *   každý fork svoje klíče z .env přesune do vlastního trezoru sám.
 *
 * ⛔ Hodnota se NIKDY neloguje — ani délka, ani otisk. Logují se jen jména.
 */
import { createSafeLogger } from './logger.js';

/** Servisní RPC (service_role) — tvar sdílený `createServiceRpc` i vlastními klienty služeb. */
export type CredentialRpc = (fn: string, params: Record<string, unknown>) => Promise<unknown>;

/** Jméno pověření = jméno proměnné prostředí (týž tvar hlídá DB). */
export const CREDENTIAL_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface CredentialUser {
  kind: string;
  slug: string;
  display_name: string;
}

export interface CredentialCatalogEntry {
  env_var: string;
  used_by: CredentialUser[];
  is_set: boolean;
  updated_at: string | null;
  updated_by: string | null;
  source: string | null;
}

export interface CredentialMigrationReport {
  /** Zapsáno teď z prostředí do trezoru. */
  moved: string[];
  /** Trezor pověření už měl — nic se nezměnilo (administrace vyhrává). */
  kept: string[];
  /** Služba ho v prostředí nemá. */
  absent: string[];
  /** Zápis selhal (jméno mimo katalog, neplatná hodnota, DB) — jen jména a důvod bez hodnoty. */
  failed: Array<{ env_var: string; reason: string }>;
}

export interface CredentialReaderOptions {
  /** Jméno služby do logů. */
  service: string;
  /** service_role RPC. */
  rpc: CredentialRpc;
  /** Prostředí (výchozí process.env) — přechodná záloha, dokud pověření není v trezoru. */
  env?: Record<string, string | undefined>;
  /** Stáří mezipaměti (výchozí 60 s). */
  ttlMs?: number;
  /** Hodiny (testy). */
  now?: () => number;
  /** Logger (výchozí bezpečný JSON logger @aisha/security). */
  logger?: {
    safeInfo(msg: string, ctx?: Record<string, unknown>): void;
    safeWarn(msg: string, ctx?: Record<string, unknown>): void;
    safeError(msg: string, err: unknown, ctx?: Record<string, unknown>): void;
  };
}

export interface CredentialReader {
  /** Hodnota pověření, nebo null (nikde). Trezor nedostupný → výjimka. */
  get(envVar: string): Promise<string | null>;
  /** Totéž pro víc jmen jedním čtením trezoru. */
  getMany(envVars: readonly string[]): Promise<Record<string, string | null>>;
  /** Katalog pověření (jména, kdo je používá, stav) — bez hodnot; mezipaměť jako get. */
  catalog(): Promise<CredentialCatalogEntry[]>;
  /** Přesun pověření z prostředí do trezoru (jen kde trezor nic nemá). */
  migrateEnvCredentials(envVars: readonly string[]): Promise<CredentialMigrationReport>;
  /** Zahodit mezipaměť (např. po 401 od poskytovatele nebo po změně v administraci). */
  invalidate(envVar?: string): void;
}

/** Trezor pověření není dostupný — volající nesmí pokračovat s hodnotou „odněkud". */
export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

type Stav =
  | { druh: 'trezor'; hodnota: string }
  | { druh: 'nenastaveno' }
  | { druh: 'mimo_katalog' };

interface Zaznam {
  stav: Stav;
  kdy: number;
}

const DEFAULT_TTL_MS = 60_000;

function assertName(envVar: string): void {
  if (typeof envVar !== 'string' || !CREDENTIAL_NAME_PATTERN.test(envVar)) {
    // Jméno se do hlášky nevypisuje — mohla to být omylem hodnota.
    throw new Error('Neplatné jméno pověření — očekává se jméno proměnné prostředí ^[A-Z][A-Z0-9_]{2,63}$');
  }
}

function nonEmpty(v: string | undefined): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** Chybová hláška bez hodnoty: vyřízne každý výskyt známých hodnot a zkrátí. */
function cistaChyba(err: unknown, hodnoty: readonly string[]): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const h of hodnoty) if (h) msg = msg.split(h).join('[hodnota]');
  return msg.slice(0, 300);
}

function parseRows(data: unknown): Array<{ env_var: string; value: string | null }> {
  if (!Array.isArray(data)) {
    throw new CredentialStoreError('get_provider_credentials nevrátil seznam řádků');
  }
  return data.map((r) => {
    const row = r as Record<string, unknown>;
    if (typeof row.env_var !== 'string') {
      throw new CredentialStoreError('get_provider_credentials vrátil řádek bez env_var');
    }
    const value = typeof row.value === 'string' && row.value.length > 0 ? row.value : null;
    return { env_var: row.env_var, value };
  });
}

function parseCatalog(data: unknown): CredentialCatalogEntry[] {
  if (!Array.isArray(data)) {
    throw new CredentialStoreError('get_provider_credential_catalog nevrátil seznam řádků');
  }
  return data.map((r) => {
    const row = r as Record<string, unknown>;
    if (typeof row.env_var !== 'string') {
      throw new CredentialStoreError('get_provider_credential_catalog vrátil řádek bez env_var');
    }
    return {
      env_var: row.env_var,
      used_by: Array.isArray(row.used_by) ? (row.used_by as CredentialUser[]) : [],
      is_set: row.is_set === true,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
      updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
      source: typeof row.source === 'string' ? row.source : null,
    };
  });
}

export function createCredentialReader(opts: CredentialReaderOptions): CredentialReader {
  const env = opts.env ?? process.env;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  const log = opts.logger ?? createSafeLogger(`credentials:${opts.service}`);

  const cache = new Map<string, Zaznam>();
  const letici = new Map<string, Promise<void>>();
  const varovano = new Set<string>();
  let fronta: Set<string> | null = null;
  let frontaHotovo: Promise<void> | null = null;
  let katalog: { data: CredentialCatalogEntry[]; kdy: number } | null = null;

  const cerstvy = (z: Zaznam | undefined): z is Zaznam => z !== undefined && now() - z.kdy < ttlMs;

  async function vyprazdni(jmena: string[]): Promise<void> {
    let data: unknown;
    try {
      data = await opts.rpc('get_provider_credentials', { p_env_vars: jmena });
    } catch (err) {
      throw new CredentialStoreError(
        `Trezor pověření nedostupný (${opts.service}): ${cistaChyba(err, [])}`,
      );
    }
    const rows = parseRows(data);
    const kdy = now();
    const vKatalogu = new Set<string>();
    for (const r of rows) {
      vKatalogu.add(r.env_var);
      cache.set(r.env_var, {
        kdy,
        stav: r.value !== null ? { druh: 'trezor', hodnota: r.value } : { druh: 'nenastaveno' },
      });
    }
    for (const j of jmena) {
      if (!vKatalogu.has(j)) cache.set(j, { kdy, stav: { druh: 'mimo_katalog' } });
    }
  }

  /** Zařadí jména do jednoho dávkového čtení (vše požádané v témže tiku jde jedním RPC). */
  function nacti(jmena: string[]): Promise<void> {
    const cekani: Promise<void>[] = [];
    const nova: string[] = [];
    for (const j of jmena) {
      const p = letici.get(j);
      if (p) cekani.push(p);
      else nova.push(j);
    }
    if (nova.length > 0) {
      if (!fronta) {
        const tahle = new Set<string>();
        fronta = tahle;
        frontaHotovo = Promise.resolve().then(async () => {
          fronta = null;
          frontaHotovo = null;
          const jm = [...tahle];
          try {
            await vyprazdni(jm);
          } finally {
            for (const j of jm) letici.delete(j);
          }
        });
      }
      const hotovo = frontaHotovo as Promise<void>;
      for (const j of nova) {
        fronta.add(j);
        letici.set(j, hotovo);
      }
      cekani.push(hotovo);
    }
    return Promise.all(cekani).then(() => undefined);
  }

  function varujJednou(envVar: string, druh: 'nenastaveno' | 'mimo_katalog'): void {
    const klic = `${envVar}:${druh}`;
    if (varovano.has(klic)) return;
    varovano.add(klic);
    if (druh === 'nenastaveno') {
      log.safeWarn(
        `pověření ${envVar} bere z prostředí — nastavte ho v administraci (Poskytovatelé AI a tokeny)`,
        { env_var: envVar, origin: 'env', service: opts.service },
      );
    } else {
      // Jméno mimo katalog (např. klíč platformní brány, který generuje cold-start):
      // jeho domov JE prostředí služby — jen záznam, ne varování k nápravě.
      log.safeInfo(
        `pověření ${envVar} bere z prostředí — není v katalogu (platformní nebo nedeklarované), administrace ho nenastavuje`,
        { env_var: envVar, origin: 'env', service: opts.service },
      );
    }
  }

  function vyres(envVar: string): string | null {
    const z = cache.get(envVar);
    if (!z) throw new CredentialStoreError(`pověření ${envVar}: čtení trezoru nedoběhlo`);
    if (z.stav.druh === 'trezor') return z.stav.hodnota;
    const zProstredi = nonEmpty(env[envVar]);
    if (zProstredi === null) return null;
    varujJednou(envVar, z.stav.druh);
    return zProstredi;
  }

  async function getMany(envVars: readonly string[]): Promise<Record<string, string | null>> {
    const jmena = [...new Set(envVars)];
    for (const j of jmena) assertName(j);
    const stare = jmena.filter((j) => !cerstvy(cache.get(j)));
    if (stare.length > 0) await nacti(stare);
    const out: Record<string, string | null> = {};
    for (const j of jmena) out[j] = vyres(j);
    return out;
  }

  return {
    async get(envVar: string): Promise<string | null> {
      const r = await getMany([envVar]);
      return r[envVar] ?? null;
    },

    getMany,

    async catalog(): Promise<CredentialCatalogEntry[]> {
      if (katalog && now() - katalog.kdy < ttlMs) return katalog.data;
      let data: unknown;
      try {
        data = await opts.rpc('get_provider_credential_catalog', {});
      } catch (err) {
        throw new CredentialStoreError(`Katalog pověření nedostupný (${opts.service}): ${cistaChyba(err, [])}`);
      }
      katalog = { data: parseCatalog(data), kdy: now() };
      return katalog.data;
    },

    async migrateEnvCredentials(envVars: readonly string[]): Promise<CredentialMigrationReport> {
      const report: CredentialMigrationReport = { moved: [], kept: [], absent: [], failed: [] };
      for (const envVar of [...new Set(envVars)]) {
        assertName(envVar);
        const hodnota = nonEmpty(env[envVar]);
        if (hodnota === null) {
          report.absent.push(envVar);
          continue;
        }
        try {
          const zapsano = await opts.rpc('set_provider_credential_if_absent', {
            p_env_var: envVar,
            p_value: hodnota,
          });
          if (zapsano === true) report.moved.push(envVar);
          else if (zapsano === false) report.kept.push(envVar);
          else throw new Error('set_provider_credential_if_absent nevrátil boolean');
        } catch (err) {
          report.failed.push({ env_var: envVar, reason: cistaChyba(err, [hodnota]) });
        }
      }
      for (const j of report.moved) cache.delete(j);
      katalog = null;
      log.safeInfo('pověření z prostředí → trezor instance', {
        service: opts.service,
        moved: report.moved,
        kept: report.kept,
        absent: report.absent,
        failed: report.failed.map((f) => f.env_var),
      });
      for (const f of report.failed) {
        log.safeError(
          `pověření ${f.env_var} se nepodařilo přesunout z prostředí do trezoru — zůstává jen v prostředí`,
          new Error(f.reason),
          { env_var: f.env_var, service: opts.service },
        );
      }
      return report;
    },

    invalidate(envVar?: string): void {
      if (envVar === undefined) {
        cache.clear();
        katalog = null;
      } else {
        cache.delete(envVar);
      }
    },
  };
}
