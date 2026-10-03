/**
 * Dveře znají mesh skok jako NAŠI proxy, ne jako klienta (CLASS gate)
 *
 * TŘÍDA VADY: klientská adresa se bere z `x-forwarded-for` ZPRAVA a chůze se
 * zastaví na prvním prvku, který není v `GATEWAY_TRUSTED_PROXIES` — ten se
 * prohlásí za klienta. Seznam byl ale jen KÓDOVÝ DEFAULT v
 * `services/gateway/src/config.ts` a znal pouze docker sítě. Poslední skok
 * před bránou je mesh peer, takže se tvářil jako klient sám.
 *
 * NAMĚŘENO 2026-08-31 v produkci, v režimu `measure`, u KAŽDÉHO požadavku
 * z internetu:
 *
 *     {"dvere":{"ip":"100.126.250.10","verdict":"closed","allowed":false,
 *               "mode":"measure","path":"/rest/v1/"}}
 *
 * `100.126.250.10` je mesh peer (mesh je `100.126.0.0/16` na `wt0`), NE naše
 * veřejná adresa `203.0.113.96`. Dva živé následky:
 *
 *   1. V `enforce` by se instance zamkla přede VŠEMI včetně sebe. Zaťukání
 *      zapíše `knock:ip:<naše veřejná>`, ale brána by se ptala po adrese mesh
 *      skoku — klíč, který nikdy nevznikne. Zamčení BEZ KLÍČE.
 *   2. Rate-limit klíčuje toutéž adresou, takže celý internet sdílel JEDEN
 *      kbelík 200 req/min.
 *
 * ⭐ Proč to `measure` chytil a brány ne: režim `measure` je MĚŘIDLO, ne
 * opatrnost navíc. Seznam proxy nelze ověřit čtením — je to tvrzení o
 * topologii, které platí, až když jím projde skutečný provoz.
 *
 * INVARIANT (dvě roviny, obě musí platit):
 *   A) Každá služba, která ve compose dostává `SPA_DOOR_MODE` (tj. rozhoduje
 *      o dveřích), dostává i `GATEWAY_TRUSTED_PROXIES`. Univerzum se HLEDÁ,
 *      nepíše rukou.
 *   B) Odvozený seznam obsahuje mesh rozsah (`NETBIRD_PEER_CIDR`), jinak by
 *      chůze skončila na mesh skoku i s doručenou hodnotou.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gatewayTrustedProxies,
  NETBIRD_PEER_CIDR,
} from "../../../scripts/lib/derive-subnets.mjs";

const ROOT = process.cwd();
const COMPOSE = "docker-compose.coolify.yml";

/** Bloky služeb ve compose — univerzum se hledá, ne vypisuje. */
function sluzbyRozhodujiciODverich(text: string): string[] {
  const radky = text.split("\n");
  const nalezene: string[] = [];
  let sluzba: string | null = null;
  for (const r of radky) {
    const m = /^ {2}([a-z0-9][a-z0-9_-]*):\s*$/.exec(r);
    if (m) sluzba = m[1];
    if (sluzba && /^\s+SPA_DOOR_MODE\s*:/.test(r)) nalezene.push(sluzba);
  }
  return [...new Set(nalezene)];
}

describe("dveře věří mesh skoku", () => {
  const compose = readFileSync(join(ROOT, COMPOSE), "utf-8");

  test("univerzum není prázdné — jinak brána nic neměří", () => {
    expect(sluzbyRozhodujiciODverich(compose).length).toBeGreaterThan(0);
  });

  test("kdo rozhoduje o dveřích, dostává i seznam našich proxy", () => {
    const bezSeznamu: string[] = [];
    for (const s of sluzbyRozhodujiciODverich(compose)) {
      const blok = compose.split(new RegExp(`^  ${s}:\\s*$`, "m"))[1] ?? "";
      const jenTatoSluzba = blok.split(/^ {2}[a-z0-9][a-z0-9_-]*:\s*$/m)[0];
      if (!/^\s+GATEWAY_TRUSTED_PROXIES\s*:/m.test(jenTatoSluzba)) bezSeznamu.push(s);
    }
    expect(bezSeznamu).toEqual([]);
  });

  test("seznam se doručuje, nehádá — žádný `:-` fallback", () => {
    const radek = compose
      .split("\n")
      .find((r) => /^\s+GATEWAY_TRUSTED_PROXIES\s*:/.test(r));
    expect(radek, "GATEWAY_TRUSTED_PROXIES ve compose chybí").toBeTruthy();
    expect(radek).not.toMatch(/:-/);
  });

  // ⛔ TATO BRÁNA VADU DRŽELA. Do 2026-09-02 tu stálo `toContain(NETBIRD_PEER_CIDR)`,
  // tedy požadavek, aby seznam důvěry nesl CELÝ rozsah routy 100.64.0.0/10. Ten
  // rozsah je CGNAT operátorů, takže se tím důvěřovalo i mobilům: klient uvnitř
  // něj se v chůzi zprava přeskočí a za klienta se prohlásí to, co si napsal
  // vlevo. Brána byla zelená, dokud vada trvala.
  test("mesh se do seznamu dostává VÝČTEM peerů, ne rozsahem routy", () => {
    expect(gatewayTrustedProxies("100.126.250.10,100.126.196.201").split(",")).toContain(
      "100.126.250.10",
    );
    expect(gatewayTrustedProxies("100.126.250.10").split(",")).not.toContain(NETBIRD_PEER_CIDR);
  });

  test("rozsah místo adresy se ODMÍTNE, ne tiše přijme", () => {
    expect(() => gatewayTrustedProxies(NETBIRD_PEER_CIDR)).toThrow(/ADRESY peerů/);
  });

  test("hodnota je v registru doctora, jinak nedojde do .env.coolify", () => {
    const doc = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf-8");
    expect(doc).toMatch(/\[\s*"GATEWAY_TRUSTED_PROXIES"\s*,/);
  });
});
