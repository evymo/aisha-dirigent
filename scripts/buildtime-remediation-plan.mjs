#!/usr/bin/env node
/**
 * PLÁN NÁPRAVY BUILD-TIME EXPOZICE — co přesně udělat, v jakém pořadí
 *
 * Doktor uměl expozici ZMĚŘIT: „do buildu jde 856 hodnot navíc, z toho 237
 * tajemství". To je pravda, ale operátorovi to neřekne, co s tím — a číslo bez
 * dalšího kroku je jen výčitka.
 *
 * Tenhle skript odvodí NÁSLEDUJÍCÍ KROK pro každé tajemství, které si build-time
 * vynucuje samo přes `${SECRET:?}` v compose. Pořadí je závazné a plyne z toho,
 * jak se tahle vada dá zavřít bezpečně:
 *
 *   1. doručení se ověřuje ZPĚTNÝM ČTENÍM   (coolify-sync-envs.sh — hotovo)
 *   2. pojistka U SPOTŘEBY ve startovacím skriptu
 *   3. teprve pak `${VAR:?}` → `${VAR}`
 *
 * Přeskočit 2 a udělat rovnou 3 vypadá jako zlepšení — rohatka build-time
 * tajemství klesne — a přitom vznikne účet bez použitelného hesla. Proto se
 * každý klíč zařadí do jedné ze tří tříd:
 *
 *   PŘIPRAVENO       každý výskyt `${K:?}` je ve službě, jejíž startovací
 *                    skript K čte A hlídá → krok 3 lze udělat hned
 *   CHYBÍ POJISTKA   náš skript K čte, ale neumí padnout na prázdnu → krok 2
 *   CIZÍ SPOTŘEBITEL K bere entrypoint OBRAZU (postgres, mariadb, synapse…),
 *                    kam pojistku dát nemůžeme → potřebuje jiný postup
 *
 * ⛔ TŘETÍ TŘÍDA NENÍ ODKLAD, JE TO JINÁ PRÁCE. Sloučit ji s ostatními by
 * znamenalo tvářit se, že zbývá 62 stejných úkonů — a to není pravda.
 *
 * Použití:
 *   node scripts/buildtime-remediation-plan.mjs            # text
 *   node scripts/buildtime-remediation-plan.mjs --json     # strojově
 *   node scripts/buildtime-remediation-plan.mjs --out=P    # zapiš i do souboru
 *
 * Exit 0 vždy (je to plán, ne brána). Prázdný plán = hotovo.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { porovnej } from "./lib/razeni.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const jakoJson = args.includes("--json");
const outArg = args.find((a) => a.startsWith("--out="));

const TAJEMSTVI = /(TOKEN|SECRET|PASSWORD|PASSWD|_PWD|APIKEY|API_KEY|_KEY$|_KEY_|PRIVATE|CREDENTIAL|SALT)/i;
const NENI_TAJEMSTVI = /(ANON_KEY|PUBLISHABLE|PUBLIC_KEY|_KEY_ID$|KEYCLOAK_REALM|_KEYS_DIR|KEY_ALGORITHM)/i;
const jeTajemstvi = (k) => TAJEMSTVI.test(k) && !NENI_TAJEMSTVI.test(k);

/**
 * Rozdělí compose na služby. Potřebujeme vědět, KTERÁ služba nese `${K:?}` —
 * jinak nejde odlišit „náš init skript" od „entrypoint obrazu".
 */
function sluzby(text) {
  const radky = text.split("\n");
  const out = [];
  let vSekci = false;
  let akt = null;
  for (let i = 0; i < radky.length; i++) {
    const r = radky[i];
    if (/^services:\s*$/.test(r)) { vSekci = true; continue; }
    if (/^[A-Za-z]/.test(r)) {
      if (akt) { out.push(akt); akt = null; }
      vSekci = false;
      continue;
    }
    if (!vSekci) continue;
    const m = r.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (m) {
      if (akt) out.push(akt);
      akt = { jmeno: m[1], od: i + 1, radky: [] };
      continue;
    }
    if (akt) akt.radky.push(r);
  }
  if (akt) out.push(akt);
  return out.map((s) => ({ ...s, text: s.radky.join("\n") }));
}

/** Blokové skaláry pod `command:`/`entrypoint:` uvnitř textu služby. */
function startovaciSkript(textSluzby) {
  const radky = textSluzby.split("\n");
  const kusy = [];
  let i = 0;
  while (i < radky.length) {
    const m = radky[i].match(/^(\s*)-?\s*(?:command|entrypoint):/);
    if (!m) { i++; continue; }
    const odsaz = m[1].length;
    const telo = [];
    let j = i + 1;
    while (j < radky.length && (radky[j].trim() === "" || radky[j].match(/^\s*/)[0].length > odsaz)) {
      telo.push(radky[j]); j++;
    }
    if (telo.length) kusy.push(telo.join("\n"));
    i = j;
  }
  return kusy.join("\n");
}

/** Jména, na jejichž prázdnost se skript umí zeptat (tři tvary z repa). */
function hlidana(text) {
  const set = new Set();
  for (const m of text.matchAll(/\[\s*-[zn]\s+"?\$\$\{?([A-Z][A-Z0-9_]*)/g)) set.add(m[1]);
  const testovane = new Set(
    [...text.matchAll(/\[\s*-[zn]\s+"?\$\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );
  for (const m of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=\s*"?\$\$\{?([A-Z][A-Z0-9_]*)/g)) {
    if (testovane.has(m[1])) set.add(m[2]);
  }
  if (/printenv/.test(text) && /-[zn]\s/.test(text)) {
    for (const m of text.matchAll(/for\s+\w+\s+in\s+([^\n;]+)/g)) {
      for (const s of m[1].split(/\s+/)) if (/^[A-Z][A-Z0-9_]*$/.test(s)) set.add(s);
    }
  }
  return set;
}

const TRIDY = {
  PRIPRAVENO: {
    poradi: 1,
    popis: "PŘIPRAVENO — pojistka u spotřeby existuje, `${K:?}` → `${K}` lze udělat hned",
  },
  CHYBI_POJISTKA: {
    poradi: 2,
    popis: "CHYBÍ POJISTKA — náš skript hodnotu čte, ale neumí padnout na prázdnu (krok 2 PŘED krokem 3)",
  },
  CIZI_SPOTREBITEL: {
    poradi: 3,
    popis: "CIZÍ SPOTŘEBITEL — hodnotu bere entrypoint OBRAZU; pojistku nemáme kam dát (jiný postup)",
  },
};

const plan = [];
const soubory = readdirSync(ROOT)
  .filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f))
  .sort();

for (const soubor of soubory) {
  const text = readFileSync(resolve(ROOT, soubor), "utf8");
  const bloky = sluzby(text);

  // Které klíče si build-time vynucují přes `${K:?}` — a v jaké službě.
  const vyskyty = new Map(); // klíč → [{sluzba, hlidana:boolean, masSkript:boolean}]
  for (const s of bloky) {
    const skript = startovaciSkript(s.text);
    const kryta = hlidana(skript);
    for (const m of s.text.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)) {
      const k = m[1];
      if (!jeTajemstvi(k)) continue;
      const ctenoSkriptem = new RegExp(`\\$\\$\\{?${k}[:}\\s]`).test(skript);
      if (!vyskyty.has(k)) vyskyty.set(k, []);
      vyskyty.get(k).push({
        sluzba: s.jmeno,
        masSkript: ctenoSkriptem,
        hlidana: kryta.has(k),
      });
    }
  }

  for (const [klic, mista] of vyskyty) {
    let trida;
    if (mista.some((m) => !m.masSkript)) trida = "CIZI_SPOTREBITEL";
    else if (mista.every((m) => m.hlidana)) trida = "PRIPRAVENO";
    else trida = "CHYBI_POJISTKA";
    plan.push({
      soubor,
      klic,
      trida,
      sluzby: mista.map((m) => m.sluzba),
      detail: mista,
    });
  }
}

plan.sort(
  (a, b) => TRIDY[a.trida].poradi - TRIDY[b.trida].poradi
    || porovnej(a.soubor, b.soubor)
    || porovnej(a.klic, b.klic),
);

const souhrn = {
  celkem: plan.length,
  pripraveno: plan.filter((p) => p.trida === "PRIPRAVENO").length,
  chybiPojistka: plan.filter((p) => p.trida === "CHYBI_POJISTKA").length,
  ciziSpotrebitel: plan.filter((p) => p.trida === "CIZI_SPOTREBITEL").length,
};

if (jakoJson) {
  const out = JSON.stringify({ souhrn, plan }, null, 2);
  process.stdout.write(out + "\n");
  if (outArg) writeFileSync(outArg.slice(6), out + "\n");
} else {
  const r = [];
  r.push("Plán nápravy build-time expozice tajemství");
  r.push("═".repeat(78));
  if (plan.length === 0) {
    r.push("Žádné tajemství si build-time nevynucuje přes ${VAR:?}. Hotovo.");
  } else {
    r.push(
      `${souhrn.celkem} tajemství si build-time vynucuje samo přes \${VAR:?} v compose.`,
    );
    r.push(
      `  ${souhrn.pripraveno} připraveno · ${souhrn.chybiPojistka} chybí pojistka · ` +
        `${souhrn.ciziSpotrebitel} cizí spotřebitel`,
    );
    r.push("");
    let poslTrida = null;
    for (const p of plan) {
      if (p.trida !== poslTrida) {
        r.push("");
        r.push(TRIDY[p.trida].popis);
        r.push("─".repeat(78));
        poslTrida = p.trida;
      }
      r.push(`  ${p.soubor}  ${p.klic}  [${[...new Set(p.sluzby)].join(", ")}]`);
    }
    r.push("");
    r.push("Pořadí je závazné: nejdřív pojistka u spotřeby, teprve pak passthrough.");
    r.push("Opačně by rohatka klesla a vznikl by účet bez použitelného hesla.");
    r.push("Vzor pojistky: docker-compose.coolify-shared-redis.yml (entrypoint).");
    r.push("Hlídá: src/tests/gates/tajemstvi-ma-pojistku-u-spotreby.gate.test.ts");
  }
  const out = r.join("\n");
  process.stdout.write(out + "\n");
  if (outArg) writeFileSync(outArg.slice(6), out + "\n");
}
