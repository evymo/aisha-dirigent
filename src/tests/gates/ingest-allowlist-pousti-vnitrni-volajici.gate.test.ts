/**
 * Brána: Host allowlist ingestu musí pouštět VNITŘNÍHO volajícího
 *
 * TŘÍDA VADY: hodnota, která EXISTUJE a je špatně. Od správné se nedá odlišit —
 * projeví se až jako odmítnutý request kdesi v běhu, a vypadá to jako vada klienta.
 *
 * ⛔ NAMĚŘENO 2026-08-29: `INGEST_ALLOWED_HOSTS` nesla jen veřejnou doménu, a ta je
 * `ingest-disabled.invalid` (ingest se ven nevystavuje). Host guard (ochrana proti
 * DNS rebindingu) tedy propouštěl jedině `Host: 127.0.0.1` — request zevnitř
 * vlastního kontejneru. Volání z brokeru přes mesh vracelo `421 Misdirected Request`:
 * jméno se přeložilo, TCP prošlo, token sedl, a zastavil to až Host header.
 *
 * Ingest přitom dva dny běžel zdravý s `documents: 0` a nikdo si toho nevšiml —
 * zdravá služba bez vstupu vypadá stejně jako zdravá služba bez práce.
 *
 * PROČ BRÁNA A NE JEN ŠABLONA: jako `["INGEST_ALLOWED_HOSTS", "template", …]` plnil
 * `aisha-env-doctor` klíč jen když CHYBĚL. Čistý cold start vyšel správně, ale
 * instance, která už nějakou hodnotu měla, zůstala na té staré navždy.
 *
 * ⛔ NAMĚŘENO ZNOVU 2026-09-14 na nasazeném forku — dva týdny po opravě šablony
 * nesl živý trezor pořád jen `ingest-disabled.invalid`. Oprava, která se dostane
 * jen k NOVÝM instancím, starou vadu neopraví. Klíč je proto `derived` (celý je
 * funkcí veřejné domény a identity) a doktor rozdíl srovná při každém běhu —
 * redeploy ho pouští před syncem. Druhý test níž to měří SPUŠTĚNÍM doktora nad
 * zastaralou hodnotou, ne čtením kontraktu.
 *
 * PRAVIDLO (majitel 2026-08-29): „allowlistovat automaticky během cold startu jen to,
 * co má smysluplné použití zevnitř." Vnitřní jméno služby TAM PATŘÍ — je to jediná
 * adresa, pod kterou ho volá broker. Veřejné vystavení JE samostatné rozhodnutí a
 * tahle brána ho nevyžaduje ani nezavádí.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";
import { envDoktorDokoncil } from "./_env-doktor-dokoncil";

const ROOT = process.cwd();
const ENV = join(ROOT, ".env.coolify");

/** Jedna hodnota z env souboru, bez uvozovek. `null` = klíč tam není. */
export function envHodnota(src: string, klic: string): string | null {
  const m = src.match(new RegExp(`^${klic}=(.*)$`, "m"));
  if (!m) return null;
  return m[1]!.trim().replace(/^["']|["']$/g, "");
}

/**
 * Server porovnává CELÝ Host header a lowercasuje ho
 * (`server.py`: `{h.strip().lower() for h in env.split(",")}`), takže se seznam
 * čte stejně — čárkou, trim, lowercase.
 */
export function polozky(hodnota: string): Set<string> {
  return new Set(
    hodnota
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Co MUSÍ seznam obsahovat, aby vnitřní volající prošel. Obě podoby: request nese
 * `host:port` u nestandardního portu, ale holé jméno je legitimní taky — a server
 * porovnává přesnou shodu, ne prefix.
 */
export function povinneVnitrni(prefix: string): string[] {
  return [`${prefix}-svc-local-ingest:8765`, `${prefix}-svc-local-ingest`];
}

describe("Host allowlist ingestu pouští vnitřního volajícího", () => {
  const src = existsSync(ENV) ? readFileSync(ENV, "utf8") : null;

  test("seznam obsahuje vnitřní jméno služby, odvozené z identity instance", () => {
    if (!src) {
      // `.env.coolify` je gitignorovaný — v CI právem chybí. Přiznat, ne mlčet.
      expect(true, "NEPROHLÉDNUTO — .env.coolify není k dispozici (v CI je to normální)").toBe(true);
      return;
    }
    const prefix = envHodnota(src, "APP_NAME_PREFIX");
    const hodnota = envHodnota(src, "INGEST_ALLOWED_HOSTS");
    if (!prefix || hodnota === null) {
      expect(true, "NEPROHLÉDNUTO — chybí APP_NAME_PREFIX nebo INGEST_ALLOWED_HOSTS").toBe(true);
      return;
    }

    const mam = polozky(hodnota);
    const chybi = povinneVnitrni(prefix).filter((h) => !mam.has(h));

    expect(
      chybi,
      "Ingest odmítne request, jehož Host není na allowlistu — vrátí 421 Misdirected\n" +
        "Request. Vypadá to jako vada volajícího, ale je to konfigurace: jméno se\n" +
        "přeloží, TCP projde, token sedí, a zastaví to až Host header.\n" +
        `Doplň do INGEST_ALLOWED_HOSTS: ${povinneVnitrni(prefix).join(", ")}\n` +
        `Teď tam je: ${[...mam].join(", ") || "(prázdné)"}`,
    ).toEqual([]);
  });

  test("veřejné vystavení zůstává samostatným rozhodnutím", () => {
    if (!src) return;
    const verejna = envHodnota(src, "INGEST_DOMAIN_PUBLIC");
    if (verejna === null) return;
    // Brána NEVYŽADUJE veřejnou doménu. Jen drží, že „vypnuto" je vyjádřené
    // sentinelem, ne prázdnem — prázdno by se četlo jako „ještě nenastaveno".
    expect(
      verejna.length > 0,
      "INGEST_DOMAIN_PUBLIC je prázdné. Vypnuté veřejné vystavení se deklaruje\n" +
        "sentinelem (`ingest-disabled.invalid`), aby šlo odlišit od „nenastaveno\".",
    ).toBe(true);
  });

  describe("env-doktor zastaralou hodnotu SROVNÁ (instance, která už hodnotu má)", () => {
    /**
     * Doktor v APPLY nad temp souborem se stavem naměřeným 2026-09-14. Prostředí
     * bez vstupů resolveru, `--no-external` — verdikt nesmí řídit trezor toho,
     * kdo bránu pouští. Identita jde prostředím, jako v redeployi.
     */
    function doktor(identita: string | null) {
      const soubor = join(mkdtempSync(join(tmpdir(), "aisha-ingest-allowlist-")), "env.coolify");
      writeFileSync(soubor, "AISHA_PROFILE=cloud-multi\nINGEST_ALLOWED_HOSTS=ingest-disabled.invalid\n");
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of [...RESOLVER_ENV_INPUTS, "ENV_FILE", "AISHA_STORY"]) delete env[k];
      const r = spawnSync("node", [join(ROOT, "scripts/aisha-env-doctor.mjs"), "--no-external"], {
        cwd: ROOT,
        env: { ...env, ENV_FILE: soubor, ...(identita ? { APP_NAME_PREFIX: identita } : {}) },
        encoding: "utf8",
        timeout: 60_000,
      });
      return { r, hodnota: envHodnota(readFileSync(soubor, "utf8"), "INGEST_ALLOWED_HOSTS") };
    }

    test("stará hodnota bez vnitřního jména → doktor ho doplní", () => {
      const { r, hodnota } = doktor("testfork");
      expect(envDoktorDokoncil(r.status), r.stderr.slice(-600)).toBe(true);
      const chybi = povinneVnitrni("testfork").filter((h) => !polozky(hodnota ?? "").has(h));
      expect(
        chybi,
        "Doktor nechal zastaralou hodnotu být. Přesně tak zůstal nasazený fork dva týdny\n" +
          "po opravě šablony na `ingest-disabled.invalid` a broker dostával 421.\n" +
          `Po běhu doktora: ${hodnota}`,
      ).toEqual([]);
    });

    test("bez identity se hodnota NEPŘEPÍŠE (`-svc-local-ingest` by byla horší než stará)", () => {
      const { r, hodnota } = doktor(null);
      expect(envDoktorDokoncil(r.status), r.stderr.slice(-600)).toBe(true);
      expect(hodnota).toBe("ingest-disabled.invalid");
    });
  });
});
