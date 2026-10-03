/**
 * Veřejný povrch edge NESMÍ odpovídat na health (CLASS gate)
 *
 * ⛔ Do 2026-09-02 stál `handle /__edge_health` na VEŘEJNÉ `:80` a dveře ho
 * musely vyjímat matcherem (`@mimo_dvere not path /__edge_health`). Odpověď
 * „ok 200" komukoli je ale PROZRAZENÍ: scanner se dozví, že tu něco běží a je
 * to živé. Zavřené dveře se nemají dát odlišit od zavřeného portu — o zamčených
 * dveřích nemá vědět ten, kdo neumí zaklepat.
 *
 * ⭐ SPRÁVNÁ OTÁZKA nebyla „jak pustit health skrz dveře", ale „proč vede health
 * přes veřejný vstup". Sonda je vnitřní věc kontejneru — healthcheck chodí po
 * LOOPBACKU, takže nemá důvod sdílet listener se světem. Řešení proto není
 * výjimka v matcheru ani whitelist adres, ale DRUHÝ LISTENER na portu, který se
 * nepublikuje: veřejná `:80` pak žádnou health cestu nemá a není co vyjímat.
 *
 * ⛔ PROČ SE TO NEDÁ VYŘEŠIT POŘADÍM: Caddy neřadí direktivy podle textu, ale
 * podle vlastního pořadníku, a `forward_auth` v něm běží PŘED `handle`. Když
 * health zůstal na `:80`, kontejner si vlastním healthcheckem zabil zdraví
 * (`unhealthy` → Traefik „no available server" → 503 na celou plochu → restart).
 * Oddělený listener tenhle spor ruší úplně.
 *
 * INVARIANT (dvě půlky, drží pár):
 *   1. na veřejné `:80` NENÍ health cesta,
 *   2. healthcheck kontejneru míří na neveřejný port, ne na 80.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COMPOSE = join(ROOT, "docker-compose.coolify-prebuilt.yml");

function edgeBlok(src: string): string {
  const i = src.indexOf("  edge-proxy:");
  if (i < 0) return "";
  const zbytek = src.slice(i + 10);
  const konec = zbytek.search(/\n {2}[a-z0-9][\w.-]*:\s*\n/);
  return konec < 0 ? zbytek : zbytek.slice(0, konec);
}

describe("health neprozrazuje edge", () => {
  const src = readFileSync(COMPOSE, "utf8");
  const edge = edgeBlok(src);

  test("blok edge-proxy se vůbec našel — jinak brána měří prázdno", () => {
    expect(edge.length).toBeGreaterThan(400);
  });

  test("1. veřejná :80 NEMÁ health cestu", () => {
    const i = edge.indexOf(":80 {");
    expect(i, "sekce :80 se nenašla").toBeGreaterThan(-1);
    // od `:80 {` po konec heredocu — tam health být nesmí
    const verejna = edge.slice(i, edge.indexOf("CADDY", i));
    expect(
      verejna,
      "Health na veřejném listeneru prozrazuje, že tu něco běží a je to živé.\n" +
        "Patří na neveřejný port, ne do výjimky v matcheru.",
    ).not.toMatch(/__edge_health/);
  });

  test("2. healthcheck míří na NEVEŘEJNÝ port, ne na 80", () => {
    const t = edge.match(/test:\s*\[[^\]]*__edge_health[^\]]*\]/)?.[0] ?? "";
    expect(t, "healthcheck s /__edge_health se nenašel").not.toBe("");
    expect(
      t,
      "Sonda na :80 by health zpátky přitáhla na veřejný listener.",
    ).not.toMatch(/127\.0\.0\.1:80\//);
  });

  // ⛔ KOMENTÁŘE NEJSOU KÓD. První verze tohohle testu hledala `mimo_dvere`
  // v celém bloku a zčervenala na VLASTNÍM vysvětlení, proč tam ta výjimka
  // být nemá. Měří se proto jen řádky, které něco dělají — jinak by brána
  // trestala právě to, že je vada popsaná.
  test("3. dveře nepotřebují výjimku — na :80 není co vyjímat", () => {
    const bezKomentaru = edge
      .split("\n")
      .filter((r) => !/^\s*#/.test(r))
      .join("\n");
    expect(
      bezKomentaru,
      "`@mimo_dvere` existoval JEN kvůli health na :80. Když se health přestěhoval,\n" +
        "výjimka je zbytečná — a každá výjimka ve dveřích je díra, kterou někdo rozšíří.",
    ).not.toMatch(/mimo_dvere/);
  });

  test("4. neveřejný port se nepublikuje ani nevystavuje", () => {
    const porty = edge.match(/expose:[\s\S]{0,80}/)?.[0] ?? "";
    expect(porty, "expose se nenašel").not.toBe("");
    expect(porty, "Sonda by byla dosažitelná zvenčí a nic bychom nevyřešili.").not.toMatch(/8081/);
  });
});
