/**
 * Brána: evidence adres drží DEKLAROVANOU lhůtu — měří se chování úklidu, ne jeho text.
 *
 * ⛔ NAMĚŘENO 2026-09-25 (dveře v režimu observe, caddy:2.8.4). Lhůta byla
 * deklarovaná (`roll_keep_days`, 30 dní) a skutečnost byla jiná ve TŘECH bodech:
 *   · Caddy 2.8 (lumberjack) rotuje JEN podle velikosti. `roll_keep_days` maže
 *     odrolované soubory; aktivní `pristupy.log` pod 10 MiB drží záznamy libovolně
 *     dlouho. Při malém provozu: deklarace 30 dní, skutečnost měsíce.
 *   · `roll_keep_days 0` znamená v lumberjacku „navždy" — a hodnota šla do
 *     Caddyfilu neověřená (`30d` by edge shodilo nesrozumitelně, `0` tiše).
 *   · Úklid vázaný na observe by po přepnutí na off nechal evidenci navždy.
 *
 * Časová rotace (`roll_interval`, `roll_at`) je až v Caddy 2.11.1 (timberjack).
 * Do té doby řeže a maže úklid, který spouští HEALTHCHECK edge: smyčka může umřít
 * potichu, healthcheck Docker pouští, dokud kontejner běží. Výsledek úklidu ale
 * NESMÍ ovlivnit zdraví — edge nemá autoheal a unhealthy znamená 503 na celou
 * veřejnou plochu. Úklid tak nesmí být rizikovější než stav, který hlídá.
 *
 * Úsek se VYŘÍZNE z compose a spustí (`$$` → `$`, odsazení bloku pryč); jen cesty
 * se přesměrují do dočasného adresáře. Čas se neposouvá čekáním, ale mtime souborů.
 * V obrazu (busybox) je totéž ověřené E2E — viz compose-notes, „Úklid evidence adres".
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const COMPOSE = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf8");
const CESTY = { skript: "/tmp/edge-uklid.sh", zamek: "/tmp/edge-uklid.zamek", edge: "/var/log/edge" };
const DEN = 86400;

/** Úsek příkazu edge od hlavičky úklidu po konec větve observe — tak, jak ho uvidí sh v kontejneru. */
function usekEdge(): string {
  const r = COMPOSE.split("\n");
  const od = r.findIndex((x) => x.includes("── ÚKLID EVIDENCE ADRES"));
  const po = r.findIndex((x, i) => i > od && /^\s*if \[ "\$\$_door" = "enforce" \]; then$/.test(x));
  if (od < 0 || po < 0) throw new Error(`úsek úklidu v compose nenalezen (od=${od}, po=${po}) — brána by neměřila nic`);
  return r.slice(od, po).map((x) => x.replace(/^ {8}/, "")).join("\n").replace(/\$\$/g, "$");
}

type Piskoviste = { dir: string; edge: string; skript: string; zamek: string; aktivni: string };
function piskoviste(): Piskoviste {
  const dir = mkdtempSync(join(tmpdir(), "evidence-lhuta-"));
  const edge = join(dir, "edge");
  mkdirSync(edge);
  return { dir, edge, skript: join(dir, "uklid.sh"), zamek: join(dir, "zamek"), aktivni: join(edge, "pristupy.log") };
}

/** Všechny výskyty (lib projektu je pod ES2021, `replaceAll` nezná). */
const nahrad = (text: string, co: string, cim: string) => text.split(co).join(cim);

/** Přesměruje cesty kontejneru do pískoviště. Cesta, která v textu není, je vada úseku, ne no-op. */
function presmeruj(text: string, p: Piskoviste): string {
  for (const c of Object.values(CESTY)) {
    if (!text.includes(c)) throw new Error(`úsek nečte ${c} — přesměrování by nic nepřesměrovalo a běh by sahal do skutečného ${c}`);
  }
  return nahrad(nahrad(nahrad(text, CESTY.skript, p.skript), CESTY.zamek, p.zamek), CESTY.edge, p.edge);
}

function spustUsek(p: Piskoviste, dvere: string, lhuta: string | undefined) {
  const skript = `_door=${dvere}\n${presmeruj(usekEdge(), p)}\nprintf '%s' "$access_log"\n`;
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  if (lhuta !== undefined) env.EDGE_ACCESS_RETENTION_DAYS = lhuta;
  const r = spawnSync("sh", ["-c", skript], { encoding: "utf8", env });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Pískoviště s úklidem vygenerovaným z compose pro lhůtu N dní. */
function sUklidem(n: string): Piskoviste {
  const p = piskoviste();
  const r = spustUsek(p, "off", n);
  if (r.rc !== 0) throw new Error(`úsek s lhůtou ${n} neprošel: ${r.out}${r.err}`);
  return p;
}

const uklid = (p: Piskoviste) => spawnSync("sh", [p.skript], { encoding: "utf8", env: { PATH: process.env.PATH } });
const zestarni = (cesta: string, sekund: number) => {
  const t = Date.now() / 1000 - sekund;
  utimesSync(cesta, t, t);
};
const dnes = () => new Date().toISOString().slice(0, 10);
const obsah = (cesta: string) => readFileSync(cesta, "utf8");

describe("lhůta je deklarace, kterou edge ověří — neznámou nehádá", () => {
  it.each([
    ["30", "30"],
    [" 14 ", "14"],
  ])("platná lhůta %j → úklid s N=%s a Caddy s touž hodnotou", (lhuta, cekam) => {
    const p = piskoviste();
    const r = spustUsek(p, "observe", lhuta);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(obsah(p.skript)).toMatch(new RegExp(`^N=${cekam}$`, "m"));
    expect(r.out, "observe musí psát log s touž lhůtou, jakou uklízí úklid").toMatch(new RegExp(`roll_keep_days ${cekam}\\b`));
  });

  // Chybějící i prázdná lhůta: compose ji vyžaduje (`:?`) a tady se NEDOSAZUJE —
  // výchozí hodnotu má jediný domov, kontrakt env-doktora (static 30).
  it.each([undefined, "", "0", "030", "30d", "-5", "abc", "1.5"])(
    "neplatná lhůta %j → edge NENASTARTUJE, a to i v režimu off",
    (lhuta) => {
      // `0` je v lumberjacku „navždy"; `030` by shell v aritmetice četl osmičkově.
      // Mimo observe se sice nesbírá, ale úklid staré evidence tu lhůtu potřebuje.
      for (const dvere of ["observe", "off"]) {
        const p = piskoviste();
        const r = spustUsek(p, dvere, lhuta);
        expect(r.rc, `${dvere}/${lhuta}: ${r.out}`).toBe(1);
        expect(r.out).toMatch(/není kladný počet dní/);
        expect(existsSync(p.skript), "bez platné lhůty nesmí vzniknout úklid").toBe(false);
      }
    },
  );

  it("úklid vzniká ve VŠECH režimech — evidence z dřívějšího observe musí vypršet i po přepnutí", () => {
    for (const dvere of ["off", "observe", "enforce"]) {
      const p = piskoviste();
      expect(spustUsek(p, dvere, "30").rc).toBe(0);
      expect(existsSync(p.skript), `režim ${dvere}`).toBe(true);
    }
  });
});

describe("úklid: řez 1× za 24 h, mazání po N dnech", () => {
  it("první průchod bez .rez řízne hned — obsah z doby před úklidem nečeká na velikost", () => {
    const p = sUklidem("2");
    writeFileSync(p.aktivni, "a\n");
    zestarni(p.aktivni, 40 * DEN);
    expect(uklid(p).status).toBe(0);
    expect(obsah(join(p.edge, `pristupy.log.${dnes()}`))).toBe("a\n");
    expect(obsah(p.aktivni), "aktivní soubor se po řezu zkracuje, nemaže (Caddy drží deskriptor)").toBe("");
    expect(existsSync(join(p.edge, ".rez"))).toBe(true);
  });

  it("do 24 h od řezu se neřeže znovu; po 24 h ano", () => {
    const p = sUklidem("2");
    writeFileSync(p.aktivni, "a\n");
    uklid(p);
    writeFileSync(p.aktivni, "b\n");
    uklid(p);
    expect(obsah(p.aktivni), "řez 15 s po řezu by archiv drobil na kousky").toBe("b\n");
    zestarni(join(p.edge, ".rez"), DEN + 3600);
    uklid(p);
    expect(obsah(p.aktivni)).toBe("");
    // Týž den přepíše týž archiv: v provozu k tomu dojde jen po zabití mezi mv a
    // zkrácením, a pak je nový archiv nadmnožinou starého (duplicity nevznikají).
    expect(obsah(join(p.edge, `pristupy.log.${dnes()}`))).toBe("b\n");
  });

  it("maže vše starší N dní kromě aktivního — i vlastní zálohy Caddy; cizí soubory nechá", () => {
    const p = sUklidem("2");
    const soubory: Record<string, number> = {
      "pristupy.log.2026-01-01": 2 * DEN + 3600,               // za lhůtou
      "pristupy.log.2026-01-03": 1 * DEN,                      // v lhůtě
      "pristupy-2026-01-01T00-00-00.000.log.gz": 3 * DEN,      // záloha lumberjacku za lhůtou
      "pristupy.log": 10 * DEN,                                // aktivní — nikdy se nemaže
      "jiny.log": 10 * DEN,                                    // není evidence
    };
    for (const [f, vek] of Object.entries(soubory)) {
      writeFileSync(join(p.edge, f), `${f}\n`);
      zestarni(join(p.edge, f), vek);
    }
    writeFileSync(join(p.edge, ".rez"), ""); // čerstvý řez → měří se jen mazání
    expect(uklid(p).status).toBe(0);
    expect(readdirSync(p.edge).filter((f) => f !== ".rez").sort()).toEqual(
      ["jiny.log", "pristupy.log", "pristupy.log.2026-01-03"],
    );
  });

  it("díra z nul po zkrácení do archivu nepřejde", () => {
    // ⛔ NAMĚŘENO E2E v caddy:2.8.4 (2026-09-25): lumberjack nově založený soubor
    // (první start, každá rotace) otevírá BEZ O_APPEND a po zkrácení píše na svůj
    // starý posun — před novými řádky vznikne řídká díra z nul. Data v ní nejsou,
    // ale `cp` by nuly zkopíroval do archivu a první řádek za nimi by nešel přečíst.
    const p = sUklidem("2");
    writeFileSync(p.aktivni, Buffer.concat([Buffer.alloc(4096), Buffer.from('{"a":1}\n')]));
    uklid(p);
    const archiv = readFileSync(join(p.edge, `pristupy.log.${dnes()}`));
    expect(archiv.includes(0), "archiv nese nuly z díry").toBe(false);
    expect(archiv.toString()).toBe('{"a":1}\n');
  });

  it("rozpracovaný řez zabitého běhu: dočasný soubor starší 10 min zmizí, čerstvý zůstane", () => {
    const p = sUklidem("2");
    writeFileSync(join(p.edge, ".rez"), "");
    writeFileSync(join(p.edge, ".rez-rozpracovano"), "x\n");
    uklid(p);
    expect(existsSync(join(p.edge, ".rez-rozpracovano")), "čerstvý může patřit běžícímu řezu").toBe(true);
    zestarni(join(p.edge, ".rez-rozpracovano"), 11 * 60);
    uklid(p);
    expect(existsSync(join(p.edge, ".rez-rozpracovano"))).toBe(false);
  });
});

describe("úklid: zámek nesmí uvíznout", () => {
  it("čerstvý zámek = běží jiný průchod → tenhle nic nedělá", () => {
    const p = sUklidem("2");
    writeFileSync(p.aktivni, "a\n");
    mkdirSync(p.zamek);
    expect(uklid(p).status).toBe(0);
    expect(obsah(p.aktivni)).toBe("a\n");
    expect(existsSync(p.zamek)).toBe(true);
  });

  it("zámek zabitého běhu (starší 10 min) se převezme a úklid proběhne v jednom průchodu", () => {
    // Healthcheck zabitý timeoutem nechá zámek ležet. Bez převzetí by se úklid už
    // nikdy nespustil — a potichu, protože na zdraví nemá vliv.
    const p = sUklidem("2");
    writeFileSync(p.aktivni, "a\n");
    mkdirSync(p.zamek);
    zestarni(p.zamek, 11 * 60);
    expect(uklid(p).status).toBe(0);
    expect(obsah(p.aktivni)).toBe("");
    expect(existsSync(p.zamek), "po průchodu zámek neleží").toBe(false);
  });
});

describe("healthcheck: úklid jede za zdravím a verdikt NEOVLIVNÍ", () => {
  const test = parse(COMPOSE).services["edge-proxy"].healthcheck.test as string[];

  // Atrapy vznikají JEDNOU a chování řídí prostředí: nově zapsaný spustitelný
  // soubor macOS při prvním spuštění skenuje (~1 s), v CI to nic nestojí.
  const p = piskoviste();
  const bin = join(p.dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "wget"), `#!/bin/sh\nexit "$ATRAPA_WGET_RC"\n`);
  // `timeout` v obrazu (busybox) ověřuje E2E; tady jde o verdikt, ne o mez.
  writeFileSync(join(bin, "timeout"), `#!/bin/sh\nshift\nexec "$@"\n`);
  writeFileSync(p.skript, `#!/bin/sh\ntouch "$ATRAPA_ZNACKA"\nexit "$ATRAPA_UKLID_RC"\n`);
  for (const f of [join(bin, "wget"), join(bin, "timeout"), p.skript]) chmodSync(f, 0o755);

  function zdravi(wgetRc: number, uklidRc: number | null) {
    const znacka = join(mkdtempSync(join(p.dir, "beh-")), "uklid-probehl");
    const skript = uklidRc === null ? join(p.dir, "neni-uklid.sh") : p.skript;
    const prikaz = nahrad(test[1].replace(/\$\$/g, "$"), CESTY.skript, skript);
    const r = spawnSync("sh", ["-c", prikaz], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        ATRAPA_WGET_RC: String(wgetRc), ATRAPA_UKLID_RC: String(uklidRc ?? 0), ATRAPA_ZNACKA: znacka,
      },
    });
    return { rc: r.status, uklidProbehl: existsSync(znacka) };
  }

  it("tvar: CMD-SHELL a úklid se v něm volá", () => {
    expect(test[0]).toBe("CMD-SHELL");
    expect(test[1]).toContain(CESTY.skript);
  });

  it("zdravý edge + selhaný úklid → pořád zdravý (jinak 503 na celou plochu)", () => {
    expect(zdravi(0, 1)).toEqual({ rc: 0, uklidProbehl: true });
  });

  it("nemocný edge → úklid běží i tak (lhůta neplatí jen za zdraví)", () => {
    expect(zdravi(1, 0)).toEqual({ rc: 1, uklidProbehl: true });
  });

  it("jiný kód wget se normalizuje na 1 — kód 2 si Docker rezervuje", () => {
    expect(zdravi(4, 0).rc).toBe(1);
  });

  it("bez vygenerovaného úklidu rozhoduje jen wget", () => {
    expect(zdravi(0, null).rc).toBe(0);
  });
});

describe("deklarace: jediný zapisovatel je env-doktor — chybějící doplní, operátorovu nepřepíše", () => {
  it("env-doktor: EDGE_ACCESS_RETENTION_DAYS je v kontraktu", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/aisha-env-doctor.mjs"), "--print-contract-keys"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, AISHA_PROFILE: "cloud-multi" },
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(r.stdout, "výpis kontraktu nedoletěl — verdikt by nic neznamenal").toMatch(/^__CONTRACT_END__\t\d+$/m);
    expect(r.stdout).toMatch(/^EDGE_ACCESS_RETENTION_DAYS\t\S+$/m);
  });

  /** env-doktor v APPLY nad dočasným envem — týž zapisovatel jako redeploy i cold-start. */
  function doktor(vstup: string) {
    const dir = mkdtempSync(join(tmpdir(), "evidence-lhuta-doktor-"));
    const env = join(dir, "vstup.env");
    writeFileSync(env, `APP_NAME_PREFIX=zkouska\n${vstup}`);
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/aisha-env-doctor.mjs"), "--no-external"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ENV_FILE: env, AISHA_PROFILE: "cloud-multi" },
      maxBuffer: 16 * 1024 * 1024,
    });
    const radek = readFileSync(env, "utf8").match(/^EDGE_ACCESS_RETENTION_DAYS=(.*)$/m);
    return { rc: r.status, lhuta: radek ? radek[1] : undefined, err: r.stderr };
  }

  it("chybějící lhůta → doktor doplní 30 (redeploy ji tedy doručí i instanci, která ji nikdy neměla)", () => {
    const d = doktor("");
    expect(d.lhuta, d.err.slice(-400)).toBe("30");
  });

  it("operátor lhůtu zkrátil → zkrácená zůstane", () => {
    expect(doktor("EDGE_ACCESS_RETENTION_DAYS=14\n").lhuta).toBe("14");
  });

  it("generátor tajemství lhůtu NEVYDÁVÁ — dva zapisovatelé by měli dvě sémantiky prázdna", () => {
    expect(readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf8")).not.toMatch(/EDGE_ACCESS_RETENTION_DAYS/);
  });
});

