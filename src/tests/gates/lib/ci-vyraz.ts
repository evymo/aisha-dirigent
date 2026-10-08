/**
 * Vyhodnocovač podmínek `if:` z GitHub Actions (.github/workflows/).
 *
 * PROČ SDÍLENÝ MODUL (naměřeno 2026-08-22)
 * ----------------------------------------
 * Žil jako soukromá funkce uvnitř `deploy-se-nesmi-preskocit.gate.test.ts`.
 * Druhá brána — `stack-bez-deploy-ulohy` — se přitom ptá na otázku, kterou
 * BEZ NĚJ zodpovědět nejde: „nasadí ten krok někdo doopravdy?" Bez podmínek
 * totiž počítala i kroky sedící v úloze, která se pro tu appku NIKDY nespustí.
 *
 * ⛔ Doloženo mutací: smazání podmínky úlohy `deploy-infra` nezčervenalo ANI
 * JEDNU z obou bran, přestože by `shared-redis` přestal být nasazován.
 * Krok v nespustitelné úloze je v CI vidět jako „skipped" — zeleně.
 *
 * Kopírovat ho podruhé by znamenalo dva výklady téhož jazyka, které se rozejdou.
 */
export type Hodnota = string | boolean;

/**
 * Svět repozitáře, který si NASAZENÍ ZAPNUL. Deploy úlohy v ci.yml jsou opt-in
 * (`vars.APP_NAME_PREFIX != ''`): veřejný klon bez instance nenasazuje nic.
 * Brány, které se ptají „spustí se nasazení?", se ptají ve světě, kde instance
 * JE deklarovaná — a to, že bez ní se nespustí nic, měří samostatná sonda
 * (deploy-se-nesmi-preskocit). Jeden domov, aby se čtyři modely nerozešly.
 */
export const SVET_S_INSTANCI: Readonly<Record<string, Hodnota>> = Object.freeze({
  "vars.APP_NAME_PREFIX": "zkouska",
});

export function vyhodnotit(vyraz: string, svet: Record<string, Hodnota>): boolean {
  const src = vyraz.replace(/\$\{\{/g, " ").replace(/\}\}/g, " ").trim();
  let i = 0;

  const preskocit = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const zkusit = (t: string) => {
    preskocit();
    if (src.startsWith(t, i)) {
      i += t.length;
      return true;
    }
    return false;
  };
  const pravdivost = (v: Hodnota) => (typeof v === "boolean" ? v : v.length > 0);

  function primar(): Hodnota {
    preskocit();
    if (zkusit("(")) {
      const v = nebo();
      if (!zkusit(")")) throw new Error(`chybí ')' na pozici ${i}`);
      return v;
    }
    if (zkusit("!")) return !pravdivost(primar());
    if (src[i] === "'") {
      const konec = src.indexOf("'", i + 1);
      if (konec < 0) throw new Error(`neuzavřený literál na pozici ${i}`);
      const s = src.slice(i + 1, konec);
      i = konec + 1;
      return s;
    }
    // `contains(a, b)` — podřetězcová funkce výrazů GitHub Actions. Vyhodnocovač
    // ji musí umět, jinak by podmínky, které ji používají, spadly do „nerozumím"
    // a brána by o nich MLČELA. Mlčící brána je horší než žádná: vypadá zeleně.
    if (/^contains\s*\(/.test(src.slice(i))) {
      i += src.slice(i).indexOf("(") + 1;
      const levy = nebo();
      if (!zkusit(",")) throw new Error(`contains(): chybí ',' na pozici ${i}`);
      const pravy = nebo();
      if (!zkusit(")")) throw new Error(`contains(): chybí ')' na pozici ${i}`);
      return String(levy).includes(String(pravy));
    }
    const m = /^[A-Za-z_][A-Za-z0-9_.-]*(\(\))?/.exec(src.slice(i));
    if (!m) throw new Error(`nerozumím výrazu od pozice ${i}: ${src.slice(i, i + 40)}`);
    i += m[0].length;
    const jmeno = m[0];
    if (jmeno.endsWith("()")) {
      switch (jmeno) {
        case "always()":
        case "success()":
          return true;
        case "cancelled()":
        case "failure()":
          return false;
        default:
          throw new Error(`neznámá funkce ${jmeno}`);
      }
    }
    if (!(jmeno in svet)) throw new Error(`svět nezná '${jmeno}'`);
    return svet[jmeno];
  }

  function porovnani(): Hodnota {
    const l = primar();
    preskocit();
    if (zkusit("==")) return String(l) === String(primar());
    if (zkusit("!=")) return String(l) !== String(primar());
    return l;
  }
  // ⚠️ Pravá strana se VŽDY přečte, i když výsledek je už rozhodnutý. Zkratové
  // `&&` v JavaScriptu by ji totiž nepřečetlo — a parser by se rozešel se
  // vstupem: `a && b` s nepravdivým `a` by nechalo `b` nesnědené a další `)`
  // by vypadalo jako chybějící závorka. Vyhodnocování a čtení jsou dvě věci.
  function a(): Hodnota {
    let v = porovnani();
    while (zkusit("&&")) {
      const prava = porovnani();
      v = pravdivost(v) && pravdivost(prava);
    }
    return v;
  }
  function nebo(): Hodnota {
    let v = a();
    while (zkusit("||")) {
      const prava = a();
      v = pravdivost(v) || pravdivost(prava);
    }
    return v;
  }

  const vysledek = nebo();
  preskocit();
  if (i < src.length) throw new Error(`zbytek nerozparsován: ${src.slice(i, i + 40)}`);
  return pravdivost(vysledek);
}
