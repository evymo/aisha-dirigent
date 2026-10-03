/**
 * Nasazovaný compose nepublikuje TCP port na hostitele — kromě změřeného dluhu,
 * který smí jen ubývat.
 *
 * ⛔ NAMĚŘENO 2026-09-17 na hostiteli giah: nasazení stacku integration instance
 * skončilo „Bind for 0.0.0.0:5673 failed: port is already allocated". Port (a
 * 8020) držel stack integration JINÉ instance téže platformy na stejném hostiteli.
 * Compose publikoval pevné `9696:9696`, `8020:8020` a `5673:5672` — nárok na
 * SDÍLENÉM hostiteli, který dvě instance neunesou, a zároveň cesta mimo edge.
 * Pravidlo majitele: vystavené jde přes edge do meshe na službu, nic bokem,
 * výjimka jen UDP. Přitom žádná brána TCP host porty neměřila:
 * udp-port-je-rucni-deklarace TCP záznamy přeskakuje a compose-compliance je
 * jen vypisuje (`expect(true)`).
 *
 * ⭐ Měří se VLASTNOST nad všemi `docker-compose.coolify*.yml` (yaml parser
 * s merge klíči, ne regex nad textem): každé publikování, které není UDP.
 * Dluh je v baseline s důvodem u každé položky; nová položka i položka, která
 * už neplatí (ratchet), bránu shodí.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(__dirname, "../../..");
const BASELINE = JSON.parse(readFileSync(join(__dirname, "tcp-port-na-hostiteli.baseline.json"), "utf8")) as {
  dluh: Record<string, string>;
};

type Sluzba = { ports?: unknown[] };

/** TCP publikace v jednom compose: `soubor#služba#port kontejneru`. */
function tcpPublikace(soubor: string, text: string): string[] {
  const dok = parseYaml(text, { merge: true }) as { services?: Record<string, Sluzba> };
  const out: string[] = [];
  for (const [sluzba, s] of Object.entries(dok?.services ?? {})) {
    for (const p of s?.ports ?? []) {
      if (typeof p === "string" || typeof p === "number") {
        const txt = String(p);
        if (/\/udp$/.test(txt)) continue;
        // `[ip:][host:]container[/tcp]` — port kontejneru je za POSLEDNÍ dvojtečkou
        // mimo `${…}` (proměnná nese dvojtečku uvnitř `:?`).
        const bezProto = txt.replace(/\/tcp$/, "");
        const m = /([^:}]+)$/.exec(bezProto);
        out.push(`${soubor}#${sluzba}#${m ? m[1] : bezProto}`);
      } else if (p && typeof p === "object") {
        const o = p as { protocol?: string; target?: unknown; published?: unknown };
        if (o.protocol === "udp") continue;
        if (o.published === undefined) continue; // jen `target` = expose, nic na hostiteli
        out.push(`${soubor}#${sluzba}#${String(o.target)}`);
      }
    }
  }
  return out;
}

const SOUBORY = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f)).sort();
const NALEZY = SOUBORY.flatMap((f) => tcpPublikace(f, readFileSync(join(ROOT, f), "utf8")));

describe("TCP port na hostiteli (brána)", () => {
  test("univerzum: compose soubory existují a měřidlo publikace vidí (dluh není prázdný svět)", () => {
    expect(SOUBORY.length).toBeGreaterThan(10);
    expect(NALEZY.length, "měřidlo nenašlo ani známý dluh — přestalo vidět").toBeGreaterThan(0);
  });

  test("⛔ žádná NOVÁ TCP publikace na hostitele", () => {
    const nove = NALEZY.filter((k) => !(k in BASELINE.dluh));
    expect(
      nove,
      "Publikovaný TCP port je nárok na sdíleném hostiteli (druhá instance ho neunese) a cesta mimo edge. " +
        "Služba patří do meshe: HTTP přes <stack>-mesh-ingress (internal_url/internal_endpoints), " +
        "TCP přes <stack>-mesh-tcp (internal_tcp_endpoints v config/services.json).",
    ).toEqual([]);
  });

  test("dluh smí jen ubývat — položka, která už neplatí, musí z baseline pryč", () => {
    const mrtve = Object.keys(BASELINE.dluh).filter((k) => !NALEZY.includes(k));
    expect(mrtve).toEqual([]);
  });

  test("měřidlo: `5673:5672` a `${X:?…}:3478` najde, UDP a expose ne", () => {
    const vzor = [
      "services:",
      "  a:",
      "    ports:",
      '      - "5673:5672"',
      '      - "${TURN_PORT:?deklarace}:3478"',
      '      - "3478:3478/udp"',
      "      - target: 9000",
      "        published: 19000",
      "  b:",
      "    expose:",
      '      - "8020"',
    ].join("\n");
    expect(tcpPublikace("x.yml", vzor)).toEqual(["x.yml#a#5672", "x.yml#a#3478", "x.yml#a#9000"]);
  });
});
