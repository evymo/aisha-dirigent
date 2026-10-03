/**
 * env-hodnota.mjs — hodnota v env souboru musí PŘEŽÍT `source`.
 *
 * ⛔ NAMĚŘENO 2026-09-16 na dvou instancích. `.env.coolify` čte půl nasazovací
 * cesty shellem (`scripts/_env-loader.sh`, `aisha-cold-start.sh`,
 * `cold-start-doctor.sh`, `coolify-deploy-init.sh`) — a víceslovná hodnota bez
 * uvozovek se v `source` rozpadne:
 *   · instance A: `COSMOS_SIGNER_MNEMONIC=churn dish wagon …` → `dish: command
 *     not found`, syntaktická chyba o 77 řádků níž a `source` SKONČIL. Všechno
 *     za tím řádkem (včetně COOLIFY_SERVER_UUID_*) bylo pro skripty NEVIDITELNÉ;
 *     story-init pak neuměl založit aplikaci, protože „neznal server".
 *   · instance B: `source` doběhl, ale hodnoty se UŘÍZLY na první slovo —
 *     z tajemství zbylo jediné slovo a nikdo se nic nedozvěděl.
 * Loader přitom chybu polykal (`source … 2>/dev/null || true`), takže useknuté
 * prostředí vypadalo jako úspěch.
 *
 * Generátor (`generate-secrets.mjs`) uvozuje odjakživa. Neuvozoval heredoc
 * cold-startu a průchod klíčů z trezoru operátora — proto to nesmí být na
 * zapisovateli: hodnotu normalizuje env-doktor, kterým každý zápis prochází.
 */

/** Znaky, po kterých `source` hodnotu rozdělí nebo vykoná. */
const NEBEZPECNE = /[\s'"`$\\()|&;<>*?!#~\[\]{}]/;

/**
 * ⛔ DVOJITÉ UVOZOVKY, NE JEDNODUCHÉ — ten soubor čtou DVA PARSERY (změřeno
 * 2026-09-16 nad `docker compose --env-file` i `bash source`, hodnota
 * `{"$note":"a 'b' c"}`):
 *
 *   zápis                         bash      compose
 *   'jednoduché s '\''            OK        CHYBA (neplatné jméno proměnné)
 *   "dvojité se zpětnými lomítky"  OK        OK        ← jediný společný tvar
 *   bez uvozovek                   CHYBA     „OK", ale `$note` zmizel (compose
 *                                            v hodnotě dosazuje proměnné)
 *
 * Proto se uvozuje DVOJITĚ a escapuje `"`, `\`, `$` a zpětný apostrof: bash je
 * v uvozovkách odstraní, compose je čte jako doslovné znaky a nic nedosazuje.
 */
const ESCAPOVAT = /[\\"$`]/g;

/** Je hodnota už uvozená tak, že ji oba parsery přečtou doslova? */
export function jeUvozena(hodnota) {
  const h = String(hodnota ?? "");
  if (h.length < 2) return false;
  // ⛔ NAMĚŘENO 2026-09-21 (na forku při fast-forwardu z upstreamu): `odUvozovkuj` uměl '…' i "…", ale
  //    `jeUvozena` jen "…". Hodnota jako CLAMAV_MESH_TCP_ROUTES='3310|<fork>-clamav:3310'
  //    tedy vyšla jako „potřebuje uvozovky", `uvozovkuj` ji obalil dvojitými a
  //    APOSTROFY SE STALY SOUČÁSTÍ HODNOTY. Doktor to hlásil s návodem „apply je
  //    srovná" — a apply by tím poškodil 25 hodnot v trezoru. Hlášení o léku bylo
  //    součástí vady. Bash: v '…' je obsah doslova a apostrof uvnitř být nemůže.
  if (h.startsWith("'") && h.endsWith("'")) return !h.slice(1, -1).includes("'");
  if (!h.startsWith('"') || !h.endsWith('"')) return false;
  const vnitrek = h.slice(1, -1);
  // Uvnitř nesmí zůstat neescapovaný `"`, `$`, zpětný apostrof ani `\`.
  return !/(^|[^\\])(\\\\)*["$`]/.test(vnitrek) && !/\\(?![\\"$`])/.test(vnitrek);
}

/** Potřebuje hodnota uvozovky, aby přežila `source`? */
export function potrebujeUvozovky(hodnota) {
  const h = String(hodnota ?? "");
  if (h === "") return false;
  if (jeUvozena(h)) return false;
  return NEBEZPECNE.test(h);
}

/** Hodnota v tvaru, který `source` přečte doslova. */
export function uvozovkuj(hodnota) {
  const h = String(hodnota ?? "");
  if (h === "" || jeUvozena(h)) return h;
  if (!NEBEZPECNE.test(h)) return h;
  return `"${h.replace(ESCAPOVAT, (m) => `\\${m}`)}"`;
}

/**
 * Inverze `uvozovkuj` — skutečná hodnota tak, jak ji přečte `bash source`.
 *
 * ⛔ NAMĚŘENO 2026-09-19 (guru): env-doktor uvozoval `AISHA_OPERATORS` správně
 * (`"{\"email\":…}"`), `source` ho přečetl, ale coolify-sync-envs a
 * config-env-files.parseEnvFile uvozovky jen ODŘÍZLY a escapy nechaly — do Coolify
 * šlo `{\"email\":…}`, migrace hlásila „AISHA_OPERATORS is not valid JSON" a
 * operátoři se NIKDY neprovisionovali. Kdo soubor čte jinak než shellem, musí
 * hodnotu převést tímhle, ne odříznutím.
 *   "…"  → bez uvozovek, `\\` `\"` `\$` a `\`` → doslovný znak (jako bash);
 *   '…'  → bez uvozovek, obsah doslova;
 *   jinak beze změny.
 */
export function odUvozovkuj(hodnota) {
  const h = String(hodnota ?? "");
  if (h.length >= 2 && h.startsWith('"') && h.endsWith('"')) {
    return h.slice(1, -1).replace(/\\([\\"$`])/g, "$1");
  }
  if (h.length >= 2 && h.startsWith("'") && h.endsWith("'")) return h.slice(1, -1);
  return h;
}

/**
 * Srovná uvozování v CELÉM obsahu env souboru.
 * @returns {{ text: string, srovnane: string[] }}
 */
export function srovnejUvozovani(text) {
  const srovnane = [];
  const out = String(text).split("\n").map((radek) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(radek);
    if (!m) return radek;
    const [, klic, hodnota] = m;
    if (!potrebujeUvozovky(hodnota)) return radek;
    srovnane.push(klic);
    return `${klic}=${uvozovkuj(hodnota)}`;
  }).join("\n");
  return { text: out, srovnane };
}
