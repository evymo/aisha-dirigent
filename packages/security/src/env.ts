/**
 * Povinné hodnoty prostředí — adresy a identifikátory, které se NEDOSAZUJÍ.
 *
 * Sourozenec `requireSecret()`: ten hlídá TAJEMSTVÍ (délka, slabé hodnoty),
 * tenhle hlídá ADRESY a jména. Rozdíl je v tom, co je vada — u adresy není
 * problém krátká hodnota, ale hodnota VYMYŠLENÁ.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-24)
 * -------------------------------------
 * Dvacet služeb dosazovalo `process.env.KEYCLOAK_URL ?? 'http://keycloak:8080'`.
 * Dvě věci na tom byly špatně a obě jsou tiché:
 *
 *   1. `keycloak` NENESE PREFIX INSTANCE. Na sdíleném hostiteli běží víc
 *      instancí vedle sebe, takže takové jméno buď nerozliší nic, nebo trefí
 *      kontejner CIZÍ instance. Produkce má správně `http://<prefix>-keycloak:80`.
 *   2. Dosazený PORT byl navíc jiný (8080 vs 80), takže kdyby fallback někdy
 *      vystřelil, selhal by na spojení — o krok dál od příčiny.
 *
 * Protože se hodnota doručuje vždy, dosazení NIKDY nevystřelilo — a právě proto
 * by se na něj přišlo až ve chvíli, kdy proměnná jednou chybět bude. Dosazení
 * není záloha; je to maska.
 *
 * Majitel (2026-08-24): „žádný fallback, musí to být přesné, project specific."
 */

export interface RequireEnvOptions {
  /** Jméno služby pro hlášku — ať je z chyby poznat, kdo se zastavil. */
  service: string;
  /** Proč to ta služba potřebuje. Objeví se v chybě, takže piš pro operátora. */
  why?: string;
}

/**
 * Vrátí hodnotu proměnné, nebo SELŽE. Nikdy nedosazuje.
 *
 * @throws {Error} když proměnná chybí nebo je prázdná
 */
export function requireEnv(name: string, opts: RequireEnvOptions): string {
  const raw = process.env[name];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value) return value;
  const why = opts.why ? ` ${opts.why}` : '';
  throw new Error(
    `[${opts.service}] ${name} není nastavená — odmítám dosadit.${why} ` +
      'Hodnota je DEKLAROVANÁ (derivace topologie nebo konstanta v env) a doručuje ji ' +
      'coolify-sync-envs.sh; chybí-li, je vada v DORUČENÍ, ne v této službě.',
  );
}
