/**
 * Gate: každý stroj, na kterém běží konzumenti meshe, musí mít mesh resolver.
 *
 * ⛔ NAMĚŘENO 2026-09-06
 * ---------------------
 * `veřejná adresa WS brány` vracelo 502. Příčina byla o pět vrstev jinde:
 *
 *   1. `ws-gateway` a `event-worker` v crash-loopu na
 *      `getaddrinfo EAI_AGAIN <prefix>-shared-redis.mesh.…internal`;
 *   2. jméno umí přeložit jen mesh resolver (`mesh-router`, pin .250);
 *   3. ten bydlí uvnitř compose `prebuilt`, a katalog dává službě `edge`
 *      jediné `placement: frontend`;
 *   4. síť `mesh-dns` si ale `netinit` zakládá na KAŽDÉM stroji, takže
 *      `10.190.127.250` vypadá jako platná adresa všude;
 *   5. na Giahu a Varře ji NEDRŽEL NIKDO → 48 kontejnerů mířilo `dns:`
 *      do prázdna.
 *
 * Existující brána `coldstart-mesh-dns-activation` hlídala TVAR adresy
 * (deterministická konstanta, ne churn, ne past 127.0.0.11) — a ten byl celou
 * dobu v pořádku. Nikdo netestoval, že na té adrese někdo NA DANÉM STROJI
 * odpovídá. Tahle brána doplňuje právě tu půlku.
 *
 * ⭐ PROČ TO NEJDE ODVODIT Z „mesh je zapnutá". Docker `dns:` je PŘEBITÍ, ne
 * doplněk: vestavěný resolver 127.0.0.11 dál řeší aliasy vlastní sítě, ale
 * všechno ostatní posílá na mrtvý upstream. Vada se proto projeví jako TIMEOUT
 * (EAI_AGAIN), ne jako „takový záznam neexistuje", a vypadá jako pomalá síť.
 * A protože většina služeb své protějšky stejně nachází aliasem, stack se tváří
 * zdravě — mrtvý resolver čeká na otázku, kterou nikdo nepokládá.
 *
 * Brána je STATICKÁ: ptá se katalogu a compose souborů, ne živého clusteru.
 * Na otázku „odpovídá resolver TEĎ?" je `scripts/mesh-resolver-probe.mjs`,
 * který běží PO nasazení.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { SLOTY_S_VLASTNIM_ROUTEREM, souborProSlot, vykresliMeshRouter } from "../../../scripts/gen-mesh-router.mjs";

/** Minimální tvar compose, který tahle brána čte. Ne `any`: kdyby se struktura
 *  změnila, má o tom padnout typ, ne až běh. */
type SluzbaCompose = {
  networks?: Record<string, { ipv4_address?: string } | null>;
  dns?: unknown;
};
type SouborCompose = { services?: Record<string, SluzbaCompose> };
type ZaznamKatalogu = { compose?: string; placement?: string };

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const KATALOG: Record<string, ZaznamKatalogu> = JSON.parse(read("config/services.json")).services;

type Sluzba = { jmeno: string; slot: string; compose: string };

const sluzby: Sluzba[] = Object.entries(KATALOG)
  .filter(([, v]) => v && typeof v === "object" && v.compose && v.placement)
  .map(([jmeno, v]) => ({ jmeno, slot: String(v.placement), compose: String(v.compose) }));

/** Compose → seznam služeb, které DRŽÍ pin resolveru (ipv4_address = MESH_DNS_RESOLVER_IP). */
function pinyResolveru(composeSoubor: string): string[] {
  if (!existsSync(join(ROOT, composeSoubor))) return [];
  const j = parse(read(composeSoubor), { merge: true }) as SouborCompose;
  const out: string[] = [];
  for (const [jmeno, s] of Object.entries(j?.services ?? {})) {
    const sit = s?.networks?.["mesh-dns"];
    const pin = sit && typeof sit === "object" ? String(sit.ipv4_address ?? "") : "";
    if (/MESH_DNS_RESOLVER_IP/.test(pin)) out.push(jmeno);
  }
  return out;
}

/** Compose → seznam služeb, které mají `dns:` na mesh resolver (tedy KONZUMENTI). */
function konzumenti(composeSoubor: string): string[] {
  if (!existsSync(join(ROOT, composeSoubor))) return [];
  const j = parse(read(composeSoubor), { merge: true }) as SouborCompose;
  const out: string[] = [];
  for (const [jmeno, s] of Object.entries(j?.services ?? {})) {
    const dns = s?.dns;
    const radky = Array.isArray(dns) ? dns : dns ? [dns] : [];
    if (radky.some((r) => /NETBIRD_DNS_IP/.test(String(r)))) out.push(jmeno);
  }
  return out;
}

const slotySKonzumenty = new Map<string, string[]>();
const slotySResolverem = new Map<string, string[]>();
for (const s of sluzby) {
  for (const k of konzumenti(s.compose)) {
    slotySKonzumenty.set(s.slot, [...(slotySKonzumenty.get(s.slot) ?? []), `${s.jmeno}/${k}`]);
  }
  for (const p of pinyResolveru(s.compose)) {
    slotySResolverem.set(s.slot, [...(slotySResolverem.get(s.slot) ?? []), `${s.jmeno}/${p}`]);
  }
}

describe("mesh — resolver stojí na každém stroji, kde jsou konzumenti", () => {
  test("existuje aspoň jeden konzument (jinak brána nic neměří)", () => {
    // Pojistka proti tichému zezelenání: kdyby se `dns:` přestalo psát tímhle
    // tvarem, brána by neměla co porovnávat a mlčela by jako by bylo čisto.
    expect(slotySKonzumenty.size, "žádný slot s konzumenty — detekce se rozešla se skutečností").toBeGreaterThan(0);
  });

  test("každý slot s konzumenty má resolver", () => {
    const bezResolveru = [...slotySKonzumenty.keys()].filter((slot) => !slotySResolverem.has(slot));
    expect(
      bezResolveru,
      `sloty s konzumenty meshe, ale BEZ resolveru: ${bezResolveru.join(", ")}\n` +
        `Konzumenti tam mají dns: na MESH_DNS_RESOLVER_IP, kterou na jejich stroji nikdo nedrží,\n` +
        `takže jim nefunguje překlad ŽÁDNÉHO jména mimo aliasy vlastní sítě.\n` +
        `Náprava: doplnit katalogu službu mesh-router-<slot> (soubor vykreslí scripts/gen-mesh-router.mjs).`,
    ).toEqual([]);
  });

  test("žádný slot nemá resolver dvakrát (dva piny = konflikt adresy)", () => {
    const dvojice = [...slotySResolverem.entries()].filter(([, kdo]) => kdo.length > 1);
    expect(
      dvojice.map(([slot, kdo]) => `${slot}: ${kdo.join(" + ")}`),
      "dva kontejnery nemohou držet tutéž ipv4_address — druhý nenastartuje",
    ).toEqual([]);
  });

  test("resolver je vždy připojený na síť mesh-dns a drží pin (ne jen deklaruje)", () => {
    for (const [slot, kdo] of slotySResolverem) {
      expect(kdo.length, `slot ${slot} nemá resolver`).toBeGreaterThan(0);
    }
    expect(slotySResolverem.size, "žádný resolver v celém katalogu").toBeGreaterThan(0);
  });
});

describe("mesh — vykreslené soubory resolveru se nerozešly s generátorem", () => {
  for (const slot of SLOTY_S_VLASTNIM_ROUTEREM as string[]) {
    test(`${slot} odpovídá generátoru`, () => {
      const cesta = souborProSlot(slot);
      expect(existsSync(join(ROOT, cesta)), `${cesta} chybí — spusť node scripts/gen-mesh-router.mjs`).toBe(true);
      expect(read(cesta), `${cesta} se rozešel s generátorem — spusť node scripts/gen-mesh-router.mjs`).toBe(
        vykresliMeshRouter(slot),
      );
    });
  }

  test("každý vykreslený soubor má v katalogu svou aplikaci", () => {
    for (const slot of SLOTY_S_VLASTNIM_ROUTEREM as string[]) {
      const zaznam = KATALOG[`mesh-router-${slot}`];
      expect(zaznam, `katalog nezná mesh-router-${slot} — soubor by nikdo nenasadil`).toBeTruthy();
      expect(zaznam.placement).toBe(slot);
      expect(zaznam.compose).toBe(souborProSlot(slot));
    }
  });
});
