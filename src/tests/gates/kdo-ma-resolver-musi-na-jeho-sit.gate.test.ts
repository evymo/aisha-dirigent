/**
 * Gate: kdo deklaruje mesh resolver (`dns:`), musí být na SÍTI, kde ten resolver bydlí.
 *
 * ⛔ NAMĚŘENO 2026-09-07 na produkci. Správce se přihlásil, plocha se vykreslila —
 * a všechny bloky byly PRÁZDNÉ. Žádná chyba, jen prázdné rámečky. Řetěz měl pět
 * článků a příčina byla na konci:
 *
 *   1. bloky prázdné            → vypadá jako chybějící data
 *   2. RPC vrací 401            → vypadá jako chybějící oprávnění
 *   3. …ale AŽ PO 28 SEKUNDÁCH  → rychlá 401 = neplatný token; pomalá = čekání
 *   4. v logu brány:  [ioredis] getaddrinfo EAI_AGAIN
 *                     <prefix>-shared-redis.mesh.<tld>
 *   5. resolver `10.190.127.250` z brány NEODPOVÍDÁ (timeout)
 *
 * Příčina: jádro má u služeb `dns: ${NETBIRD_DNS_IP}`, ale `docker-compose.coolify.yml`
 * síť `mesh-dns` VŮBEC NEDEKLAROVALO. Router adresu `.250` drží — jenže na síti
 * `<prefix>-mesh-dns`, kam jádro připojené není. Ukazovalo tedy resolverem na adresu,
 * kam nemá cestu. Ostatní stacky (admin, ai-chat, cosmos, clamav…) tu síť deklarují.
 *
 * ⭐ PROČ SE TO PROJEVÍ JAKO CHYBA OPRÁVNĚNÍ: brána drží relace v Redisu pod mesh
 * jménem. Když se jméno nepřeloží, čeká se na DNS, doběhne limit a odpoví se 401.
 * Uživatel vidí „nemáš práva", příčinou je nedostupný resolver — pět vrstev vedle.
 *
 * ⭐ TÁŽ RODINA JAKO MRTVÝ RESOLVER, JEN OBRÁCENĚ: tam jméno šlo přeložit a nešlo
 * se spojit; tady je resolver živý, ale konzument k němu nemá cestu. Obě půlky
 * meshe musí sedět — pin `.250` je HOST-LOKÁLNÍ adresa na konkrétní síti, takže
 * „mít ji v `dns:`" nic neznamená, dokud na té síti nestojím.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Text bez komentářů — komentář není chování. */
const bezKomentaru = (text: string) =>
  text
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");

const composeSoubory = () =>
  readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f));

describe("mesh resolver — kdo ho deklaruje, musí stát na jeho síti", () => {
  const soubory = composeSoubory();

  test("nějaké compose soubory vůbec existují (jinak brána nic neměří)", () => {
    expect(soubory.length, "žádný docker-compose.coolify*.yml — detekce se rozešla se skutečností")
      .toBeGreaterThan(5);
  });

  test("compose, který nastavuje dns: na mesh resolver, deklaruje i síť mesh-dns", () => {
    const chybi: string[] = [];
    for (const f of soubory) {
      const src = bezKomentaru(readFileSync(join(ROOT, f), "utf-8"));
      // Konzument mesh resolveru: má `dns:` s NETBIRD_DNS_IP.
      if (!/dns:\s*\n\s*-\s*\$\{NETBIRD_DNS_IP/.test(src)) continue;
      // Pak MUSÍ deklarovat síť, na které resolver bydlí.
      const maSit = /^\s{2}mesh-dns:\s*$/m.test(src) && /MESH_DNS_NETWORK/.test(src);
      if (!maSit) chybi.push(f);
    }
    expect(
      chybi,
      "Tenhle stack nastavuje `dns:` na mesh resolver, ale síť `mesh-dns` nedeklaruje.\n" +
        "Pin `.250` je adresa NA TÉ SÍTI — bez připojení k ní každé mesh jméno vyprší\n" +
        "(EAI_AGAIN) a služba to obvykle ohlásí jako chybu oprávnění, ne jako DNS.\n" +
        "Náprava: přidat do `networks:` blok\n" +
        "    mesh-dns:\n" +
        "      external: true\n" +
        "      name: ${MESH_DNS_NETWORK:?vydává generate-secrets}\n" +
        "a připojit k ní služby, které `dns:` deklarují (vzor: docker-compose.coolify-admin.yml).",
    ).toEqual([]);
  });
});
