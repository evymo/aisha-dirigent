import { odUvozovkuj } from "./env-hodnota.mjs";

/**
 * Build-arg pro pull-through cache obrazů z Docker Hubu — jeden domov pro skripty,
 * které staví Dockerfile s `ARG REGISTRY_PROXY` (`FROM ${REGISTRY_PROXY}…`).
 *
 * Bez předání se prefix dosadí prázdně a obraz jde přímo na Docker Hub. Naměřeno
 * 2026-09-13: upstream PR #955 padl v CI na `pgvector/pgvector:pg17: 429 Too Many
 * Requests` dřív, než se spustila jediná SQL (hlídá dockerfile-cache-prefix.gate).
 *
 * V CI proměnnou vynucuje `scripts/ci/registry-proxy-guard.sh` (prázdná = STOP).
 * Tady se předává JEN když je nastavená: lokální vývojář bez cache staví podle
 * výchozí hodnoty, kterou deklaruje sám Dockerfile (`ARG REGISTRY_PROXY=`). Špatný
 * TVAR ale zastaví i lokálně — `<host>` bez lomítka by vyrobil `<host>pgvector/…`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} `[]` nebo `["--build-arg", "REGISTRY_PROXY=<host>/"]`
 */
export function registryProxyBuildArgs(env = process.env) {
  const hodnota = env.REGISTRY_PROXY;
  if (!hodnota) return [];
  if (!hodnota.endsWith("/")) {
    throw new Error(
      `REGISTRY_PROXY='${hodnota}' nekončí lomítkem — je to prefix obrazu, ` +
        `výsledek by byl '${hodnota}pgvector/pgvector:…'.`,
    );
  }
  return ["--build-arg", `REGISTRY_PROXY=${hodnota}`];
}

/**
 * Domov prefixu pull-through cache: řádek `REGISTRY_PROXY=${REGISTRY_PROXY-<host>/}`
 * v config/image-versions.env. Soubor se SOURCUJE (cold-start) i čte (env-doktor),
 * takže tahle jedna hodnota platí pro obě cesty.
 *
 * Holá pomlčka (`-`, ne `:-`) je záměr: nastavená PRÁZDNÁ hodnota přežije. To je
 * výslovné vypnutí cache pro nouzi (rozhodnutí majitele 2026-09-14) — jen jako
 * deklarace operátora v .env-prod-backup, nikdy jako tichý výchozí stav.
 *
 * ⛔ Naměřeno 2026-09-14 na instanci <fork>: soubor měl `${REGISTRY_PROXY:-}` a sourcování ho
 * NASTAVILO na prázdno. Heredoc cold-startu (`${REGISTRY_PROXY-${REGISTRY_DOMAIN…}}`)
 * pak viděl „nastaveno" a odvození z REGISTRY_DOMAIN nikdy neproběhlo → build i
 * `image:` piny šly přímo na Docker Hub (6/6 obrazů, 23/23 pinů bez prefixu).
 *
 * @param {string} imageVersionsText obsah config/image-versions.env
 * @returns {string} např. "localhost:5001/"
 */
export function domovRegistryProxy(imageVersionsText) {
  const m = String(imageVersionsText).match(/^REGISTRY_PROXY=\$\{REGISTRY_PROXY-([^}]*)\}\s*$/m);
  if (!m) {
    throw new Error(
      "config/image-versions.env nedeklaruje domov cache ve tvaru " +
        "`REGISTRY_PROXY=${REGISTRY_PROXY-<host>/}` — bez něj nemá prefix odkud vzniknout.",
    );
  }
  const domov = m[1];
  if (!domov || !domov.endsWith("/")) {
    throw new Error(`domov REGISTRY_PROXY='${domov}' musí být neprázdný prefix končící lomítkem.`);
  }
  return domov;
}

/**
 * Jaký prefix platí: výslovná deklarace operátora (včetně PRÁZDNÉ = vypnuto),
 * jinak domov. Nic jiného — ani uložená hodnota v .env.coolify, ani
 * REGISTRY_DOMAIN instance: prázdné `REGISTRY_PROXY=`, které tam nikdo nedeklaroval,
 * je zapomenutý stav, ne rozhodnutí.
 *
 * @param {{ deklarace?: { ma: boolean, hodnota?: string }, domov: string }} vstup
 * @returns {{ hodnota: string, zdroj: "deklarace" | "domov" }}
 */
export function rozlisRegistryProxy({ deklarace, domov }) {
  if (deklarace?.ma) {
    // Hodnota se čte tak, jak ji přečte `source` — odříznutí uvozovek by nechalo
    // escapy uvnitř (viz env-hodnota.odUvozovkuj: `AISHA_OPERATORS` dorazil do
    // Coolify jako `{\"email\":…}` a operátoři se nikdy neprovisionovali).
    const hodnota = odUvozovkuj(String(deklarace.hodnota ?? "").trim());
    if (hodnota && !hodnota.endsWith("/")) {
      throw new Error(`deklarované REGISTRY_PROXY='${hodnota}' nekončí lomítkem — je to prefix obrazu.`);
    }
    return { hodnota, zdroj: "deklarace" };
  }
  return { hodnota: domov, zdroj: "domov" };
}
