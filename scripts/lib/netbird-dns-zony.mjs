/**
 * Mesh DNS zóny, které vlastní `netbird-dns-provision` — značka, plán, reconcile.
 *
 * ⛔ NAMĚŘENO 2026-09-19 (NetBird 0.70, na jedné instanci forku). Nástroj zakládal
 * zóny s `description: "tenant-dns-provision"` a prořezával ty, kde
 * `z.description === TAG`. Jenže zóna NetBirdu pole `description` NEMÁ — ve
 * schématu API (ZoneRequest/Zone: name, domain, enabled, enable_search_domain,
 * distribution_groups, id, records) ani v odpovědi, a to ani u zóny, kterou nástroj
 * právě založil. Prořezávání se tedy NIKDY nespustilo: jméno odebrané z topologie
 * (např. položka EXTERNAL_FACES) nechalo zónu viset navždy a smlouva „mažu jen to,
 * co jsem označil" byla tiše prázdná.
 *
 * NetBird ukládá a vrací `name` (volný řetězec 1–255, není unikátní). Značka
 * vlastníka proto žije TAM: `tenant-dns-provision:<klíč topologie>`.
 *
 * Pravidla, a proč jsou bezpečná:
 *   • ZALOŽIT — jméno v plánu, zóna s tou doménou neexistuje → nová, se značkou.
 *   • PŘEVZÍT — jméno v plánu, zóna existuje BEZ značky → doplní se značka (PUT).
 *     Nástroj do takové zóny už dnes zapisuje záznam, takže převzetí nerozšiřuje,
 *     na co sahá — jen to zviditelní pro budoucí prořezávání. Selhání převzetí
 *     není fatální: záznam se spravuje dál, zónu jen prořezávání neuvidí.
 *   • SMAZAT — zóna SE ZNAČKOU, jejíž doména v plánu není.
 *   • CIZÍ — zóna BEZ značky mimo plán → NIKDY se nemaže, jen se vypíše. Sem
 *     padají i zóny z doby před značkou, které už nikdo nedeklaruje: nástroj
 *     nemá jak dokázat, že jsou jeho, a hádat podle tvaru jména by byla přesně
 *     ta tichá smlouva, kterou tahle oprava ruší. Odstraní je operátor ručně
 *     (nebo se jméno znovu deklaruje, zóna se převezme, a teprve pak odebere).
 *
 * Starý tag v `description` se pořád uznává — kdyby ho některá verze NetBirdu
 * vracela, nesmí se její zóny stát „cizími".
 */

export const ZNACKA = "tenant-dns-provision";
const PREDPONA = `${ZNACKA}:`;

/** Jméno zóny se značkou vlastníka. */
export function jmenoZony(klic) {
  return `${PREDPONA}${klic}`;
}

/** Nese zóna značku tohoto nástroje? */
export function jeVlastni(zona) {
  return (typeof zona?.name === "string" && zona.name.startsWith(PREDPONA)) || zona?.description === ZNACKA;
}

/**
 * Čistý plán nad seznamem zón z API — co by reconcile udělal. Nic nevolá,
 * proto ho může vypsat i suchý běh.
 *
 * @param {Array<{id:string, name?:string, domain:string, description?:string}>} existujici
 * @param {Array<{key:string, domain:string}>} plan
 */
export function planZon(existujici, plan) {
  const chtene = new Map(plan.map((p) => [p.domain, p]));
  const podleDomeny = new Map(existujici.map((z) => [z.domain, z]));
  return {
    zalozit: plan.filter((p) => !podleDomeny.has(p.domain)),
    prevzit: existujici
      .filter((z) => chtene.has(z.domain) && !jeVlastni(z))
      .map((z) => ({ zona: z, klic: chtene.get(z.domain).key })),
    smazat: existujici.filter((z) => jeVlastni(z) && !chtene.has(z.domain)),
    cizi: existujici.filter((z) => !jeVlastni(z) && !chtene.has(z.domain)),
  };
}

/**
 * Srovná zóny a apex A záznamy s plánem.
 *
 * @param {(method:string, path:string, payload?:object) => Promise<any>} call
 * @param {Array<{key:string, domain:string, ip:string, alias?:string}>} plan
 * @param {{log?: (line:string) => void}} [opts]
 */
export async function reconcileZony(call, plan, { log = console.log } = {}) {
  const groups = await call("GET", "/api/groups");
  const allGroup = (groups.find((g) => g.name === "All") || groups[0])?.id;
  if (!allGroup) throw new Error("no distribution group found");

  const existujici = await call("GET", "/api/dns/zones");
  const p = planZon(existujici, plan);
  const podleDomeny = new Map(existujici.map((z) => [z.domain, z]));

  for (const x of p.zalozit) {
    const zona = await call("POST", "/api/dns/zones", {
      name: jmenoZony(x.key), domain: x.domain, enabled: true,
      enable_search_domain: false, distribution_groups: [allGroup],
    });
    podleDomeny.set(x.domain, zona);
    log(`  + zone ${x.domain}`);
  }

  for (const { zona, klic } of p.prevzit) {
    try {
      await call("PUT", `/api/dns/zones/${zona.id}`, {
        name: jmenoZony(klic), domain: zona.domain,
        enabled: zona.enabled ?? true,
        enable_search_domain: zona.enable_search_domain ?? false,
        distribution_groups: zona.distribution_groups?.length ? zona.distribution_groups : [allGroup],
      });
      log(`  ⊕ zone ${zona.domain} převzata (značka vlastníka do name)`);
    } catch (e) {
      log(`  ! zone ${zona.domain}: převzetí selhalo (${String(e.message).split("\n")[0]}) — záznam spravuji dál, prořezávání ji neuvidí`);
    }
  }

  for (const x of plan) {
    const zona = podleDomeny.get(x.domain);
    const recs = await call("GET", `/api/dns/zones/${zona.id}/records`);
    const apex = recs.find((r) => r.name === x.domain && r.type === "A");
    if (!apex) {
      await call("POST", `/api/dns/zones/${zona.id}/records`, { name: x.domain, type: "A", content: x.ip, ttl: 60 });
      log(`  + ${x.domain} A ${x.ip}  (${x.alias ?? ""})`);
    } else if (apex.content !== x.ip) {
      await call("PUT", `/api/dns/zones/${zona.id}/records/${apex.id}`, { name: x.domain, type: "A", content: x.ip, ttl: 60 });
      log(`  ~ ${x.domain} A ${apex.content} → ${x.ip}  (${x.alias ?? ""})`);
    }
  }

  for (const z of p.smazat) {
    await call("DELETE", `/api/dns/zones/${z.id}`);
    log(`  - zone ${z.domain} (už se nedeklaruje)`);
  }
  if (p.cizi.length) {
    log(`  · ${p.cizi.length} zón bez značky mimo plán — NEMAŽU (cizí, nebo z doby před značkou): ${p.cizi.map((z) => z.domain).join(", ")}`);
  }
  return p;
}
