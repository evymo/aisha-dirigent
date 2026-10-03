/**
 * Warmup drží hlídku: zdraví = důkaz, že sítě existují (CLASS gate)
 *
 * TŘÍDA VADY: jednorázová práce, jejíž úspěch se nedá změřit. Coolify vrací
 * "deployment finished", jakmile `compose up -d` vrátí nulu — to říká jen
 * "kontejner se SPUSTIL". Logy ukončené aplikace API odmítá (změřeno
 * 2026-08-11: GET /applications/{uuid}/logs na exited app → 400 "Application
 * is not running"), takže one-shot warmup nemá ŽÁDNÝ kanál, kterým by prokázal,
 * že sítě opravdu založil. Selhání by prošlo jako úspěch a projevilo se až o
 * vlnu později jako "network declared as external, but could not be found" —
 * příznak daleko od příčiny.
 *
 * INVARIANT (řešení): netinit po práci NEskončí — drží hlídku a jeho
 * healthcheck měří TÝŽ zdroj, který command zakládá (docker network inspect
 * přes socket). running:healthy pak PŘÍMO znamená "sítě na hostiteli existují"
 * a vlna 0 je obyčejná vlna bez speciálních větví v aisha-redeploy.mjs.
 * Hlídku po rolloutu maže cold-start (remove_warmup_apps), takže socket
 * nezůstává viset.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WARMUP = "docker-compose.coolify-netinit.yml";

/** Zkontroluje hlídkové invarianty warmup compose. Vrací nálezy (prázdné = OK). */
export function zkontrolujHlidku(yml: string): string[] {
  const nalezy: string[] = [];

  if (/healthcheck:\s*\n\s*disable:\s*true/.test(yml)) {
    nalezy.push(
      "healthcheck je vypnutý (disable: true) — zdraví aplikace pak nic neměří " +
        "a vlna 0 nemá žádný důkaz, že sítě vznikly (logy exited app Coolify nevrací).",
    );
  }

  const hc = yml.match(/healthcheck:[\s\S]*$/);
  if (!hc) {
    nalezy.push("chybí healthcheck — bez něj zdraví aplikace nevypovídá o sítích.");
  } else {
    // Healthcheck musí měřit TÝŽ zdroj, který command zakládá: obě sítě.
    // `$$` je nutné (compose interpolace) — kontrolujeme surový text souboru.
    if (!/docker network inspect "\$\$SHARED_NET"/.test(hc[0])) {
      nalezy.push(
        'healthcheck neinspektuje "$$SHARED_NET" — zdraví by neměřilo sdílenou síť, ' +
          "kterou command zakládá.",
      );
    }
    if (!/docker network inspect "\$\$MESH_NET"/.test(hc[0]) || !/\$\$MESH_ENABLED/.test(hc[0])) {
      nalezy.push(
        'healthcheck neměří "$$MESH_NET" podmíněně přes $$MESH_ENABLED — mesh síť by ' +
          "mohla chybět a hlídka by zůstala zelená (nebo naopak věčně červená s mesh off).",
      );
    }
  }

  // Po práci se drží hlídka — bez ní kontejner skončí a zdraví přestane existovat.
  if (!/while :; do sleep \d+; done/.test(yml)) {
    nalezy.push(
      "command nedrží hlídku (chybí `while :; do sleep …; done`) — kontejner by skončil, " +
        "Coolify by hlásil exited a healthcheck by nikdy neproběhl.",
    );
  }

  // Hlídka nesmí své pády maskovat restart smyčkou: exited má být vidět.
  if (!/restart:\s*"no"/.test(yml)) {
    nalezy.push(
      'chybí restart: "no" — pád hlídky se má ukázat jako exited (fail-loud), ' +
        "ne tiše recyklovat.",
    );
  }

  // Healthcheck mluví docker CLI přes socket — bez mountu by byl trvale červený.
  if (!/\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/.test(yml)) {
    nalezy.push("chybí mount docker.socketu — healthcheck by neměl čím měřit hostitele.");
  }

  return nalezy;
}

describe("warmup drží hlídku a zdraví je důkaz", () => {
  const yml = readFileSync(join(ROOT, WARMUP), "utf-8");

  test("skutečný warmup compose prochází", () => {
    expect(zkontrolujHlidku(yml)).toEqual([]);
  });

  // ── Negativní testy: brána musí každé odebrání invariantu POZNAT ───────────
  test("vypnutý healthcheck je nález", () => {
    const mut = yml.replace(/healthcheck:[\s\S]*$/, "healthcheck:\n      disable: true\n");
    expect(zkontrolujHlidku(mut).join("\n")).toMatch(/vypnutý|chybí healthcheck/);
  });

  test("healthcheck bez SHARED_NET je nález", () => {
    const mut = yml.replace(/docker network inspect "\$\$SHARED_NET"/g, "true");
    expect(zkontrolujHlidku(mut).join("\n")).toContain("$$SHARED_NET");
  });

  test("healthcheck bez podmíněného MESH_NET je nález", () => {
    // Odstranit mesh větev jen z healthchecku (za `healthcheck:`), command nechat.
    const idx = yml.indexOf("healthcheck:");
    const mut =
      yml.slice(0, idx) +
      yml.slice(idx).replace(/\[ "\$\$MESH_ENABLED" != "true" \]/g, "true").replace(
        /docker network inspect "\$\$MESH_NET"/g,
        "true",
      );
    expect(zkontrolujHlidku(mut).join("\n")).toContain("$$MESH_NET");
  });

  test("odstranění hlídkové smyčky je nález", () => {
    const mut = yml.replace(/while :; do sleep \d+; done/, "true");
    expect(zkontrolujHlidku(mut).join("\n")).toContain("nedrží hlídku");
  });

  test("odstranění socketu je nález", () => {
    const mut = yml.replace(/- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/, "- /tmp:/tmp");
    expect(zkontrolujHlidku(mut).join("\n")).toContain("socket");
  });
});
