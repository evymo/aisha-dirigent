/**
 * Gate: dva ručně udržované seznamy startovacího pořadí se nesmí rozejít.
 *
 * PROČ (2026-07-29)
 * ----------------
 * Startovací pořadí je v repu popsané DVAKRÁT a nezávisle:
 *
 *   A) config/services.json  `depends_on`  — „tohle musí běžet dřív než já"
 *   B) scripts/aisha-redeploy.mjs `WAVES`  — do které vlny app patří
 *
 * Změřeno 2026-07-29: dnes si neodporují. Ale nic to nehlídá — `depends_on`
 * má JEDINÉHO konzumenta, kontrolu referenční integrity v derive-domains.mjs
 * („dep musí existovat v profilu"), a vlny jsou samostatný natvrdo psaný
 * seznam. Shoda je tedy náhoda, ne vlastnost.
 *
 * A rozejít se můžou tiše: kdo přidá službu do vlny, nemá důvod sáhnout do
 * katalogu, a naopak. Projeví se to až cold startem, který spustí službu dřív
 * než to, na čem stojí — tedy nejdráž, jak to jde.
 *
 * Je to táž třída jako „brána zdědí díry svého vstupního seznamu": dva seznamy
 * o téže věci, každý udržovaný ručně. Rozdíl je, že tady se ta shoda dá
 * vynutit, protože obě strany jsou strojově čitelné.
 *
 * CO SE ZÁMĚRNĚ NEKONTROLUJE
 * --------------------------
 * Že `depends_on` obsahuje všechna VOLÁNÍ. Startovací DAG a graf volání jsou
 * různé relace: DAG musí být acyklický, kdežto volání cyklus legitimně má —
 * core volá keycloak za běhu a keycloak potřebuje core při startu. Kdo by
 * chtěl doplnit volání do `depends_on`, rozbije cold start.
 * Graf volání měří scripts/network-policy-report.mjs, ne tahle brána.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

function catalogServices(): Record<string, { depends_on?: string[] }> {
  return JSON.parse(readFileSync(resolve(ROOT, "config/services.json"), "utf8")).services;
}

/**
 * Jména apps, která tahle instalace zná — sjednocení VŠECH manifestů.
 *
 * Katalog (`config/services.json`) není úplný registr nasazovaných apps: popisuje
 * SLUŽBY s topologií, kdežto `coolify/manifests/*.manifest` je seznam APPS a
 * jejich compose souborů — a je jich víc (observability-stack, pgadmin,
 * shared-redis, livekit, shared…). Ptát se katalogu, jestli app existuje, byla
 * otázka na špatný registr: tři app se tvářily jako sirotci, a přitom jsou
 * řádně deklarované.
 *
 * Čte se celá složka, ne jeden soubor. Per-instance manifest je gitignorovaný
 * (`<prefix>.manifest`), takže v CI je k dispozici jen ten referenční — a brána
 * musí měřit v obou případech. Sjednocením se navíc univerzum rozšíří s každou
 * další deklarovanou instancí, aniž by se do brány sahalo.
 */
function manifestApps(): Set<string> {
  const dir = resolve(ROOT, "coolify/manifests");
  const names = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".manifest"))) {
    for (const line of readFileSync(resolve(dir, f), "utf8").split("\n")) {
      const m = line.match(/^app:\s*([a-z0-9_-]+):/i);
      if (m) names.add(m[1]);
    }
  }
  return names;
}

/** Vlny z aisha-redeploy.mjs — čte se ZDROJ, ne kopie, aby se nedal rozejít. */
function wavesByService(): Map<string, number> {
  const src = resolve(ROOT, "scripts/aisha-redeploy.mjs");
  const text = readFileSync(src, "utf8");
  const block = text.match(/const WAVES\s*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error("WAVES v aisha-redeploy.mjs nenalezeny — brána ztratila vstup");
  const waves = new Map<string, number>();
  let num: number | null = null;
  for (const line of block[1].split("\n")) {
    const n = line.match(/num:\s*(\d+)/);
    if (n) num = Number(n[1]);
    const apps = line.match(/apps:\s*\[([^\]]*)\]/);
    if (apps && num !== null) {
      for (const raw of apps[1].split(",")) {
        const id = raw.trim().replace(/^["']|["']$/g, "").replace(/^aisha-/, "");
        // ⛔ PRVNÍ výskyt, ne poslední. Appka smí být ve VÍCE vlnách — jednou
        // se nasadí a podruhé se s ní něco udělá (dnes: „Přepnutí do meshe"
        // znovu sáhne na registry a pki, aby se zapojily do sítě, která do té
        // doby neexistovala). Otázka „kdy STARTUJE" má odpověď v prvním výskytu.
        // `set` bez téhle podmínky přepisoval na poslední, takže pki „startovalo"
        // ve vlně svého přepnutí a brána hlásila, že ho netbird předbíhá —
        // rozpor, který v pořadí nasazování vůbec není (naměřeno 2026-08-22).
        if (id && !waves.has(id)) waves.set(id, num);
      }
    }
  }
  return waves;
}

describe("startovací pořadí: katalog × vlny redeploye", () => {
  it("WAVES jde přečíst a není prázdné (jinak brána nic neměří)", () => {
    const waves = wavesByService();
    expect(waves.size).toBeGreaterThan(5);
  });

  it("žádná služba nestartuje dřív, než to, na čem podle katalogu stojí", () => {
    const services = catalogServices();
    const waves = wavesByService();
    const conflicts: string[] = [];

    for (const [id, svc] of Object.entries(services)) {
      const mine = waves.get(id);
      if (mine === undefined) continue; // app se nenasazuje vlnami (nebo je opt-in)
      for (const dep of svc.depends_on ?? []) {
        const theirs = waves.get(dep);
        if (theirs === undefined) continue; // závislost mimo vlny — řeší jiná kontrola
        if (theirs > mine) {
          conflicts.push(
            `${id} (vlna ${mine}) závisí na ${dep}, který startuje až ve vlně ${theirs}`,
          );
        }
      }
    }

    expect(conflicts, `Rozpor mezi config/services.json a WAVES:\n  ${conflicts.join("\n  ")}`)
      .toEqual([]);
  });

  it("každá app ve vlně je někde DEKLAROVANÁ — jinak je to překlep", () => {
    const declared = new Set([...Object.keys(catalogServices()), ...manifestApps()]);
    const waves = wavesByService();
    const orphans = [...waves.keys()].filter((id) => !declared.has(id)).sort();

    // Bez výjimek. Sirotek znamená jméno, které nezná ani katalog služeb, ani
    // žádný manifest — tedy překlep. A překlep tu není neškodný: tiše vypne
    // kontrolu výše, protože se podle něj nespáruje žádná závislost, a vlna se
    // pak tváří konzistentně, aniž by cokoli hlídala.
    expect(
      orphans,
      `App ve WAVES, kterou nezná katalog ani žádný manifest:\n  ${orphans.join("\n  ")}`,
    ).toEqual([]);
  });
});
