/**
 * Brána: veřejný UDP port je RUČNÍ DEKLARACE instance — žádný literál, žádný default
 *
 * ⛔ ROZHODNUTÍ MAJITELE 2026-09-15, NAMĚŘENÉ DŘÍV NEŽ ROZHODNUTÉ.
 * Na sdíleném serveru má každá instance jiný veřejný UDP port a forward na
 * firewallu nastavuje člověk. Literál `18181` (dveře), `7882` (LiveKit RTC)
 * a `3478`/`5349` (TURN) byl přitom na ČTYŘECH místech najednou: compose
 * default, env-doktor, deploy-init a knock-provision. Každé z nich tiše vyrábělo
 * nárok na port, o který se dvě instance téhož serveru přetahují — 2026-08-12
 * livekit o 3478/5349 závod prohrál a instance ho musela vyřadit z manifestu.
 * Operátor pak 2026-09-15 přesunul dveře na 18190 a deklaraci
 * v `.env-prod-backup` žádný běh nedoručil, protože literál vyhrával.
 *
 * CO SE MĚŘÍ (vlastnost nad všemi `docker-compose.coolify*.yml`, ne výčet):
 *   1. každý publikovaný UDP port má hostitelskou stranu z POVINNÉ proměnné
 *      bez výchozí hodnoty: `${X:?…}`; u služby ZA PROFILEM `${X?…}` —
 *      compose interpoluje i službu za vypnutým profilem (naměřeno níž), takže
 *      `:?` by shodilo každou instanci, která profil nezapíná;
 *   2. klíč má v env-doktoru zapisovatele BEZ literálu (prázdný pevný klíč —
 *      přítomnost pro compose, hodnota z deklarace operátora);
 *   3. prázdná hodnota u služby za profilem je hlasitá: u dveří ji hlásí
 *      lib/dvere-soulad.mjs (s prázdnou by Docker publikoval NÁHODNÝ port —
 *      `docker compose config` s `PORT_X=` a zapnutým profilem vydá mapování
 *      bez `published`, naměřeno 2026-09-15, Compose v5.4.0);
 *   4. nástroje dveří literál portu nenesou (deploy-init, provision, klepátko).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { vadyDveri } from "../../../scripts/lib/dvere-soulad.mjs";

const ROOT = resolve(__dirname, "../../..");

type Sluzba = { ports?: unknown[]; profiles?: string[] };

/** Publikované UDP porty: soubor, služba, hostitelská strana, je-li služba za profilem. */
function udpPorty() {
  const out: { soubor: string; sluzba: string; host: string; zaProfilem: boolean }[] = [];
  for (const soubor of readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f)).sort()) {
    const dok = parseYaml(readFileSync(join(ROOT, soubor), "utf8"), { merge: true }) as { services?: Record<string, Sluzba> };
    for (const [sluzba, s] of Object.entries(dok?.services ?? {})) {
      for (const p of s?.ports ?? []) {
        if (typeof p === "string") {
          if (!/\/udp$/.test(p)) continue;
          // `[ip:]host:container/udp` — hostitel je vše před posledním `:` (proměnná
          // může dvojtečku nést uvnitř `${…:?…}`, proto se dělí za uzavřenou závorkou).
          const bezProto = p.replace(/\/udp$/, "");
          const m = /^(.*):([^:}]+)$/.exec(bezProto);
          out.push({ soubor, sluzba, host: m ? m[1] : "", zaProfilem: Array.isArray(s.profiles) && s.profiles.length > 0 });
        } else if (p && typeof p === "object" && (p as { protocol?: string }).protocol === "udp") {
          out.push({ soubor, sluzba, host: String((p as { published?: unknown }).published ?? ""), zaProfilem: Array.isArray(s.profiles) && s.profiles.length > 0 });
        }
      }
    }
  }
  return out;
}

const KONTRAKT = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf8");

/**
 * Známý dluh — smí jen ubývat. ROZSAH relay portů coturnu je táž třída (sdílený
 * server, dva coturny se na něm srazí), ale hostitelský rozsah musí mít TUTÉŽ
 * délku jako rozsah v `coolify/coturn.conf` — deklarace by tedy musela nést
 * i konfiguraci coturnu, jinak compose odmítne `invalid ranges` (změřeno
 * 2026-09-15). To je samostatná změna, ne přejmenování literálu.
 */
const ROZSAH_DLUH = ["docker-compose.coolify-livekit.yml:coturn:TURN_RELAY_PORTS"];

describe("veřejný UDP port je ruční deklarace instance", () => {
  const porty = udpPorty();

  test("univerzum není prázdné — dveře, RTC i TURN publikují UDP", () => {
    const sluzby = new Set(porty.map((p) => p.sluzba));
    // Dveře publikuje DRŽITEL netns (svc-knock v něm jen naslouchá).
    for (const s of ["svc-knock-netns", "livekit", "coturn"]) {
      expect(sluzby.has(s), `${s} nepublikuje UDP — detekce oslepla`).toBe(true);
    }
  });

  test("hostitelská strana je povinná proměnná bez výchozí hodnoty", () => {
    const vady: string[] = [];
    const dluhNalezen: string[] = [];
    for (const p of porty) {
      const dluh = ROZSAH_DLUH.find((d) => d.startsWith(`${p.soubor}:${p.sluzba}:`) && p.host.includes(`\${${d.split(":")[2]}`));
      if (dluh) { dluhNalezen.push(dluh); continue; }
      const m = /^\$\{([A-Z][A-Z0-9_]*)(:?\?)[^}]*\}$/.exec(p.host);
      if (!m) {
        vady.push(`${p.soubor}:${p.sluzba} → "${p.host}" (literál nebo default)`);
        continue;
      }
      const cekanyTvar = p.zaProfilem ? "?" : ":?";
      if (m[2] !== cekanyTvar) {
        vady.push(
          `${p.soubor}:${p.sluzba} → ${m[1]} nese "${m[2]}", čeká se "${cekanyTvar}" ` +
            (p.zaProfilem ? "(služba za profilem — `:?` shodí instanci bez profilu)" : "(bez profilu smí být jen neprázdná)"),
        );
      }
    }
    expect(
      vady,
      [
        "Publikovaný UDP port s literálem nebo výchozí hodnotou:",
        ...vady.map((v) => `  - ${v}`),
        "",
        "Port na sdíleném serveru je ROZHODNUTÍ operátora (forward na firewallu), ne vlastnost kódu.",
        "Deklaruj ho v .env-prod-backup; compose ho nese jako ${X:?…} (za profilem ${X?…}).",
      ].join("\n"),
    ).toEqual([]);
    expect(dluhNalezen.sort(), "dluh opravený (nebo zmizelý) se z ROZSAH_DLUH SMAŽE").toEqual([...ROZSAH_DLUH].sort());
  });

  test("každý takový klíč má v env-doktoru zapisovatele BEZ literálu", () => {
    const klice = [...new Set(porty.map((p) => /^\$\{([A-Z][A-Z0-9_]*)/.exec(p.host)?.[1]).filter(Boolean))]
      .filter((k) => !ROZSAH_DLUH.some((d) => d.endsWith(`:${k}`))) as string[];
    expect(klice.length).toBeGreaterThan(2);
    for (const k of klice) {
      const zaznam = new RegExp(`\\["${k}",\\s*"([a-z-]+)"(?:,\\s*([^\\]]*))?\\]`).exec(KONTRAKT);
      expect(zaznam, `${k} nemá zápis v kontraktu env-doktoru — do .env.coolify ho nikdo nezapíše a compose spadne`).toBeTruthy();
      expect(zaznam![1], `${k}: druh kontraktu musí klíč ZAPSAT i prázdný (external prázdno nezapíše)`).toBe("static");
      expect((zaznam![2] ?? "").trim(), `${k}: kontrakt nese literál portu — tichý nárok na port jiné instance`).toBe('""');
    }
  });

  test("prázdný port u DEKLAROVANÝCH dveří je hlasitá vada, u nedeklarovaných ne", () => {
    const cti = (o: Record<string, string>) => (k: string) => o[k];
    const zaklad = {
      EDGE_COMPOSE_PROFILES: "knock", SPA_DIAGNOSE: "0", SPA_OPERATORS_B64: "e30=",
      APP_NAME_PREFIX: "zkusebni", KNOCK_UPSTREAM: "http://zkusebni-svc-knock:3017",
    };
    expect(vadyDveri(cti({ ...zaklad, SPA_KNOCK_PUBLIC_PORT: "" })).vady.join(" ")).toMatch(/náhodný port/);
    expect(vadyDveri(cti({ ...zaklad, SPA_KNOCK_PUBLIC_PORT: "18190" })).vady).toEqual([]);
    expect(vadyDveri(cti({ SPA_KNOCK_PUBLIC_PORT: "" })).vady).toEqual([]);
    // Ozvěna starého literálu: stanoviště má port, operátor ho nedeklaroval.
    const operator = cti({});
    expect(vadyDveri(cti({ ...zaklad, SPA_KNOCK_PUBLIC_PORT: "18181" }), { operator }).vady.join(" ")).toMatch(/ozvěna/);
    expect(
      vadyDveri(cti({ ...zaklad, SPA_KNOCK_PUBLIC_PORT: "18181" }), { operator: cti({ SPA_KNOCK_PUBLIC_PORT: "18190" }) }).vady.join(" "),
    ).toMatch(/liší od deklarace/);
  });

  test("nástroje dveří literál veřejného portu nenesou", () => {
    const vady: string[] = [];
    for (const f of ["scripts/coolify-deploy-init.sh", "scripts/knock-provision.mjs", "scripts/knock.mjs"]) {
      const radky = readFileSync(join(ROOT, f), "utf8").split("\n");
      radky.forEach((r, i) => {
        if (/^\s*(#|\*|\/\/)/.test(r)) return;
        if (/\b18181\b/.test(r)) vady.push(`${f}:${i + 1}: ${r.trim()}`);
      });
    }
    expect(vady, "literál veřejného portu dveří — port je ruční deklarace instance").toEqual([]);
  });
});
