/**
 * Disková brána — před KAŽDÝM triggerem změří volné místo na uzlu, kam
 * nasazení poběží, a když nestačí, zastaví běh DŘÍV, než se cokoli zařadí.
 *
 * ⛔ NAMĚŘENO 2026-09-24 (fork, sdílený hostitel pěti nájemníků). Osm souběžných
 * nasazení vyčerpalo disk na 100 % (ENOSPC). Pád se neprojevil u nasazení,
 * které disk dojedlo, ale kaskádou u všeho, co zrovna zapisovalo — databáze,
 * logy, pomocné kontejnery. Příčina (nedostatek místa) byla vidět předem;
 * nikdo se nezeptal.
 *
 * KTERÝ STROJ: ten, který o nasazení rozhoduje — Coolify vrací u aplikace
 * `destination.server.name`. Ne náš slot (frontend/backend/…) ani jméno
 * z profilu: měřidlo musí mít totéž univerzum jako verdikt, a verdikt o disku
 * padne tam, kam Coolify nasazení skutečně pošle.
 *
 * KANÁL: SSH cíl uzlu DEKLARUJE trezor (`AISHA_NODE_SSH`, mapa
 * `JménoServeruVCoolify=ssh-cíl[,…]`). Nehádá se. Příkaz přes SSH jen ČTE
 * (docker info, df, docker ps/inspect, docker system df) — nic nezapisuje.
 *
 *   nedeklarováno      → „disk nezměřen", nasazení pokračuje, souhrn to vykáže
 *                        jako NEZMĚŘENO (ne jako čisto).
 *   deklarováno, ale měření selže → STOP. Operátor slíbil, že uzel hlídat
 *                        jde; tichý průchod by z brány udělal ozdobu. Chce-li
 *                        jet bez měření, odebere záznam z mapy — vědomě.
 *   nedostatek místa   → STOP s čísly, žádný POST /deploy, nečeká se.
 *
 * PROČ UNIQUE, NE `.Size` (naměřeno 2026-09-25 na hostiteli forku, Docker
 * 29.7.2 s containerd snapshotterem): `docker image inspect .Size` tam vrací
 * KOMPRIMOVANOU velikost — oauth2-proxy 19,7 MB, na disku 61,1 MB (3,1×).
 * Součet `.Size` by navíc počítal sdílené vrstvy vícekrát. Brána proto bere
 * UNIQUE SIZE z `docker system df -v`: co obraz na disku zabírá sám za sebe.
 */

import { jeJmenoSluzby, jeReferenceObrazu } from "./obrazy-stacku.mjs";

/**
 * Rezerva nad potřebu obrazů.
 *
 * Nasazení nezapisuje jen obrazy: build cache, logy startujících kontejnerů,
 * zápisy databází, které během přenasazení běží dál, a pomocný kontejner
 * Coolify. Bez rezervy by brána pustila nasazení, které skončí na 99,9 %
 * — tedy v tomtéž ENOSPC, jen o minutu později. 2 GiB je řádově víc než
 * jednorázové zápisy mimo obrazy a řádově méně, než kolik volna mají
 * provozované uzly, takže brána nezastaví zdravý uzel kvůli rezervě samotné.
 * (Čísla z měření na reálném stacku: popis PR fáze D.)
 */
export const REZERVA_B = 2 * 1024 ** 3;

const GIB = 1024 ** 3;
export const gib = (b) => `${(b / GIB).toFixed(1)} GiB`;

/**
 * Mapa uzel → SSH cíl z `AISHA_NODE_SSH`.
 *
 * Neplatný záznam je CHYBA, ne přeskočení: tiše zahozený záznam by uzel
 * přesunul do „nedeklarováno" a brána by na něm nic neměřila.
 */
export function nactiMapuUzlu(text) {
  const mapa = new Map();
  const hodnota = String(text ?? "").trim();
  if (!hodnota) return mapa;
  for (const zaznam of hodnota.split(",")) {
    const z = zaznam.trim();
    if (!z) continue;
    const m = z.match(/^([^=\s]+)=([^\s=,;|&`$<>()'"\\]+)$/);
    if (!m) {
      throw new Error(
        `AISHA_NODE_SSH: neplatný záznam "${z}" — čekám JménoServeruVCoolify=ssh-cíl ` +
          `(např. uzel1=deploy@uzel1.example), záznamy oddělené čárkou`,
      );
    }
    if (mapa.has(m[1])) throw new Error(`AISHA_NODE_SSH: uzel "${m[1]}" je v mapě dvakrát`);
    mapa.set(m[1], m[2]);
  }
  return mapa;
}

/** uuid aplikace z Coolify jde do vzdáleného příkazu — jen bezpečný tvar. */
const BEZPECNE_UUID = /^[a-z0-9]{8,64}$/;

/**
 * Vzdálený příkaz, JEN ČTENÍ. `projekty` = uuid aplikací (Coolify pojmenuje
 * compose projekt aplikace jejím uuid — ověřeno v logu nasazení:
 * `docker compose … --project-name <uuid>`).
 *
 * ⛔ STACK BEZ KONTEJNERŮ (naměřeno 2026-09-25 na hostiteli forku): po selhaném
 * nasazení Coolify staré kontejnery odstraní a nové nespustí — pět stacků tak
 * nemělo ANI JEDEN kontejner a brána by pro ně viděla jen rezervu, tedy nejméně
 * přesně právě tam, kde se nasazuje znovu. Pak se sjednotí (a) obrazy, které
 * Coolify pro tu aplikaci postavil (jméno `<uuid>_<služba>:<commit>`), a (b)
 * obrazy, které si stack STÁHNE — `image:` z jeho compose (lib/obrazy-stacku.mjs).
 * Co z toho na uzlu není, se změřit nedá: příkaz to vypíše jako `CHYBI <uuid> <obraz>`
 * — stažený obraz, který chybí, i službu se `build:`, pro kterou Coolify na uzlu
 * žádný `<uuid>_<služba>` nemá — a volající pak hlásí NEZMĚŘENO.
 *
 * @param {string[]} projekty uuid aplikací
 * @param {Map<string, string[]>} [stazene] uuid → `image:` reference stacku
 * @param {Map<string, string[]>} [stavene] uuid → služby stacku se `build:`
 */
export function prikazMereni(projekty, stazene = new Map(), stavene = new Map()) {
  for (const p of projekty) {
    if (!BEZPECNE_UUID.test(p)) throw new Error(`diskova-brana: uuid aplikace "${p}" nemá očekávaný tvar`);
    for (const ref of stazene.get(p) ?? []) {
      if (!jeReferenceObrazu(ref)) throw new Error(`diskova-brana: reference obrazu "${ref}" nemá bezpečný tvar`);
    }
    for (const sluzba of stavene.get(p) ?? []) {
      if (!jeJmenoSluzby(sluzba)) throw new Error(`diskova-brana: jméno služby "${sluzba}" nemá bezpečný tvar`);
    }
  }
  const vetev = (p) => {
    const zCompose = (stazene.get(p) ?? [])
      .map((r) => ` docker image inspect -f "OBRAZ ${p} {{.Id}}" '${r}' 2>/dev/null || echo "CHYBI ${p} ${r}";`)
      .join("");
    const zeStaveb = (stavene.get(p) ?? [])
      .map((s) => ` [ -n "$(docker image ls -q --filter "reference=${p}_${s}")" ] || echo "CHYBI ${p} ${p}_${s}";`)
      .join("");
    return (
      `c=$(docker ps -aq --filter "label=com.docker.compose.project=${p}"); ` +
      `if [ -n "$c" ]; then echo "$c" | xargs docker inspect -f "OBRAZ ${p} {{.Image}}"; ` +
      `else docker image ls -q --no-trunc --filter "reference=${p}_*" | sed "s/^/OBRAZ ${p} /";${zCompose}${zeStaveb} fi; `
    );
  };
  const smycka = projekty.map(vetev).join("");
  return [
    "set -e",
    `R=$(docker info -f '{{.DockerRootDir}}')`,
    `df -Pk "$R" | awk 'NR==2 {print "VOLNO_KB " $4}'`,
    `${smycka}echo DF_V`,
    "docker system df -v",
  ].join("; ");
}

const JEDNOTKY = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };

/**
 * Velikost tak, jak ji tiskne docker (`units.HumanSize`: desítková, „1.23GB").
 * Čte i znaménko a vědecký zápis — Docker 29 s containerd snapshotterem umí
 * vytisknout UNIQUE SIZE jako `-1.141e+08B` (viz unikatniVelikostiObrazu).
 */
export function bajty(text) {
  const m = String(text ?? "").trim().match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([kKmMgGtT]?B)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const k = JEDNOTKY[m[2].toLowerCase()];
  return Number.isFinite(n) && k ? Math.round(n * k) : null;
}

/**
 * Tabulka „Images space usage" z `docker system df -v` → Map(krátké ID → unikátní B).
 *
 * Sloupce se čtou podle POZIC HLAVIČKY: tabwriter zarovnává řádky pod ni,
 * a CREATED obsahuje mezery („2 weeks ago"), takže dělení podle mezer by
 * sloupce posunulo.
 *
 * ⛔ ZÁPORNÁ UNIQUE (naměřeno 2026-09-25 na hostiteli forku, 1 obraz ze 105):
 * `SIZE 123MB · SHARED SIZE 237.5MB · UNIQUE SIZE -1.141e+08B`. Účetnictví
 * containerd snapshotteru tu sdílené vrstvy přepočítá a unikátní vyjde pod nulou.
 * Takový údaj se nepoužije; místo něj se vezme SIZE — horní odhad, protože
 * brána se smí mýlit jen na stranu opatrnosti. (Dřív se obraz tiše vynechal
 * a brána pak na deklarovaném uzlu hlásila falešný STOP „obraz chybí".)
 */
export function unikatniVelikostiObrazu(dfV) {
  const radky = String(dfV ?? "").split(/\r?\n/);
  const i = radky.findIndex((r) => /^REPOSITORY\s/.test(r) && r.includes("UNIQUE SIZE"));
  if (i < 0) return null;
  const hlavicka = radky[i];
  // `SIZE` je první výskyt — před `SHARED SIZE` i `UNIQUE SIZE`.
  const sloupce = ["IMAGE ID", "CREATED", "SIZE", "SHARED SIZE", "UNIQUE SIZE", "CONTAINERS"].map((s) => hlavicka.indexOf(s));
  if (sloupce.some((x) => x < 0)) return null;
  const [id0, id1, s0, s1, u0, u1] = sloupce;
  const mapa = new Map();
  for (const r of radky.slice(i + 1)) {
    if (!r.trim()) break;
    const id = r.slice(id0, id1).trim();
    const unikatni = bajty(r.slice(u0, u1));
    const celkem = bajty(r.slice(s0, s1));
    const hodnota = unikatni !== null && unikatni >= 0 ? unikatni : celkem;
    if (id && hodnota !== null) mapa.set(id, hodnota);
  }
  return mapa;
}

/**
 * Výstup `prikazMereni` → { volnoB, potreba: Map(projekt → unikátní B obrazů),
 * nalezeno: Map(projekt → počet různých obrazů), chybi: Map(projekt → obrazy,
 * které stack deklaruje, ale na uzlu nejsou) }.
 * Nečitelný výstup = chyba (volající z ní udělá STOP; viz hlavička).
 */
export function parsujMereni(vystup, projekty) {
  const text = String(vystup ?? "");
  const volno = text.match(/^VOLNO_KB (\d+)$/m);
  if (!volno) throw new Error("měření neobsahuje volné místo (df)");
  const [, dfCast = ""] = text.split(/^DF_V$/m);
  const unikatni = unikatniVelikostiObrazu(dfCast);
  if (!unikatni) throw new Error("měření neobsahuje tabulku obrazů z `docker system df -v`");
  const potreba = new Map(projekty.map((p) => [p, 0]));
  const nalezeno = new Map(projekty.map((p) => [p, 0]));
  const nenalezeno = [];
  const videno = new Set();
  for (const [, projekt, obraz] of text.matchAll(/^OBRAZ (\S+) (\S+)$/gm)) {
    if (!potreba.has(projekt)) continue;
    const kratke = obraz.replace(/^sha256:/, "").slice(0, 12);
    // Dva kontejnery téhož obrazu (nebo obraz nalezený prefixem i z compose)
    // = jeden obraz na disku.
    const klic = `${projekt}:${kratke}`;
    if (videno.has(klic)) continue;
    videno.add(klic);
    if (!unikatni.has(kratke)) {
      nenalezeno.push(kratke);
      continue;
    }
    potreba.set(projekt, potreba.get(projekt) + unikatni.get(kratke));
    nalezeno.set(projekt, nalezeno.get(projekt) + 1);
  }
  if (nenalezeno.length) {
    throw new Error(`obrazy kontejnerů chybí v tabulce docker system df -v: ${nenalezeno.join(", ")}`);
  }
  const chybi = new Map(projekty.map((p) => [p, []]));
  for (const [, projekt, obraz] of text.matchAll(/^CHYBI (\S+) (\S+)$/gm)) {
    if (chybi.has(projekt) && !chybi.get(projekt).includes(obraz)) chybi.get(projekt).push(obraz);
  }
  return { volnoB: Number(volno[1]) * 1024, potreba, nalezeno, chybi };
}

/**
 * Brána pro `spustSOmezenim(..., { predSpustenim })`.
 *
 * @param {{ mapaUzlu: Map<string,string>,
 *           uzelAplikace: (jmeno: string) => string | null,
 *           uuidAplikace: (jmeno: string) => string | null,
 *           obrazyAplikace?: (jmeno: string) => string[],
 *           stavbyAplikace?: (jmeno: string) => string[],
 *           ssh: (cil: string, prikaz: string) => Promise<string>,
 *           rezervaB?: number }} o
 *   `obrazyAplikace` = `image:` reference stacku, `stavbyAplikace` = jeho služby
 *   se `build:` (obojí lib/obrazy-stacku.mjs) — měří se, jen když stack nemá kontejnery.
 * @returns {(jmeno: string, kontext: { vLetu: string[] }) => Promise<
 *   { ok: true, nezmereno?: { uzel: string, duvod: string }, cisla?: object } |
 *   { ok: false, duvod: string }>}
 */
export function vytvorDiskovouBranu({
  mapaUzlu,
  uzelAplikace,
  uuidAplikace,
  obrazyAplikace = () => [],
  stavbyAplikace = () => [],
  ssh,
  rezervaB = REZERVA_B,
}) {
  return async (jmeno, { vLetu = [] } = {}) => {
    const uzel = uzelAplikace(jmeno);
    if (!uzel) {
      return { ok: true, nezmereno: { uzel: "?", duvod: `Coolify u ${jmeno} neuvádí server (destination.server.name)` } };
    }
    const cil = mapaUzlu.get(uzel);
    if (!cil) {
      return { ok: true, nezmereno: { uzel, duvod: `uzel ${uzel} nemá v AISHA_NODE_SSH deklarovaný SSH cíl` } };
    }
    // S kým se o disk dělíme: nasazení v letu NA TÉMŽE UZLU.
    const soused = vLetu.filter((n) => n !== jmeno && uzelAplikace(n) === uzel);
    const jmena = [jmeno, ...soused];
    const projekty = jmena.map((n) => uuidAplikace(n));
    if (projekty.some((p) => !p)) {
      return { ok: false, duvod: `disková brána: nelze určit uuid aplikace pro ${jmena.join(", ")} — STOP` };
    }

    const stazene = new Map(jmena.map((n, i) => [projekty[i], obrazyAplikace(n) ?? []]));
    const stavene = new Map(jmena.map((n, i) => [projekty[i], stavbyAplikace(n) ?? []]));
    let mereni;
    let chyba = "";
    for (let pokus = 1; pokus <= 2 && !mereni; pokus++) {
      try {
        mereni = parsujMereni(await ssh(cil, prikazMereni(projekty, stazene, stavene)), projekty);
      } catch (e) {
        chyba = e?.message || String(e);
      }
    }
    if (!mereni) {
      return {
        ok: false,
        duvod:
          `disková brána: uzel ${uzel} (${cil}) je deklarovaný, ale měření selhalo: ${chyba} — STOP, nic se nespouští. ` +
          `Oprav SSH kanál, nebo záznam uzlu z AISHA_NODE_SSH vědomě odeber (pak poběží NEZMĚŘENO).`,
      };
    }

    const obrazy = mereni.potreba.get(projekty[0]);
    const obrazySousedu = projekty.slice(1).reduce((s, p) => s + mereni.potreba.get(p), 0);
    const potrebaB = obrazy + obrazySousedu + rezervaB;
    const chybi = mereni.chybi.get(projekty[0]);
    const chybiVLetu = projekty.slice(1).flatMap((p) => mereni.chybi.get(p));
    const cisla = {
      uzel, volnoB: mereni.volnoB, potrebaB, obrazyB: obrazy, obrazySousiduB: obrazySousedu, rezervaB,
      chybiObrazu: chybi.length, chybiObrazuVLetu: chybiVLetu.length,
    };
    // ⛔ NIC NENALEZENO NENÍ NULOVÁ POTŘEBA. Stack bez kontejnerů i bez obrazů
    // (první nasazení, nebo obrazy smazal úklid) si při nasazení všechno stáhne
    // a postaví — kolik, se z uzlu změřit nedá. Rezerva sama by prošla zeleně,
    // a to je přesně ten tichý průchod, kterému brána má bránit. Tvrdá hranice
    // zůstává: když nestačí ani na rezervu, je to STOP.
    const nicNenalezeno = mereni.nalezeno.get(projekty[0]) === 0;
    if (nicNenalezeno && mereni.volnoB >= potrebaB) {
      return {
        ok: true,
        cisla,
        nezmereno: {
          uzel,
          duvod: `stack ${jmeno} nemá na uzlu kontejnery ani známé obrazy (první nasazení, nebo je smazal úklid) — ` +
            `potřeba NEZMĚŘENA, volno ${gib(mereni.volnoB)} pokrývá jen rezervu ${gib(rezervaB)}`,
        },
      };
    }
    // ⛔ ČÁST NENÍ CELEK (naměřeno 2026-09-26, jádro forku po úklidu): 5 obrazů
    // ze 17 služeb → odhad 4,8 GiB, nasazení zabralo 7,2 GiB. Chybějící obrazy se
    // při nasazení stáhnou a postaví, jejich velikost uzel nezná — změřená část je
    // jen DOLNÍ mez. Zelená by tvrdila víc, než brána ví.
    if ((chybi.length || chybiVLetu.length) && mereni.volnoB >= potrebaB) {
      const ukazka = (seznam) => seznam.slice(0, 3).join(", ") + (seznam.length > 3 ? ` a ${seznam.length - 3} další` : "");
      const casti = [
        chybi.length ? `stacku ${jmeno} chybí na uzlu ${chybi.length} obrazů (${ukazka(chybi)})` : "",
        chybiVLetu.length ? `nasazením v letu ${soused.join(", ")} chybí ${chybiVLetu.length} (${ukazka(chybiVLetu)})` : "",
      ].filter(Boolean);
      return {
        ok: true,
        cisla,
        nezmereno: {
          uzel,
          duvod: `${casti.join("; ")} — potřeba NEZMĚŘENA; změřeno ${gib(obrazy + obrazySousedu)} + rezerva ` +
            `${gib(rezervaB)} je jen dolní mez, volno ${gib(mereni.volnoB)}`,
        },
      };
    }
    if (mereni.volnoB < potrebaB) {
      const sousede = soused.length ? ` + v letu ${soused.join(", ")} ${gib(obrazySousedu)}` : "";
      return {
        ok: false,
        duvod:
          `disková brána: uzel ${uzel} má volno ${gib(mereni.volnoB)} < potřeba ${gib(potrebaB)} ` +
          `(obrazy ${jmeno} ${gib(obrazy)} unikátně${sousede} + rezerva ${gib(rezervaB)}) — STOP, nic se nespouští`,
        cisla,
      };
    }
    return { ok: true, cisla };
  };
}
