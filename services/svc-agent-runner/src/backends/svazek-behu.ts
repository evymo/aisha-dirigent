/**
 * Svazek běhů claude_cli_task — odkud dítě dostane `/work`.
 *
 * ⛔ NAMĚŘENO 2026-09-28 (Coolify 4.3.16, rozbor „holé `${VAR}` ve zdroji svazku“): Coolify
 * rozhoduje bind × pojmenovaný svazek jen podle TEXTU zdroje — `${AGENT_RUNS_DIR}:/cíl` se
 * stane svazkem `<uuid>_<slug>` bez ohledu na hodnotu proměnné. Klon per běh (2026-09-24)
 * stál na opačné premise: runner klonoval do `/var/lib/agent-runs` (ve skutečnosti svazek) a
 * dítěti dal v Binds `${AGENT_RUNS_DIR}/<runId>` z hostitele — tedy JINÝ, prázdný adresář.
 * Claude by pracoval nad prázdnem a push neměl co poslat.
 *
 * Teď žádná druhá deklarace cesty: runner ZMĚŘÍ vlastní připojení cíle
 * `config.agentRunsContainerDir` (docker inspect sebe sama) a dítěti dá TÝŽ zdroj:
 *   - pojmenovaný svazek (Coolify, compose) → `Mounts` typu `volume` + `VolumeOptions.Subpath`
 *     = runId (Docker Engine API ≥ 1.45),
 *   - bind (ruční místní běh) → `Mounts` typu `bind` na `<zdroj>/<runId>`.
 * Co Docker řekne, platí; jiný typ nebo chybějící připojení = běh se nespustí (fail-closed).
 */

/** Tvar `HostConfig.Mounts[]` Docker Engine API, který běh dostane. */
export interface PripojeniBehu {
  Type: 'volume' | 'bind';
  Source: string;
  Target: string;
  ReadOnly: false;
  VolumeOptions?: { Subpath: string };
}

/** runId jako jeden segment cesty: žádné `/`, `..`, `.git`, mezery ani metaznaky. */
export function overRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || runId.startsWith('.')) {
    throw new Error(`neplatné runId pro adresář běhu: ${JSON.stringify(runId)}`);
  }
  return runId;
}

/**
 * Z `Mounts` inspekce kontejneru runneru vybere připojení cíle `cilRunneru` a složí připojení
 * podadresáře běhu pro dítě. Čistá funkce — měří ji cesty-behu.unit.test.ts.
 */
export function pripojeniBehu(mounty: unknown, cilRunneru: string, runId: string, cilDitete = '/work'): PripojeniBehu {
  overRunId(runId);
  const seznam = Array.isArray(mounty) ? (mounty as Array<Record<string, unknown> | null>) : [];
  const m = seznam.find((x) => x && x['Destination'] === cilRunneru);
  if (!m) {
    throw new Error(
      `runner nemá připojený adresář běhů ${cilRunneru} (svazek v compose exec) — klon by nepřežil a dítě by nedostalo pracovní strom; běh se nespustí`,
    );
  }
  if (m['RW'] !== true) throw new Error(`adresář běhů ${cilRunneru} je v runneru jen pro čtení — klon se do něj nezapíše; běh se nespustí`);
  if (m['Type'] === 'volume') {
    const jmeno = typeof m['Name'] === 'string' ? m['Name'] : '';
    if (!jmeno) throw new Error(`svazek běhů na ${cilRunneru} nemá jméno v inspekci Dockeru — běh se nespustí`);
    return { Type: 'volume', Source: jmeno, Target: cilDitete, ReadOnly: false, VolumeOptions: { Subpath: runId } };
  }
  if (m['Type'] === 'bind') {
    const zdroj = typeof m['Source'] === 'string' ? m['Source'] : '';
    if (!zdroj.startsWith('/')) throw new Error(`bind běhů na ${cilRunneru} nemá absolutní zdroj v inspekci Dockeru — běh se nespustí`);
    return { Type: 'bind', Source: `${zdroj.replace(/\/+$/, '')}/${runId}`, Target: cilDitete, ReadOnly: false };
  }
  throw new Error(`adresář běhů ${cilRunneru} je připojen jako ${String(m['Type'])} — dítěti ho runner předat neumí (jen volume/bind); běh se nespustí`);
}
