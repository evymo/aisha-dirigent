/**
 * Brána: mesh lane míří JMÉNEM CÍLE, ne jménem hopu — a s portem.
 *
 * TŘÍDA VADY (naměřeno 2026-08-21 na produkci, dva tvary téhož omylu):
 *
 *   1. `*_UPSTREAM_MESH=http://<prefix>-mesh-router:<port>` — adresa HOPU.
 *      Mesh-router uměl jen DNAT dvou pevných portů na jednu adresu
 *      (`CORE_MESH_IP`), takže se cíl vybíral PORTEM. Jakmile do mesh vstoupil
 *      druhý stack, port 8080 (imgproxy jádra i n8n) poslal veřejný provoz
 *      `mcp`/`dirigent` do jádra a přísný mesh-ingress ho odmítl
 *      `421 Host nepatri na tento port`. Port není adresa.
 *
 *   2. `*_UPSTREAM_MESH=https://<mesh jméno>` — jméno BEZ PORTU a přes TLS.
 *      Mesh-ingress TLS neterminuje (šifruje WireGuard) a na 443 nikdo
 *      neposlouchá; navíc jméno bez cesty není cesta — propadlo přes wildcard
 *      vyhledávací domény na sdílenou veřejnou IP a vrátilo
 *      `x509: certificate is valid for *.evymo.com` (502 na ingest, potok,
 *      live, companion i na extranetu po přihlášení).
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   Každá hodnota `*_UPSTREAM_MESH`, která míří do mesh zóny, musí
 *     (a) mířit na jméno v mesh zóně, ne na jméno kontejneru hopu,
 *     (b) být `http://` (ingress TLS neterminuje),
 *     (c) nést PORT — bez něj se dialuje 80/443, kde ingress neposlouchá.
 *   Výjimka je jen AUTH: mesh enrollment sám potřebuje Keycloak, takže auth
 *   na mesh stát NESMÍ (chicken-and-egg, majitel 2026-08-19). Ta výjimka se
 *   pozná VLASTNOSTÍ — cíl leží mimo mesh zónu — ne jménem v testu.
 *
 * Univerzum se HLEDÁ v tom, co derivace vydá; nevypisuje se ručně.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { join, resolve } from "node:path";
import { buildTopology, formatShellExports } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = resolve(__dirname, "../../..");

function meshLanes(profileId: string) {
  const topo = buildTopology({ profileId, meshEnabled: true }) as {
    mesh_tld: string;
    services: Record<string, unknown>;
  };
  const out = formatShellExports(topo) as string;
  const lanes: Array<{ key: string; value: string }> = [];
  for (const line of out.split("\n")) {
    const m = /^([A-Z0-9_]+_UPSTREAM_MESH)=(.*)$/.exec(line);
    if (!m) continue;
    lanes.push({ key: m[1], value: m[2].replace(/^'([\s\S]*)'$/, "$1") });
  }
  return { meshTld: topo.mesh_tld, lanes };
}

describe("mesh lane míří jménem cíle, ne hopem", () => {
  const profil = "cloud-multi";

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    const { lanes } = meshLanes(profil);
    expect(lanes.length, "derivace nevydala ANI JEDNU mesh lane — sonda přestala měřit").toBeGreaterThan(3);
  });

  test("žádná mesh lane nemíří na jméno hopu (mesh-router)", () => {
    const { lanes } = meshLanes(profil);
    const naHop = lanes.filter((l) => /mesh-router/.test(l.value));
    expect(
      naHop.map((l) => `${l.key}=${l.value}`),
      [
        "Tyhle lane míří na HOP, ne na cíl:",
        ...naHop.map((l) => `  - ${l.key}=${l.value}`),
        "",
        "Hop rozlišuje cíl PORTEM (iptables DNAT), takže dva stacky na stejném",
        "portu se vylučují a provoz skončí u toho druhého (naměřeno 2026-08-21:",
        "mcp/dirigent na portu 8080 dorazilo do jádra na imgproxy → 421).",
        "",
        "CO S TÍM: cíl je JMÉNO služby v mesh zóně + port její veřejné tváře",
        "  (`public_face` v katalogu). Cestu k němu má klient routou do rozsahu",
        "  peerů (infra/mesh/mesh-client-route.sh), ne přepisem cílové adresy.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("lane do mesh zóny je http:// a NESE PORT", () => {
    const { meshTld, lanes } = meshLanes(profil);
    const vady: string[] = [];
    for (const l of lanes) {
      if (!l.value) continue;
      const m = /^(https?):\/\/([^/:]+)(?::(\d+))?/.exec(l.value);
      if (!m) {
        vady.push(`${l.key}=${l.value} — není to URL`);
        continue;
      }
      const [, schema, host, port] = m;
      // Cíl mimo mesh zónu tahle brána neřeší: AUTH tam patří ZÁMĚRNĚ
      // (mesh enrollment potřebuje Keycloak dřív, než mesh existuje).
      if (!host.endsWith(meshTld)) continue;
      if (schema !== "http") {
        vady.push(`${l.key}=${l.value} — mesh-ingress TLS neterminuje (šifruje WireGuard); patří http://`);
      }
      if (!port) {
        vady.push(`${l.key}=${l.value} — chybí PORT; bez něj se dialuje 80/443, kde ingress neposlouchá`);
      }
    }
    expect(
      vady,
      [
        "Mesh lane s vadným tvarem:",
        ...vady.map((v) => `  - ${v}`),
        "",
        "Jméno bez portu NENÍ cesta: v prostředí s wildcard vyhledávací doménou",
        "se přeloží na cizí stroj a vrátí cizí certifikát (502). Viz",
        "scripts/mesh-routing-doctor.mjs a docs/deploy/NETBIRD_MESH.md.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("klient edge stacku, který volá mesh jméno, má cestu dovnitř", () => {
    // Vlastnost, ne výčet: každá služba edge stacku, která volá mesh jméno,
    // musí mít routu do rozsahu peerů, NET_ADMIN a mesh DNS.
    //
    // ⛔ ROUTA JE VLOŽENÁ INLINE, NE BIND MOUNTEM (naměřeno 2026-08-21).
    // Původně se sdílený skript mountoval z repa. Coolify ale edge staví na
    // build serveru a na cílovém uzlu repo NEMÁ — zdroj mountu tedy
    // neexistoval, Docker místo souboru vytvořil ADRESÁŘ a edge-proxy skončil
    // v restart smyčce s `exit 126: Permission denied`. Veřejná plocha byla
    // kvůli tomu dole. Bind mount souboru z repa v tomhle stacku NEFUNGUJE.
    const edge = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    expect(
      edge,
      "bind mount routy z repa se sem NESMÍ vrátit — na cílovém uzlu repo není a " +
        "Docker vyrobí adresář místo souboru (exit 126, restart smyčka)",
    ).not.toMatch(/\.\/infra\/mesh\/mesh-client-route\.sh:/);

    const volajici = ["edge-proxy", "extranet-auth", "svc-knock-netns"];
    const bloky: string[] = [];
    for (const svc of volajici) {
      const blok = new RegExp(`\\n {2}${svc}:[\\s\\S]*?(?=\\n {2}[a-z0-9-]+:\\n|\\nvolumes:|\\nnetworks:|\\nsecrets:|$)`).exec(edge)?.[0];
      expect(blok, `edge compose nemá službu ${svc}`).toBeTruthy();
      expect(blok, `${svc} potřebuje NET_ADMIN, jinak routu nepostaví`).toMatch(/cap_add:[\s\S]*?NET_ADMIN/);
      expect(blok, `${svc} musí být na síti mesh-dns (brána routy i mesh DNS)`).toMatch(/mesh-dns/);
      expect(blok, `${svc} musí dostat rozsah peerů`).toContain("NETBIRD_PEER_CIDR");
      const routa = /_mesh="\$\$\(echo[\s\S]*?esac/.exec(blok as string)?.[0];
      expect(routa, `${svc} nestaví routu do mesh — bez ní míří vnitřní jméno VEN`).toBeTruthy();
      // Služba, která MESH_ENABLED deklaruje povinně (`:?`), nese kanon bez mrtvého
      // fallbacku — týž tvar jako n8n níž; porovnává se proto po jeho odstranění.
      bloky.push((routa as string).replace(/\$\$\{MESH_ENABLED:-[^}]*\}/g, () => "$${MESH_ENABLED}").replace(/\s+/g, " ").trim());
    }
    // JEDEN VLASTNÍK = ROVNOST. Dvě kopie téhož shellu se rozejdou; brána proto
    // tvrdí, že jsou znak po znaku shodné (po normalizaci bílých znaků).
    for (let i = 1; i < bloky.length; i++) {
      expect(bloky[i], `kopie routy v ${volajici[0]} a ${volajici[i]} se ROZEŠLY`).toBe(bloky[0]);
    }
  });

  test("inline routa se shoduje s kanonickým souborem (jeden domov textu)", () => {
    // Text má domov v infra/mesh/mesh-client-route.sh; compose ho nese doslova,
    // jen s compose-escapovaným `$` (`$$`). Porovnává se po de-escapování, takže
    // úprava jedné strany bez druhé bránu shodí.
    const edge = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    const kanon = readFileSync(join(ROOT, "infra/mesh/mesh-client-route.sh"), "utf-8");
    // Mrtvý fallback `${MESH_ENABLED:-…}` u služby, která ho deklaruje povinně
    // (`:?`, držitel dveří, n8n), se nepočítá za rozchod — brána
    // zadny-fallback-nad-identitou ho tam nepustí.
    const jadro = (text: string) =>
      (/_mesh="\$\(echo[\s\S]*?esac/.exec(text.replace(/\$\$/g, "$"))?.[0] ?? "")
        .replace(/\$\{MESH_ENABLED:-[^}]*\}/g, "${MESH_ENABLED}")
        .replace(/\s+/g, " ")
        .trim();
    // ⛔ GENERÁTOR JE JINÝ COMPOSE, ALE TÁŽ POVINNOST. `svc-web-render` se
    // 2026-08-31 přestěhoval z edge do vlastní aplikace (tier: optional), aby
    // jeho pád neshodil veřejnou tvář — a tím vypadl z dohledu téhle brány.
    // Volá přitom mesh jméno stejně jako edge-proxy, takže routu potřebuje
    // stejně: bez ní jméno přeloží a na adresu se nedostane
    // (UND_ERR_CONNECT_TIMEOUT, naměřeno tentýž den).
    const render = readFileSync(
      join(ROOT, "docker-compose.coolify-web-render.yml"),
      "utf-8",
    );
    expect(
      /cap_add:\s*\n\s*-\s*NET_ADMIN/.test(render),
      "svc-web-render volá mesh jméno, ale nemá NET_ADMIN — `ip route` skončí " +
        "na Permission denied a mesh zůstane nedosažitelný",
    ).toBe(true);
    expect(
      jadro(render),
      "svc-web-render nemá inline routu do mesh (nebo se rozešla s kanonickým souborem)",
    ).toBe(jadro(kanon));

    const zCompose = jadro(edge);
    const zeSouboru = jadro(kanon);
    expect(zeSouboru, "kanonický skript nemá rozpoznatelné jádro routy").toBeTruthy();
    expect(zCompose, "compose nemá rozpoznatelné jádro routy").toBeTruthy();
    expect(
      zCompose,
      "inline routa v compose se rozešla s infra/mesh/mesh-client-route.sh — " +
        "text má JEDEN domov; uprav soubor i obě kopie v compose zároveň.",
    ).toBe(zeSouboru);
  });

  test("edge nemá `extra_hosts` na mesh jméno — /etc/hosts přebíjí mesh DNS", () => {
    // ⛔ NAMĚŘENO 2026-08-21. edge-proxy měl:
    //     extra_hosts:
    //       - "${API_DOMAIN}:${BACKEND_LAN_IP:-host-gateway}"
    // Při MESH_ENABLED=true je API_DOMAIN mesh jméno, takže do /etc/hosts šlo
    //     10.100.0.1  <prefix>-api.mesh.<tld>
    // a statický záznam PŘEBIL mesh DNS: `nslookup` vracel správný peer
    // (100.106.x), ale spojení šlo na host-gateway → `connection refused`
    // → 502 na api i ask. Dvě odpovědi na jedno jméno, a vyhrála ta špatná.
    //
    // Měří se VLASTNOST: žádná služba edge stacku nesmí mít `extra_hosts`
    // záznam, jehož jméno pochází z proměnné končící `_DOMAIN` (ta je při
    // zapnuté mesh překryta mesh zónou). Výjimka je `NETBIRD_MESH_HOST` —
    // řídicí rovina mesh je bootstrap závislost a k té se JDE napřímo, jinak
    // by mesh potřebovala mesh, aby mohla vzniknout.
    const edge = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    const zavadne: string[] = [];
    for (const m of edge.matchAll(/^\s*-\s*"\$\{([A-Z0-9_]+)(?::-[^}]*)?\}:[^"]*"\s*$/gm)) {
      const jmeno = m[1];
      if (!/_DOMAIN$/.test(jmeno)) continue;      // jiné extra_hosts neřešíme
      if (/^NETBIRD_/.test(jmeno)) continue;      // bootstrap závislost mesh
      zavadne.push(m[0].trim());
    }
    expect(
      zavadne,
      [
        "Edge stack má statický /etc/hosts záznam na jméno, které je při zapnuté",
        "mesh v mesh zóně:",
        ...zavadne.map((r) => `  - ${r}`),
        "",
        "Statický záznam PŘEBÍJÍ mesh DNS a pošle provoz mimo mesh, zatímco",
        "`nslookup` téhož jména vrací správný peer. Vada bez příznaku v DNS.",
        "",
        "CO S TÍM: mesh jméno se řeší mesh DNS (resolver na mesh-routeru).",
        "  Kdo potřebuje bootstrap závislost (netbird management), tomu patří",
        "  vlastní `NETBIRD_*` zápis — ten je výjimka a je tak pojmenovaný.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("rozsah peerů má JEDINÝ domov a compose ho neopisuje", () => {
    const edge = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    const skript = readFileSync(join(ROOT, "infra/mesh/mesh-client-route.sh"), "utf-8");
    // Literál CGNAT rozsahu smí být jen v derive-subnets.mjs (a v komentářích).
    const literal = /\b100\.64\.0\.0\/10\b/;
    const radkyCompose = edge.split("\n").filter((l) => literal.test(l) && !/^\s*#/.test(l));
    const radkySkript = skript.split("\n").filter((l) => literal.test(l) && !/^\s*#/.test(l));
    expect(
      [...radkyCompose, ...radkySkript],
      "Rozsah peerů se nesmí opisovat — jediný domov je NETBIRD_PEER_CIDR " +
        "(scripts/lib/derive-subnets.mjs), doručený jako proměnná.",
    ).toEqual([]);
  });

  test("oauth2-proxy před službou míří na TUTÉŽ lane jako zbytek mesh", () => {
    // ⛔ NAMĚŘENO 2026-08-22, a stálo to majitele další hodinu 502.
    // `extranet-auth` měl v compose natvrdo
    //     OAUTH2_PROXY_UPSTREAMS: ${EXTRANET_UPSTREAM_PUBLIC}
    // tedy `https://<jméno>` BEZ PORTU — i při zapnuté mesh. Mesh-ingress TLS
    // neterminuje a na 443 nikdo neposlouchá, takže KAŽDÉ přihlášení skončilo
    // `502 Bad Gateway` od oauth2-proxy.
    //
    // ⭐ Nejzrádnější na tom bylo MĚŘENÍ: ruční sonda zevnitř kontejneru na
    // `http://<jméno>:8080` procházela, protože měřila JINOU CESTU než tu,
    // kterou jde brána. Zelené měřidlo nad špatnou cestou je horší než žádné.
    //
    // Vlastnost: kde je oauth2-proxy branou veřejné tváře, nesmí mít upstream
    // připnutý na jednu lane — musí ho vybrat podle MESH_ENABLED, stejně jako
    // edge-proxy.
    const edge = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    const blok = /\n {2}extranet-auth:[\s\S]*?(?=\n {2}[a-z0-9-]+:\n|\nvolumes:|\nnetworks:|\nsecrets:|$)/.exec(edge)?.[0];
    expect(blok, "edge compose nemá službu extranet-auth").toBeTruthy();

    expect(
      blok,
      "OAUTH2_PROXY_UPSTREAMS nesmí být v `environment:` připnutý na jednu lane — " +
        "vybírá ho entrypoint podle MESH_ENABLED",
    ).not.toMatch(/^\s+OAUTH2_PROXY_UPSTREAMS:/m);
    expect(blok, "entrypoint musí větvit podle MESH_ENABLED").toMatch(/MESH_ENABLED/);
    expect(blok, "mesh větev musí použít EXTRANET_UPSTREAM_MESH").toMatch(/OAUTH2_PROXY_UPSTREAMS="\$\$\{EXTRANET_UPSTREAM_MESH\}"/);
    expect(blok, "veřejná větev musí použít EXTRANET_UPSTREAM_PUBLIC").toMatch(/OAUTH2_PROXY_UPSTREAMS="\$\$\{EXTRANET_UPSTREAM_PUBLIC\}"/);
    // Bez ústupu: vyhlášená mesh + prázdná mesh lane = konec, ne tichý pád zpět
    // na veřejnou cestu (ta by šla mimo mesh a nikdo by si toho nevšiml).
    expect(blok, "prázdná mesh lane při zapnuté mesh musí službu ZASTAVIT (exit 64)").toMatch(/EXTRANET_UPSTREAM_MESH:-[\s\S]*?exit 64/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ NAMĚŘENO 2026-09-06: KONZUMENT MESH DNS BEZ ROUTY JE HORŠÍ NEŽ BEZ MESHE.
//
// `veřejná adresa WS brány` vracelo 502, protože `ws-gateway` nepřeložil jméno
// sdílené redis (`EAI_AGAIN`). Při hledání příčiny se ukázalo, že mesh má DVĚ
// půlky a obě se rozvážejí zvlášť:
//
//   1. RESOLVER na stroji (mesh-router, pin .250) — hlídá brána
//      `kazdy-stroj-ma-resolver`;
//   2. ROUTA do rozsahu peerů v netns KONZUMENTA — hlídá tahle.
//
// Změřeno na Talosu na kontejneru `web`, který má první a nemá druhou:
//     getent hosts <prefix>-postgrest.mesh.<mesh_tld> → <mesh IP peeru>   (přeloží)
//     nc -z <mesh IP peeru> 3000       → NEDOSAZITELNE     (nespojí)
//
// Samotný resolver tedy vyrobí jméno, které se přeloží a nefunguje — a to je
// horší výchozí stav než dnešek: `EAI_AGAIN` selže hned, kdežto nedosažitelná
// adresa visí na timeoutu, kde ji nikdo nespojí s DNS.
//
// Sčítání níž je RÁČNA, ne verdikt: převod 73 služeb je rollout na několik vln
// a zamknout ho na nulu by znamenalo buď stát, nebo bránu obejít. Číslo smí jen
// KLESAT — tím je zbytek práce vidět místo aby mlčel.
describe("mesh — konzument mesh DNS má i routu do rozsahu peerů", () => {
  const kanon = readFileSync(join(ROOT, "infra/mesh/mesh-client-route.sh"), "utf-8");
  const jadroRouty = (text: string) =>
    (/_mesh="\$\(echo[\s\S]*?esac/.exec(text.replace(/\$\$/g, "$"))?.[0] ?? "").replace(/\s+/g, " ").trim();

  const composeSoubory = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f));

  type BlokKonzumenta = {
    dns?: unknown;
    cap_add?: string[];
    environment?: Record<string, string>;
    entrypoint?: string[] | string;
    command?: string[] | string;
  };
  type Konzument = { soubor: string; sluzba: string; spousteni: string; blok: BlokKonzumenta };
  const konzumenti: Konzument[] = [];
  for (const soubor of composeSoubory) {
    let j: { services?: Record<string, BlokKonzumenta> } | undefined;
    try { j = parseYaml(readFileSync(join(ROOT, soubor), "utf-8"), { merge: true }); } catch { continue; }
    for (const [sluzba, s] of Object.entries(j?.services ?? {})) {
      const dns = Array.isArray(s?.dns) ? s.dns : s?.dns ? [s.dns] : [];
      if (!dns.some((d: unknown) => /NETBIRD_DNS_IP/.test(String(d)))) continue;
      konzumenti.push({
        soubor,
        sluzba,
        spousteni: ([] as string[]).concat(s.entrypoint ?? [], s.command ?? []).join(" "),
        blok: s,
      });
    }
  }

  const sRoutou = konzumenti.filter((k) => /ip route replace/.test(k.spousteni));
  const bezRouty = konzumenti.filter((k) => !/ip route replace/.test(k.spousteni));

  test("detekce konzumentů něco našla (jinak brána mlčí jako by bylo čisto)", () => {
    expect(konzumenti.length, "žádný konzument mesh DNS — detekce se rozešla se skutečností").toBeGreaterThan(20);
  });

  test.each(["ws-gateway", "event-worker", "svc-ide-context"])(
    "realtime/%s: routa, NET_ADMIN a zahození práv",
    (jmeno: string) => {
      const k = konzumenti.find((x) => x.soubor.includes("realtime") && x.sluzba === jmeno);
      expect(k, `realtime nemá službu ${jmeno}`).toBeTruthy();
      expect(k!.blok.cap_add ?? [], `${jmeno} bez NET_ADMIN — ip route skončí na Permission denied`).toContain("NET_ADMIN");
      expect(String(k!.blok.environment?.NETBIRD_PEER_CIDR ?? ""), `${jmeno} nedostal rozsah peerů`).toContain("NETBIRD_PEER_CIDR");
      expect(jadroRouty(k!.spousteni), `${jmeno} se rozešel s infra/mesh/mesh-client-route.sh`).toBe(jadroRouty(kanon));
      // Root je jen na tu jednu routu. Kdyby entrypoint práva nezahodil, běžela
      // by celá služba jako root — cena za mesh, kterou nikdo nechtěl zaplatit.
      expect(k!.spousteni, `${jmeno} nezahazuje práva — služba by běžela jako root`).toMatch(/exec su-exec node /);
    },
  );

  test.each(["n8n", "n8n-worker"])(
    "orchestration/%s: routa, NET_ADMIN, zahození práv a API přes odvozenou mesh lane",
    (jmeno: string) => {
      // ⛔ NAMĚŘENO 2026-09-14 (<fork>): n8n se přeložilo jméno API na mesh IP
      // jádra a spojení vypršelo — netns bez routy do rozsahu peerů. A i s routou
      // by mířilo `https://<mesh jméno>` na 443, kde mesh-ingress jádra neposlouchá
      // (poslouchá http :3001; holá IP 421, TLS „wrong version number").
      const k = konzumenti.find((x) => x.soubor.includes("coolify-n8n") && x.sluzba === jmeno);
      expect(k, `orchestration nemá službu ${jmeno}`).toBeTruthy();
      const env = k!.blok.environment as unknown;
      const envText = Array.isArray(env) ? env.join("\n") : Object.entries((env ?? {}) as Record<string, string>).map(([a, b]) => `${a}=${b}`).join("\n");
      expect(k!.blok.cap_add ?? [], `${jmeno} bez NET_ADMIN — ip route skončí na Permission denied`).toContain("NET_ADMIN");
      expect(envText, `${jmeno} nedostal rozsah peerů`).toMatch(/NETBIRD_PEER_CIDR=\$\{NETBIRD_PEER_CIDR/);
      // Kanon nese `${MESH_ENABLED:-false}`; n8n hodnotu DEKLARUJE povinně (`:?`), takže
      // fallback je mrtvý a brána zadny-fallback-nad-identitou ho nepustí. Porovnává se
      // tedy kanon s deklarovanou hodnotou — a deklarace sama se tvrdí o řádek níž.
      const bezMeshFallbacku = (t: string) => t.replace(/\$\{MESH_ENABLED:-[^}]*\}/g, "${MESH_ENABLED}");
      expect(envText, `${jmeno} nedeklaruje MESH_ENABLED povinně — bez :? by prázdná hodnota tiše vypnula routu`).toMatch(/MESH_ENABLED=\$\{MESH_ENABLED:\?/);
      expect(jadroRouty(k!.spousteni), `${jmeno} se rozešel s infra/mesh/mesh-client-route.sh`).toBe(bezMeshFallbacku(jadroRouty(kanon)));
      // Obraz n8nio/n8n nemá su-exec a BusyBox setpriv neumí --reuid; `--` je nutné,
      // jinak BusyBox su sežere argumenty n8n začínající pomlčkou (naměřeno: --version).
      expect(k!.spousteni, `${jmeno} nezahazuje práva — n8n by běželo jako root`).toMatch(/exec su -p -s \/bin\/sh -c .* -- node /);
      // Adresa API v mesh režimu je ODVOZENÁ lane (derive-domains → API_UPSTREAM_MESH,
      // http + port), ne ruční hodnota z trezoru.
      expect(envText, `${jmeno} nedostává odvozenou API_UPSTREAM_MESH`).toMatch(/API_UPSTREAM_MESH=\$\{API_UPSTREAM_MESH/);
      expect(k!.spousteni.replace(/\$\$/g, "$"), `${jmeno} v mesh režimu nemíří na API_UPSTREAM_MESH`).toMatch(/export AISHA_API_URL="\$\{API_UPSTREAM_MESH\}"/);
      expect(k!.spousteni.replace(/\$\$/g, "$"), `${jmeno}: workflows čtou AISHA_POSTGREST_URL — musí být táž adresa`).toMatch(/export AISHA_POSTGREST_URL="\$\{AISHA_API_URL\}"/);
      expect(envText, `${jmeno} bere AISHA_POSTGREST_URL z trezoru — ruční hodnota přebije odvozenou`).not.toMatch(/AISHA_POSTGREST_URL=\$\{AISHA_POSTGREST_URL/);
    },
  );

  test("ráčna: konzumentů BEZ routy smí jen ubývat (2026-09-06: 73 ze 79; 2026-09-14: 71 — n8n, n8n-worker; ve forku 70 — + gateway)", () => {
    // Klesne-li číslo, SNIŽ ho tady — jinak ráčna povolí návrat zpět.
    // 2026-09-14: 69 — routu dostaly gateway jádra a storage-auth; 2026-09-15: 68 — svc-mcp-knowledge.
    // 2026-09-15: 67 — svc-knock přešel do netns držitele, který routu staví (změřeno po slití s mainem).
    // 2026-09-16: 48 — routu dostalo 19 služeb, které míří na mesh ADRESU (brána níž
    //   „mesh adresa z derivace ⇒ routa“); zbytek jméno z mesh DNS nevolá.
    const STROP = 48;
    expect(
      bezRouty.length,
      `konzumentů mesh DNS bez routy: ${bezRouty.length} (strop ${STROP}).\n` +
        (bezRouty.length > STROP
          ? `PŘIBYL konzument bez routy — přeloží jméno a nespojí se:\n  ` +
            bezRouty.map((k) => `${k.soubor}/${k.sluzba}`).join("\n  ")
          : `Ubylo — sniž STROP na ${bezRouty.length}.`),
    ).toBeLessThanOrEqual(STROP);
    expect(sRoutou.length, "žádný konzument routu nestaví — vzor se vytratil").toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mesh TCP jméno ⇒ routa. VLASTNOST nad všemi compose soubory, ne výčet služeb.
//
// ⛔ NAMĚŘENO 2026-09-14 (výpadek přihlášení celé instance): gateway jádra
// ztratila při slučování forku do upstreamu (07805c921) blok s routou, NET_ADMIN
// a su-exec — brána výše hlídala jen vyjmenované služby edge/realtime, gateway
// v žádném výčtu nebyla. AISHA_SHARED_REDIS_URL přitom míří na MESH jméno
// (katalog internal_tcp_endpoints), takže kontrola odvolání JWT čekala na Redis
// do timeoutu a každý přihlášený požadavek skončil 401 po 10–20 s.
//
// Univerzum je katalog: `internal_tcp_endpoints[].env_aliases` jsou mesh jména
// (TCP nemá Host, mesh-ingress je nerozvede). Kdo takovou proměnnou použije,
// musí mít routu do rozsahu peerů, NET_ADMIN a zahodit práva.
// ─────────────────────────────────────────────────────────────────────────────

/** Známý dluh (naměřeno 2026-09-14) — smí jen ubývat. Každá položka je tichá vada. */
const MESH_TCP_BEZ_ROUTY_DLUH: string[] = [
  // Prázdný (2026-09-15): svc-mcp-knowledge dostal routu (#983), svc-knock netns držitele.
];

function meshTcpAliasy(): string[] {
  const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8"));
  const aliasy = new Set<string>();
  const projdi = (o: unknown, vTcp: boolean): void => {
    if (Array.isArray(o)) return o.forEach((x) => projdi(x, vTcp));
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === "internal_tcp_endpoints") projdi(v, true);
      else if (k === "env_aliases" && vTcp && Array.isArray(v)) v.forEach((a) => typeof a === "string" && aliasy.add(a));
      else projdi(v, vTcp);
    }
  };
  projdi(katalog, false);
  return [...aliasy].sort();
}

describe("mesh TCP jméno ⇒ routa (vlastnost nad compose)", () => {
  const aliasy = meshTcpAliasy();
  const konzumenti: { klic: string; routa: boolean; netAdmin: boolean; suExec: boolean; drzitel?: string }[] = [];
  for (const soubor of readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f)).sort()) {
    const yaml = readFileSync(join(ROOT, soubor), "utf-8");
    // ⛔ 2026-09-17: routa a NET_ADMIN se měřily regexem nad TEXTEM bloku služby —
    // n8n i n8n-worker je dědí přes merge klíč `<<: *n8n-mesh-client`, v textu
    // bloku nejsou, a brána hlásila „bez routy" u služeb, které routu staví.
    // Síťové vlastnosti se proto čtou z PARSOVANÉ služby (merge klíče rozvinuté).
    const dok = parseYaml(yaml, { merge: true }) as {
      services?: Record<string, { cap_add?: string[]; entrypoint?: unknown; command?: unknown; network_mode?: string }>;
    };
    const bloky = new Map<string, string>();
    for (const [, jmeno, blok] of yaml.matchAll(/\n {2}([a-z0-9-]+):\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|\n[a-z]+:\n|$)/g)) {
      bloky.set(jmeno, blok);
    }
    for (const [jmeno, blok] of bloky) {
      if (!aliasy.some((a) => new RegExp(`\\$\\{${a}[:}]`).test(blok))) continue;
      // ⭐ VLASTNOST, NE VÝJIMKA (2026-09-15): konzument v netns DRŽITELE
      // (`network_mode: "service:<držitel>"`) nemá vlastní síťový stack — routu
      // i NET_ADMIN nese držitel. Měří se tedy netns, ve kterém spojení vzniká.
      // Tak svc-knock drží beze změny obrazu `cap_drop: ALL` a `USER node`.
      const drzitel = /^service:([a-z0-9-]+)$/.exec(dok.services?.[jmeno]?.network_mode ?? "")?.[1];
      const sit = dok.services?.[drzitel ?? jmeno] ?? {};
      konzumenti.push({
        klic: `${soubor}:${jmeno}`,
        routa: /ip route replace/.test(JSON.stringify([sit.entrypoint ?? null, sit.command ?? null])),
        netAdmin: (sit.cap_add ?? []).includes("NET_ADMIN"),
        suExec: /exec su-exec node /.test(blok),
        ...(drzitel ? { drzitel } : {}),
      });
    }
  }

  test("katalog nese mesh TCP aliasy a compose je používá (jinak brána měří prázdno)", () => {
    expect(aliasy).toContain("SHARED_REDIS_HOST");
    expect(konzumenti.map((k) => k.klic)).toContain("docker-compose.coolify.yml:gateway");
  });

  test("svc-knock: routu a NET_ADMIN nese držitel netns, sám zůstává bez práv", () => {
    // Dveře míří na mesh Redis (mapa zaťukaných). Bez routy v netns se jméno
    // přeloží a nespojí — knock by nikomu nic neotevřel a /ready by to mělo říct.
    const k = konzumenti.find((x) => x.klic === "docker-compose.coolify-prebuilt.yml:svc-knock");
    expect(k, "svc-knock už nemíří na mesh TCP jméno — detekce oslepla").toBeTruthy();
    expect(k!.drzitel, "svc-knock nesdílí netns držitele").toBe("svc-knock-netns");
    expect(k).toMatchObject({ routa: true, netAdmin: true });
    const edge = readFileSync(join(ROOT, "docker-compose.coolify-prebuilt.yml"), "utf-8");
    const blok = /\n {2}svc-knock:\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|\n[a-z]+:\n|$)/.exec(edge)?.[1] ?? "";
    expect(blok, "svc-knock sám NET_ADMIN mít nesmí — ten patří držiteli").not.toMatch(/NET_ADMIN/);
    expect(blok, "svc-knock drží cap_drop ALL").toMatch(/cap_drop:\s*\["ALL"\]/);
    expect(blok, "svc-knock drží no-new-privileges").toMatch(/no-new-privileges:true/);
    expect(blok, "svc-knock drží read_only").toMatch(/read_only:\s*true/);
    expect(blok, "síť, porty i dns patří držiteli, ne kontejneru v jeho netns").not.toMatch(/^\s+(networks|ports|dns|expose):/m);
    const drzitel = /\n {2}svc-knock-netns:\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|\n[a-z]+:\n|$)/.exec(edge)?.[1] ?? "";
    expect(drzitel, "držitel bez fallbacku MESH_ENABLED ho musí deklarovat povinně — prázdno by tiše vypnulo routu").toMatch(/MESH_ENABLED: \$\{MESH_ENABLED:\?/);
  });

  test("gateway jádra: routa, NET_ADMIN a zahození práv (bez nich výpadek přihlášení)", () => {
    const g = konzumenti.find((k) => k.klic === "docker-compose.coolify.yml:gateway")!;
    expect(g, "gateway míří na mesh Redis bez routy — kontrola odvolání JWT vyprší, každý přihlášený dostane 401").toMatchObject({
      routa: true,
      netAdmin: true,
      suExec: true,
    });
  });

  test("nový konzument mesh TCP jména bez routy nepřibude; opravený se z dluhu odebere", () => {
    const bezRouty = konzumenti.filter((k) => !(k.routa && k.netAdmin)).map((k) => k.klic).sort();
    expect(
      bezRouty,
      "Služba míří na mesh jméno z internal_tcp_endpoints bez routy do rozsahu peerů: jméno se přeloží\n" +
        "a NESPOJÍ (timeout, ne chyba). Přidej NET_ADMIN + `ip route replace $NETBIRD_PEER_CIDR via $NETBIRD_DNS_IP`\n" +
        "+ `exec su-exec node …` (vzor: gateway v docker-compose.coolify.yml). Opravenou položku smaž z MESH_TCP_BEZ_ROUTY_DLUH.",
    ).toEqual([...MESH_TCP_BEZ_ROUTY_DLUH].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mesh ADRESA z derivace ⇒ routa. VLASTNOST nad všemi compose soubory.
//
// ⛔ NAMĚŘENO 2026-09-16 na guru (po naplnění mesh DNS zóny): svc-ai-chat přeložil
// `aisha-postgrest.mesh…`, `aisha-mcp-knowledge.mesh…`, `aisha-model.mesh…`,
// `aisha-companion.mesh…` i `aisha-integration.mesh…` na mesh IP — a VŠECHNO
// vypršelo, protože netns služby routu do rozsahu peerů neměl. Brána výše hlídala
// jen TCP aliasy z katalogu; HTTP adresy (`POSTGREST_URL`, `VLLM_GENERATION_URL`…)
// neviděla, a takových služeb bylo 21. Mozek instance tak nemluvil s ničím.
//
// Univerzum je DERIVACE: každý klíč, jehož hodnota míří do mesh zóny. Kdo ho
// použije jako `${KLÍČ}` (ne `$${…}` — to je běhová proměnná kontejneru), musí mít
// routu a NET_ADMIN ve svém netns (vlastním, nebo držitele `network_mode: service:`).
// Mesh peery (obraz NetBird) routu nepotřebují — jsou mesh.
// ─────────────────────────────────────────────────────────────────────────────

/** Hodnota bez spojení — služba adresu jen ZAPISUJE jinam; jméno a důvod jsou povinné. */
const MESH_ADRESA_JEN_HODNOTA: Record<string, { klice: string[]; proc: string }> = {
  "docker-compose.coolify.yml:migrate": {
    klice: ["VLLM_GENERATION_URL"],
    proc: "migrate adresu jen zapíše do ai_provider_registry (reconcile-local-model-provider.sql); spojení vede ai-chat",
  },
};

type SluzbaCompose = {
  image?: unknown;
  network_mode?: unknown;
  cap_add?: unknown;
  environment?: unknown;
  entrypoint?: unknown;
  command?: unknown;
};

export function konzumentiMeshAdresBezRouty(
  soubory: Array<{ soubor: string; text: string }>,
  meshKlice: string[],
  jenHodnota: Record<string, { klice: string[] }> = {},
): string[] {
  const vadne: string[] = [];
  for (const { soubor, text } of soubory) {
    let doc: { services?: Record<string, SluzbaCompose> } | undefined;
    try { doc = parseYaml(text, { merge: true }); } catch { continue; }
    const sluzby = doc?.services ?? {};
    for (const [jmeno, s] of Object.entries(sluzby)) {
      if (/IMAGE_NETBIRD/.test(String(s?.image ?? ""))) continue;
      const pouziti = JSON.stringify({ e: s?.environment, p: s?.entrypoint, c: s?.command }).replace(/\$\$\{/g, "RUNTIME{");
      const vyjimka = jenHodnota[`${soubor}:${jmeno}`]?.klice ?? [];
      const klice = meshKlice.filter((k) => !vyjimka.includes(k) && new RegExp(`\\$\\{${k}[:}?-]`).test(pouziti));
      if (klice.length === 0) continue;
      const drzitel = /^service:(.+)$/.exec(String(s?.network_mode ?? ""))?.[1];
      const sit = drzitel ? sluzby[drzitel] : s;
      const routa = /ip route replace/.test(JSON.stringify({ p: sit?.entrypoint, c: sit?.command }));
      const netAdmin = Array.isArray(sit?.cap_add) && (sit!.cap_add as unknown[]).includes("NET_ADMIN");
      if (!(routa && netAdmin)) vadne.push(`${soubor}:${jmeno} ← ${klice.join(", ")}`);
    }
  }
  return vadne.sort();
}

describe("mesh adresa z derivace ⇒ routa do rozsahu peerů (vlastnost nad compose)", () => {
  // Univerzum = VŠECHNY lane, i opt-in (provision_when_env): jinak by služba za
  // vypnutou lane (lokální model bez CHAT_GGUF_URL) vypadla z měření a její mesh
  // adresa by nikoho nezavazovala. Podmínky se berou z katalogu, ne z výčtu.
  const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8")) as { services: Record<string, { provision_when_env?: string | string[] }> };
  const podminky = [...new Set(Object.values(katalog.services).flatMap((s) => [s.provision_when_env ?? []].flat()))];
  const puvodni = Object.fromEntries(podminky.map((k) => [k, process.env[k]]));
  let topo: { mesh_tld: string };
  let vystup: string;
  try {
    for (const k of podminky) process.env[k] = "https://sonda.invalid/zapnuto";
    topo = buildTopology({ profileId: "cloud-multi", meshEnabled: true }) as { mesh_tld: string };
    vystup = formatShellExports(topo as never) as string;
  } finally {
    for (const [k, v] of Object.entries(puvodni)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const meshKlice = [...vystup.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)]
    .filter(([, , v]) => new RegExp(`^'?[a-z]+s?://[^/'\\s]*\\.${topo.mesh_tld.replace(/\./g, "\\.")}(?=[:/'\\s]|$)`).test(v))
    .map(([, k]) => k);
  const soubory = readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f))
    .map((soubor) => ({ soubor, text: readFileSync(join(ROOT, soubor), "utf-8") }));

  test("univerzum není prázdné — derivace vydává mesh adresy a compose je používá", () => {
    expect(meshKlice.length, "derivace nevydala žádnou mesh adresu — sonda by mlčela").toBeGreaterThan(20);
    expect(meshKlice).toContain("POSTGREST_URL");
    expect(meshKlice).toContain("VLLM_GENERATION_URL");
  });

  test("žádná služba nemíří na mesh adresu bez routy a NET_ADMIN", () => {
    expect(
      konzumentiMeshAdresBezRouty(soubory, meshKlice, MESH_ADRESA_JEN_HODNOTA),
      "Služba míří na mesh jméno bez routy do rozsahu peerů — jméno se PŘELOŽÍ a NESPOJÍ (timeout,\n" +
        "ne chyba). Vzor: gateway v docker-compose.coolify.yml (cap_add NET_ADMIN + `ip route replace\n" +
        "$${NETBIRD_PEER_CIDR:?} via $${NETBIRD_DNS_IP:?}` + `exec su-exec node …`), obraz bez `USER node`\n" +
        "s `su-exec iproute2`. Obraz bez `ip` → držitel netns (vzor ingest-drop-push-netns).",
    ).toEqual([]);
  });

  test("výjimka jen-hodnota nese důvod a klíč, který služba skutečně používá", () => {
    for (const [kde, v] of Object.entries(MESH_ADRESA_JEN_HODNOTA)) {
      expect(v.proc.length, `${kde}: výjimka bez důvodu`).toBeGreaterThan(20);
      const [soubor, sluzba] = kde.split(":");
      const doc = parseYaml(readFileSync(join(ROOT, soubor), "utf-8"), { merge: true }) as { services: Record<string, SluzbaCompose> };
      const text = JSON.stringify(doc.services[sluzba]?.environment ?? {});
      for (const k of v.klice) expect(text, `${kde}: výjimka pro ${k}, který služba nepoužívá — mrtvá výjimka`).toContain(`\${${k}`);
    }
  });

  test("negativní sonda: služba s ${POSTGREST_URL} bez routy se chytí; s routou, v netns držitele i jako $${…} ne", () => {
    const bez = `services:\n  a:\n    image: x\n    environment:\n      POSTGREST_URL: \${POSTGREST_URL:?x}\n`;
    const s = `services:\n  a:\n    image: x\n    cap_add: [NET_ADMIN]\n    entrypoint: ["/bin/sh","-c","ip route replace a via b"]\n    environment:\n      POSTGREST_URL: \${POSTGREST_URL:?x}\n`;
    const drz = `services:\n  h:\n    image: y\n    cap_add: [NET_ADMIN]\n    entrypoint: ["/bin/sh","-c","ip route replace a via b"]\n  a:\n    image: x\n    network_mode: "service:h"\n    environment:\n      POSTGREST_URL: \${POSTGREST_URL:?x}\n`;
    const beh = `services:\n  a:\n    image: x\n    entrypoint: ["/bin/sh","-c","echo $\${POSTGREST_URL}"]\n`;
    const peer = `services:\n  a:\n    image: \${IMAGE_NETBIRD}\n    environment:\n      NB: \${POSTGREST_URL}\n`;
    expect(konzumentiMeshAdresBezRouty([{ soubor: "t.yml", text: bez }], ["POSTGREST_URL"])).toEqual(["t.yml:a ← POSTGREST_URL"]);
    expect(konzumentiMeshAdresBezRouty([{ soubor: "t.yml", text: s }], ["POSTGREST_URL"])).toEqual([]);
    expect(konzumentiMeshAdresBezRouty([{ soubor: "t.yml", text: drz }], ["POSTGREST_URL"])).toEqual([]);
    expect(konzumentiMeshAdresBezRouty([{ soubor: "t.yml", text: beh }], ["POSTGREST_URL"])).toEqual([]);
    expect(konzumentiMeshAdresBezRouty([{ soubor: "t.yml", text: peer }], ["POSTGREST_URL"])).toEqual([]);
  });
});
