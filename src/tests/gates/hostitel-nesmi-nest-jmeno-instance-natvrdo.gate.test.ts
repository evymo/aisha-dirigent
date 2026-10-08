/**
 * Brána: jméno kontejneru v ADRESE se skládá z `${APP_NAME_PREFIX}`, nikdy natvrdo.
 *
 * ⛔ NAMĚŘENO 2026-08-19 — majitel poslal log nocodb z instance `riq`:
 *
 *     EXCEPTION in PGClient @ createDatabaseIfNotExists
 *     getaddrinfo EAI_AGAIN aisha-db
 *
 * `docker-compose.coolify-admin.yml` mělo `NC_DB=pg://aisha-db:5432`, zatímco
 * VŠECHNA ostatní jména v témž souboru používají
 * `${APP_NAME_PREFIX:?identita instance}`. Jeden řádek konvenci minul — a na
 * instanci `riq` ten hostitel prostě neexistuje.
 *
 * ROZSAH BYL VĚTŠÍ, NEŽ VYPADAL: sweep našel 50 výskytů v 9 compose souborech
 * (langfuse, llm-gateway, matrix, openclaw, realtime, ai-chat, cosmos,
 * prebuilt, admin). Vysvětlilo to většinu pádů toho dne, které jsem předtím
 * mylně odepsal jako „souběh Coolify" nebo „chyba služby" — např.
 * `llm-gateway-db-init didn't complete successfully: exit 1` byl ve
 * skutečnosti `pg_isready -h aisha-db`, který 300 s čekal na neexistující
 * jméno a vzdal to.
 *
 * PROČ TO NEJDE POZNAT ZE JMÉNA
 * Nejde o řetězec „aisha" — ten je v repu legitimně na desítkách míst (buckety
 * `aisha-loki-chunks`, ES index `aisha-kb`, realm `keycloak/aisha-realm.json`,
 * npm scope `@aisha/`). Vada je VLASTNOST: literál v pozici HOSTITELE, který
 * pojmenovává NAŠI službu. Brána proto univerzum ODVOZUJE z `container_name`
 * napříč compose soubory — nová služba je pod ní bez zásahu a přejmenování
 * bucketu ji nezajímá.
 *
 * ⚠️ Instance sdílejí jeden Coolify a jednu docker síť. Natvrdo zapsané jméno
 * proto není jen „nefunguje" — na hostiteli, kde běží víc instancí, může
 * ukázat na CIZÍ kontejner. Tichý únik dat místo hlasitého DNS selhání.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");

function souboryVGitu(vzor: RegExp): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter((p) => vzor.test(p));
}

/**
 * Jména NAŠICH služeb — ODVOZENÁ z `container_name: ${APP_NAME_PREFIX…}-<svc>`.
 * Tohle je zdroj pravdy o tom, jaké kontejnery vůbec vyrábíme.
 */
function jmenaSluzeb(): Set<string> {
  const jmena = new Set<string>();
  for (const soubor of souboryVGitu(/docker-compose.*coolify.*\.ya?ml$/)) {
    const obsah = readFileSync(join(ROOT, soubor), "utf8");
    for (const m of obsah.matchAll(/container_name:\s*\$\{APP_NAME_PREFIX[^}]*\}-([a-z0-9-]+)/g)) {
      jmena.add(m[1]);
    }
  }
  return jmena;
}

/**
 * Instanční prefixy DEKLAROVANÉ v repu (`APP_NAME_PREFIX=` / `:-`).
 *
 * ⛔ BEZ TOHOHO ZÚŽENÍ brána hlásila falešné nálezy: `llm-gateway`,
 * `svc-local-ingest` a `langfuse-web` vypadají jako `<prefix>-<služba>`, ale
 * `llm`, `svc` ani `langfuse` nejsou instance — je to skutečné jméno té služby.
 * Vada je jen tehdy, když prefix je INSTANCE. Množina se ODVOZUJE, takže nová
 * instance je pod bránou bez zásahu.
 */
function instancniPrefixy(): Set<string> {
  const prefixy = new Set<string>();
  for (const soubor of souboryVGitu(/\.(env|example|mjs|sh|ya?ml)$/)) {
    let obsah: string;
    try { obsah = readFileSync(join(ROOT, soubor), "utf8"); } catch { continue; }
    for (const m of obsah.matchAll(/APP_NAME_PREFIX(?:=|:-)([a-z][a-z0-9-]*)/g)) prefixy.add(m[1]);
  }
  return prefixy;
}

/**
 * Pozice, kde řetězec znamená HOSTITELE. Mimo ně je `neco-db` jen text
 * (jméno bucketu, indexu, souboru) a bráně do toho nic není.
 */
const POZICE_HOSTITELE: { re: RegExp; popis: string }[] = [
  { re: /(?:^|[\s"'=(])(?:https?|pg|postgres|postgresql|redis|amqp|ws|wss):\/\/(?:[^@\s/"']*@)?([a-z][a-z0-9]*-[a-z0-9-]+)/g, popis: "adresa se schématem" },
  { re: /@([a-z][a-z0-9]*-[a-z0-9-]+):\d/g, popis: "hostitel v pověření@host:port" },
  { re: /-h\s+([a-z][a-z0-9]*-[a-z0-9-]+)\b/g, popis: "přepínač -h (psql/pg_isready)" },
  { re: /getent\s+hosts\s+([a-z][a-z0-9]*-[a-z0-9-]+)/g, popis: "getent hosts" },
];

interface Nalez { soubor: string; radek: number; host: string; popis: string; text: string }

function najdiNatvrdoHostitele(sluzby: Set<string>, prefixy: Set<string>): Nalez[] {
  const nalezy: Nalez[] = [];
  const soubory = souboryVGitu(/\.(ya?ml|sh|mjs|js|ts|json|env|conf)$/)
    .filter((p) => !p.startsWith("src/tests/") && !p.includes("/__tests__/"));

  for (const soubor of soubory) {
    let obsah: string;
    try { obsah = readFileSync(join(ROOT, soubor), "utf8"); } catch { continue; }
    if (!obsah.includes("-")) continue;

    obsah.split("\n").forEach((radek, i) => {
      // Komentář = dokumentace, ne adresa. Ale POZOR: uvnitř shellového
      // block-scalaru je `#` součást HODNOTY, kterou compose interpoluje —
      // proto se přeskakují jen řádky, kde komentář začíná na začátku.
      if (/^\s*(#|\/\/|--)/.test(radek)) return;
      // `${…}` na řádku znamená, že jméno se skládá — to je právě správně.
      const skladaSe = /\$\{APP_NAME_PREFIX/.test(radek);
      for (const { re, popis } of POZICE_HOSTITELE) {
        re.lastIndex = 0;
        for (const m of radek.matchAll(re)) {
          const host = m[1];
          // Prefix musí být DEKLAROVANÁ instance a zbytek NAŠE služba —
          // teprve obojí naráz je vada, ne pouhá pomlčka ve jméně.
          const prefix = [...prefixy].find((p) => host.startsWith(`${p}-`));
          if (!prefix) continue;
          if (!sluzby.has(host.slice(prefix.length + 1))) continue;
          if (skladaSe) continue;
          nalezy.push({ soubor, radek: i + 1, host, popis, text: radek.trim().slice(0, 100) });
        }
      }
    });
  }
  return nalezy;
}

describe("hostitel v adrese nesmí nést jméno instance natvrdo", () => {
  it("žádná adresa nepojmenovává náš kontejner literálem", () => {
    const sluzby = jmenaSluzeb();

    // Sonda musí doložit, že měřila — bez univerza je verdikt bezcenný.
    expect(
      sluzby.size,
      "z compose se nepodařilo odvodit ani jedno jméno služby (container_name) — brána by měřila prázdno",
    ).toBeGreaterThan(20);

    const prefixy = instancniPrefixy();
    expect(
      prefixy.size,
      "v repu není deklarovaný ani jeden APP_NAME_PREFIX — brána by měřila prázdno",
    ).toBeGreaterThan(0);

    const nalezy = najdiNatvrdoHostitele(sluzby, prefixy);

    // ⚠️ RATCHET, ne amnestie. Compose a bridge configy jsou opravené (60 výskytů).
    // Zbytek žije v KÓDU SLUŽEB jako tichý fallback:
    //     process.env.KEYCLOAK_INTERNAL_URL ?? 'http://aisha-keycloak:80'
    // To je dvojí vada — natvrdo jméno A tichý default. Správná oprava NENÍ
    // přejmenovat fallback na `<fork>-`, ale fallback ZRUŠIT (chybí-li proměnná,
    // služba má spadnout): na sdíleném hostiteli může `aisha-keycloak` být
    // SKUTEČNÝ cizí kontejner a naše služba by ověřovala tokeny proti cizí
    // identitě. Zásah do 8 služeb + jejich testů — vlastní úkol.
    // Seznam se smí jen ZKRACOVAT; cokoli mimo něj bránu shodí.
    const ZNAMY_DLUH = new Map<string, number>([
      // config/local-presets.mjs: 2026-08-21 10 → 2, 2026-10-08 2 → 0 (AISHA_DB_URL
      // a N8N_DB_HOST se skládají z `${INSTANCE_PREFIX}-db`) — splaceno, ze seznamu pryč.
      ["packages/cache-redis/src/client.ts", 2],
      ["scripts/lib/local-env-assertions.test.mjs", 5],
      ["services/svc-ai-chat/src/tests/config-kc-issuer.unit.test.ts", 3],
      ["services/svc-fio-bank/src/tests/config-kc-issuer.unit.test.ts", 3],
      ["services/svc-pki-bridge/src/tests/auth-bootstrap.unit.test.ts", 1],
      ["services/svc-pki-bridge/src/tests/auth.unit.test.ts", 1],
    ]);
    const poSouborech = new Map<string, number>();
    for (const n of nalezy) poSouborech.set(n.soubor, (poSouborech.get(n.soubor) ?? 0) + 1);

    // Ratchet nesmí zrezivět: co se opravilo, musí ze seznamu zmizet.
    const zbytecne = [...ZNAMY_DLUH].filter(([f, n]) => (poSouborech.get(f) ?? 0) < n)
      .map(([f, n]) => `${f} (čekáno ${n}, nalezeno ${poSouborech.get(f) ?? 0})`);
    expect(
      zbytecne,
      "Tady se dluh SNÍŽIL — sniž i číslo v ZNAMY_DLUH, jinak ratchet kryje regresi.\n  " +
        zbytecne.join("\n  "),
    ).toEqual([]);

    expect(
      nalezy
        .filter((n) => (poSouborech.get(n.soubor) ?? 0) > (ZNAMY_DLUH.get(n.soubor) ?? 0))
        .map((n) => `${n.soubor}:${n.radek}  ${n.host}  (${n.popis})\n      ${n.text}`),
      "Adresa s natvrdo zapsaným jménem instance na JINÉ instanci neexistuje —\n" +
        "`getaddrinfo EAI_AGAIN aisha-db` (naměřeno 2026-08-19 na nocodb v instanci riq).\n" +
        "Init kontejnery na to čekají 300 s a pak celé nasazení padne, což vypadá\n" +
        "jako chyba služby a diagnóza jde úplně jinam.\n" +
        "⚠️ Na hostiteli s více instancemi je to HORŠÍ než pád: jméno může ukázat\n" +
        "na CIZÍ kontejner — tichý únik místo hlasitého selhání.\n" +
        "Náprava: `${APP_NAME_PREFIX:?identita instance}-<služba>`, stejně jako\n" +
        "to dělá `container_name` o pár řádků výš.\n  ",
    ).toEqual([]);
  });

  it("univerzum obsahuje služby, na kterých ta vada doopravdy vznikla", () => {
    // ⛔ Kotva: kdyby se derivace `container_name` rozbila, horní test by
    // zezelenal nad prázdnou množinou. Tyhle tři figurovaly v naměřených
    // pádech (nocodb→db, llm-gateway-db-init→db, realtime→shared-redis),
    // takže jejich zmizení z univerza znamená rozbité měřidlo, ne opravu.
    const sluzby = jmenaSluzeb();
    for (const s of ["db", "shared-redis", "postgrest"]) {
      expect(sluzby.has(s), `${s} zmizelo z odvozeného univerza — derivace container_name je rozbitá`).toBe(true);
    }
  });
});
