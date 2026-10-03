/**
 * only-filter.mjs — rozhodnutí, na které appky `--only` doopravdy DOSÁHNE.
 *
 * ⛔ PROČ SAMOSTATNĚ (naměřeno 2026-08-20): `--only=model,observability-stack`
 * nasadilo JEDNU appku a skončilo `triggered: 1 · deploy failed: 0 ·
 * trigger failed: 0`. Kdo čte souhrn, přečte si „obojí vyřízeno" — appka mimo vlny
 * přitom zůstal `exited:unhealthy`.
 *
 * Příčina je POPSANÁ na dvou místech (hlavička `aisha-redeploy.mjs`
 * i docstring brány `redeploy-wave-coverage`): `filterWaveApps()` filtruje
 * UVNITŘ `wave.apps`, takže `--only` neumí vybrat appku, kterou nevlastní
 * žádná vlna. Vědělo se to, zapsalo se to — a nástroj přesto mlčel dál.
 * Zápis není měřidlo.
 *
 * Rozhodnutí žije TADY, aby šlo ověřit bez sítě a bez Coolify. Hlášení
 * (jak se to člověku řekne) zůstává ve volajícím.
 */

/**
 * @param {string[]} zadane        krátká jména z `--only` (bez prefixu instance)
 * @param {string}   prefix        `APP_PREFIX_DASH`, např. `<fork>-`
 * @param {Set<string>|Map<string,unknown>} vCoolify   plná jména appek, které v Coolify EXISTUJÍ
 * @param {Set<string>} dosazitelne plná jména appek, které vlastní některá vlna A zároveň existují
 * @param {Set<string>|Map<string,unknown>} [vypnute] plná jména appek, které manifest
 *        instance nese, ale jejich lane je vypnutá (podmínka `provision_when_env`
 *        nesplněná) — v Coolify PRÁVEM nejsou
 * @returns {{cile: string[], mimoVlny: string[], neexistuji: string[], vypnuteLane: string[]}}
 */
export function rozdelOnlyCile(zadane, prefix, vCoolify, dosazitelne, vypnute = new Set()) {
  const existuje = (n) => (typeof vCoolify.has === "function" ? vCoolify.has(n) : false);
  const cile = [];
  const mimoVlny = [];
  const neexistuji = [];
  const vypnuteLane = [];

  for (const kratke of zadane.map((s) => s.trim()).filter(Boolean)) {
    // Prefix se dosazuje jen tomu, kdo ho ještě nemá — operátor smí napsat
    // obojí (`--only=edge` i `--only=<fork>-edge`) a nesmí tím prefix zdvojit.
    const plne = kratke.startsWith(prefix) ? kratke : `${prefix}${kratke}`;
    if (dosazitelne.has(plne)) cile.push(plne);
    else if (existuje(plne)) mimoVlny.push(plne);
    // ⛔ Vypnutá lane NENÍ „neexistuje". Appka, kterou instance deklarovaně
    // nenasazuje, v Coolify chybí právem — hlásit ji jako překlep by volajícího,
    // který seznam bere z manifestu (netbird-bootstrap: stacky s NETBIRD_),
    // shodilo na každé instanci s aspoň jednou vypnutou lane.
    else if (vypnute.has(plne)) vypnuteLane.push(plne);
    else neexistuji.push(plne);
  }
  return { cile, mimoVlny, neexistuji, vypnuteLane };
}

/** Appky, na které `--only` dosáhne: vlastní je vlna A existují v Coolify. */
export function dosazitelneVeVlnach(waves, vCoolify) {
  const existuje = (n) => (typeof vCoolify.has === "function" ? vCoolify.has(n) : false);
  return new Set(waves.flatMap((w) => w.apps ?? []).filter(existuje));
}
