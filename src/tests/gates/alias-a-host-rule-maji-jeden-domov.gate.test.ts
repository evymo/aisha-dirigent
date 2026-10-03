/**
 * Alias sítě a případná vlastní Traefik Host rule mají JEDEN DOMOV
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Když služba deklaruje alias ve tvaru hostitelského jména (obsahuje tečku), je
 * to TÁŽ adresa, na kterou ji volají zvenčí. Musí tedy pocházet ze STEJNÉHO
 * výrazu jako `traefik.http.routers.*.rule=Host(...)` téže služby — ne z literálu
 * napsaného vedle.
 *
 * ── PROČ (naměřeno 2026-08-12) ────────────────────────────────────────────────
 * `docker-compose.coolify-pki.yml` měl:
 *
 *     aliases:
 *       - pki-bridge.backend.${INTERNAL_TLD}          ← literál
 *     labels:
 *       - traefik…rule=Host(`${PKI_BRIDGE_DOMAIN}`)   ← proměnná
 *
 * Dvě jména pro touž věc. Dokud se náhodou rovnala, nikdo si nevšiml, že jsou
 * dvě. Jakmile jméno začalo nést identitu instance, rozešla se — a projevilo se
 * to takhle:
 *
 *   pki-init volá https://<projekt>-pki-bridge.backend.<tld>
 *     → docker DNS uvnitř zná jen `pki-bridge.backend.<tld>` ⇒ NEROZŘEŠÍ
 *       → dotaz vypadne na VEŘEJNÉ DNS, obejde celý cluster
 *         → vrátí se jako 504 po 30 s
 *           → pki-init exit 1 (PKI_BUNDLE_REQUIRED=true u core)
 *             → aisha-core nešlo nasadit ⇒ vlna 2 zastavila cold-start
 *
 * Most přitom celou dobu běžel `Healthy` a odpovídal na :3040. Nebylo rozbité
 * NIC, co by šlo vidět na zdraví kontejnerů — jen se dvě jména rozešla.
 *
 * ── CO SE MĚŘÍ ────────────────────────────────────────────────────────────────
 * 1. Žádný alias ve tvaru FQDN není literál (musí obsahovat `${`).
 * 2. Má-li služba FQDN alias I vlastní Host rule, jde o TÝŽ výraz. Nulový počet
 *    vlastních Host rules je správně: produkční routery generuje Coolify z
 *    docker_compose_domains a jejich názvy scopeuje projektem/aplikací.
 *
 * Krátké aliasy bez tečky (`${APP_NAME_PREFIX:?…}-db`) sem nepatří: to jsou
 * jména uvnitř sítě, ne adresy, na které někdo míří zvenčí.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const ROOT = process.cwd();

type Sluzba = {
  soubor: string;
  jmeno: string;
  fqdnAliasy: string[];
  hostRules: string[];
};

/** Compose soubory nasazení — co není v repu, není náš kontrakt. */
function composeSoubory(): string[] {
  return execFileSync("git", ["ls-files", "docker-compose.coolify*.yml"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/**
 * Je ten alias ADRESA (na kterou někdo míří zvenčí), nebo jen jméno uvnitř sítě?
 *
 * Dvě rozpoznatelné podoby — a druhá je tu proto, že po opravě je alias ČISTÁ
 * proměnná, takže „obsahuje tečku" ho nepozná (self-check to odhalil 2026-08-12):
 *
 *   a) tečka MIMO `${…}`        `pki-bridge.backend.${INTERNAL_TLD}`
 *   b) klíč pojmenovaný adresou  `${PKI_BRIDGE_DOMAIN:?…}`, `${X_HOST}`, `${X_FQDN}`
 *
 * Krátká jména jako `${APP_NAME_PREFIX:?…}-db` neprojdou ani jedním — a správně:
 * to je jméno uvnitř sítě, ne adresa, kterou zná Traefik.
 */
function jeAdresa(hodnota: string): boolean {
  if (hodnota.replace(/\$\{[^}]*\}/g, "").includes(".")) return true;
  return /^\$\{[A-Z_][A-Z0-9_]*_(DOMAIN|HOST|FQDN)[^}]*\}$/.test(hodnota);
}

/**
 * Rozpad na služby bez YAML parseru: `services:` má položky na dvou mezerách.
 * Držíme se odsazení, protože nás zajímají jen dva tvary řádků (alias, label)
 * a plný parser by sem tahal závislost kvůli dvěma regexům.
 */
function sluzbyVSouboru(soubor: string): Sluzba[] {
  const text = readFileSync(path.join(ROOT, soubor), "utf8");
  const radky = text.split("\n");

  const out: Sluzba[] = [];
  let aktualni: Sluzba | null = null;
  let vAliasech = false;

  for (const radek of radky) {
    const hlavicka = radek.match(/^ {2}([a-z0-9][a-z0-9._-]*):\s*$/);
    if (hlavicka) {
      aktualni = { soubor, jmeno: hlavicka[1], fqdnAliasy: [], hostRules: [] };
      out.push(aktualni);
      vAliasech = false;
      continue;
    }
    if (!aktualni) continue;

    if (/^\s*aliases:\s*$/.test(radek)) {
      vAliasech = true;
      continue;
    }
    if (vAliasech) {
      // Komentář ani prázdný řádek blok NEUKONČUJE. Naměřeno 2026-08-12: první
      // verze téhle sondy na komentáři blok zavřela — a jediný alias, kvůli
      // kterému brána vznikla, má nad sebou právě vysvětlující komentář. Sonda
      // pak hlásila „žádný FQDN alias", tedy čisto o něčem, co nepřečetla.
      const orez = radek.trim();
      if (orez === "" || orez.startsWith("#")) continue;

      const polozka = radek.match(/^\s*-\s+(.+?)\s*$/);
      if (polozka) {
        const hodnota = polozka[1].replace(/^["']|["']$/g, "");
        if (jeAdresa(hodnota)) aktualni.fqdnAliasy.push(hodnota);
        continue;
      }
      vAliasech = false;
    }

    const host = radek.match(/routers\.[^.]+\.rule=Host\(`([^`]+)`\)/);
    if (host) aktualni.hostRules.push(host[1]);
  }
  return out;
}

const sluzby = composeSoubory().flatMap(sluzbyVSouboru);

describe("alias sítě a Host rule: jeden domov", () => {
  it("sonda má co měřit — compose soubory se načetly a nesou FQDN aliasy", () => {
    // Mlčení sondy je samo nálezem: kdyby se změnilo odsazení nebo se soubory
    // přejmenovaly, testy níž by prošly nad prázdnem.
    expect(sluzby.length, "žádná služba — parser neběží nad stromem").toBeGreaterThan(50);
    expect(
      sluzby.filter((s) => s.fqdnAliasy.length > 0).length,
      "žádný FQDN alias — buď žádný neexistuje (pak tenhle test smaž), nebo parser netrefil",
    ).toBeGreaterThan(0);
  });

  it("žádný alias ve tvaru hostitelského jména není literál", () => {
    const literaly: string[] = [];
    for (const s of sluzby) {
      for (const a of s.fqdnAliasy) {
        if (!a.includes("${")) literaly.push(`${s.soubor} :: ${s.jmeno} :: ${a}`);
      }
    }
    expect(
      literaly.sort(),
      "Alias ve tvaru FQDN je adresa, na kterou někdo míří. Napsaný literálem se\n" +
        "rozejde s tím, kdo ji volá, a rozejití je NEVIDITELNÉ — kontejner zůstane\n" +
        "zdravý, jen ho nikdo nenajde. Odvoď ho z téhož klíče jako volající.",
    ).toEqual([]);
  });

  it("má-li služba FQDN alias i Host rule, je to týž výraz", () => {
    const rozejite: string[] = [];
    for (const s of sluzby) {
      if (s.fqdnAliasy.length === 0 || s.hostRules.length === 0) continue;
      // Porovnává se JMÉNO KLÍČE, ne celý zápis: alias smí nést `:?zpráva`,
      // label ne (label se interpoluje při renderu compose, kde `:?` nemá kam hlásit).
      const klic = (v: string) => v.replace(/\$\{([A-Z_][A-Z0-9_]*)[^}]*\}/g, "$${$1}");
      for (const a of s.fqdnAliasy) {
        const shoda = s.hostRules.some((h) => klic(h) === klic(a));
        if (!shoda) {
          rozejite.push(`${s.soubor} :: ${s.jmeno} :: alias=${a} vs Host=${s.hostRules.join(",")}`);
        }
      }
    }
    expect(
      rozejite.sort(),
      "Alias uvnitř sítě a Host rule na Traefiku popisují TUTÉŽ adresu. Když se\n" +
        "liší, dotaz zevnitř clusteru se nerozřeší lokálně, vypadne na veřejné DNS\n" +
        "a vrátí se cizí cestou (naměřeno 2026-08-12: 504 po 30 s, cold-start stál).",
    ).toEqual([]);
  });
});
