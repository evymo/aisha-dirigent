/**
 * Rozsah ROUTY se nesmí dostat do seznamu DŮVĚRY (CLASS gate)
 *
 * TŘÍDA VADY: jedna hodnota odpovídá na dvě protichůdné otázky. `NETBIRD_PEER_CIDR`
 * (`100.64.0.0/10`) je správná odpověď na "kam vést routu do meshe" — routa chce být
 * široká, ať trefí každého peera. Jako odpověď na "komu věřit v `x-forwarded-for`" je
 * ale katastrofální: je to RFC 6598 CGNAT, TÝŽ rozsah, který operátoři dávají mobilům.
 *
 * NAMĚŘENO 2026-09-02 v nasazeném `<fork>-edge`:
 *
 *     GATEWAY_TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1,100.64.0.0/10
 *
 * Chůze zprava přeskočí vše důvěryhodné. Klient, jehož VLASTNÍ adresa v tom rozsahu
 * leží, se tím přeskočí taky — a za klienta se prohlásí to, co si napsal vlevo:
 *
 *     1.2.3.4, 100.90.5.5, 192.168.2.1, <mesh>   ->   1.2.3.4
 *      ^ vymyšlené                                     ^ a přesto vítěz
 *
 * Bez podvržení je následek opačný, ale taky živý: `100.90.5.5, 192.168.2.1, <mesh>`
 * nemá JEDINOU nedůvěryhodnou položku, takže `clientIpFrom` vrátí `null` a dveře
 * zavřou. Mobil za operátorským NATem nezaťuká NIKDY.
 *
 * INVARIANT: žádný výrobce seznamu důvěry do něj nesmí vložit rozsah routy.
 * Univerzum se HLEDÁ (kdo sahá na derive-subnets), nepíše rukou — brána s ručním
 * seznamem míjí právě ty soubory, které vzniknou později.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  trustedProxies,
  gatewayTrustedProxies,
  NETBIRD_PEER_CIDR,
  TRUSTED_PROXY_CIDRS,
} from "../../../scripts/lib/derive-subnets.mjs";

const ROOT = process.cwd();

/**
 * Kdo si bere seznam důvěry — univerzum se PROCHÁZÍ, nevypisuje.
 *
 * ⛔ NAMĚŘENO PŘI PSANÍ TÉHLE BRÁNY (2026-09-02): první verze měla napsané
 * `["scripts", "scripts/lib"]` — a konzument seděl v `config/local-presets.mjs`,
 * tedy přesně tam, kam seznam nedosáhl. Brána by vadu neviděla a `npm run
 * test:gates` spadl až na importu. Ručně psané univerzum míjí právě to, co
 * jeho autor nečekal; proto se strom prochází.
 */
function vyrobciSeznamu(): string[] {
  const VYNECHAT = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);
  const nalezene: string[] = [];
  const projdi = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (VYNECHAT.has(e.name)) continue;
      const cesta = rel ? `${rel}/${e.name}` : e.name;
      // Vnořené worktrees (.claude/worktrees/*) jsou jiné checkouty, ne tenhle strom —
      // nález o nich není nález o repu (týž šum jako v schema-deklarace-se-plni).
      if (cesta === ".claude/worktrees") continue;
      if (e.isDirectory()) {
        projdi(cesta);
        continue;
      }
      if (!/\.(mjs|js|ts)$/.test(e.name)) continue;
      if (cesta.startsWith("src/tests/gates/")) continue; // brány o seznamu jen MLUVÍ
      const t = readFileSync(join(ROOT, cesta), "utf-8");
      if (/TRUSTED_PROXY_CIDRS|trustedProxies|GATEWAY_TRUSTED_PROXIES/.test(t)) {
        nalezene.push(cesta);
      }
    }
  };
  projdi("");
  return nalezene;
}

describe("důvěra není rozsah routy", () => {
  test("univerzum není prázdné — jinak brána nic neměří", () => {
    expect(vyrobciSeznamu().length).toBeGreaterThan(0);
  });

  test("statická část seznamu nenese rozsah peerů", () => {
    expect(TRUSTED_PROXY_CIDRS).not.toContain(NETBIRD_PEER_CIDR);
  });

  test("ani složený seznam ho nenese", () => {
    expect(gatewayTrustedProxies("100.126.250.10").split(",")).not.toContain(NETBIRD_PEER_CIDR);
  });

  test("rozsah podstrčený jako peer se ODMÍTNE", () => {
    expect(() => trustedProxies("100.64.0.0/10")).toThrow(/ADRESY peerů/);
    expect(() => trustedProxies("100.126.250.10,10.0.0.0/8")).toThrow(/ADRESY peerů/);
  });

  test("peer se do seznamu dostane a rozsahy zůstanou", () => {
    const v = trustedProxies("100.126.250.10,100.126.196.201");
    expect(v).toContain("100.126.250.10");
    expect(v).toContain("100.126.196.201");
    expect(v).toContain("10.0.0.0/8");
  });

  test("prázdný vstup NEDOSAZUJE rozsah — mesh podíl prostě chybí", () => {
    const v = trustedProxies("");
    expect(v.every((x) => x.includes("/") || x === "127.0.0.1")).toBe(true);
  });

  // Komentáře nejsou kód: hledá se VOLÁNÍ, ne zmínka. Bez tohohle by brána
  // zčervenala na vlastním vysvětlení, proč se rozsah použít nesmí.
  test("žádný výrobce nevkládá NETBIRD_PEER_CIDR do seznamu", () => {
    const vinici: string[] = [];
    for (const f of vyrobciSeznamu()) {
      const kod = readFileSync(join(ROOT, f), "utf-8")
        .split("\n")
        .filter((r) => !/^\s*(\*|\/\/|\/\*)/.test(r))
        .join("\n");
      if (/(TRUSTED_PROXY_CIDRS|trustedProxies)[^\n]*NETBIRD_PEER_CIDR/.test(kod)) vinici.push(f);
      if (/NETBIRD_PEER_CIDR[^\n]*(TRUSTED_PROXY_CIDRS|trustedProxies)/.test(kod)) vinici.push(f);
    }
    expect(vinici).toEqual([]);
  });
});
