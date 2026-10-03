#!/usr/bin/env node
// gen-mesh-router.mjs — JEDEN zdroj mesh resolveru, vykreslený pro každou roli serveru.
//
//   node scripts/gen-mesh-router.mjs           # zapíše docker-compose.coolify-mesh-router-<slot>.yml
//   node scripts/gen-mesh-router.mjs --check   # jen ověří shodu (brána)
//
// ⛔ NAMĚŘENO 2026-09-06. `veřejná adresa WS brány` vracel 502 a `ws-gateway`
// s `event-worker` byly v crash-loopu na `getaddrinfo EAI_AGAIN` pro
// `<prefix>-shared-redis.mesh.<mesh_tld>`. Příčina NEBYLA
// v realtime stacku:
//
//   · mesh resolver (`mesh-router`, pin .250 na síti mesh-dns) běžel POUZE
//     na Talosu, protože bydlí uvnitř compose `prebuilt` a katalog dává
//     službě `edge` jediné `placement: frontend`;
//   · síť `mesh-dns` si přitom `netinit` zakládá na KAŽDÉM stroji, takže
//     `MESH_DNS_RESOLVER_IP` vypadá jako platná adresa všude — je to ale pin
//     v host-lokální bridge síti, tutéž podsíť má každý stroj vlastní
//     a doroutovat ji meshí nelze (lokální podsíť vždy vyhraje);
//   · na Giahu a Varře tedy adresu NEDRŽEL NIKDO a 48 kontejnerů mířilo
//     `dns:` do prázdna. Docker `dns:` je PŘEBITÍ, ne doplněk: vestavěný
//     127.0.0.11 dál řešil aliasy vlastní sítě, ale všechno ostatní posílal
//     na mrtvý upstream. Proto se vada projevila jako TIMEOUT (EAI_AGAIN),
//     ne jako „takový záznam neexistuje" — a tvářila se jako pomalá síť.
//
// Záznamy v mesh DNS přitom existovaly (z Talosu: ws-gateway → <mesh IP peeru>).
// Nechyběla adresa ani cíl, chyběl ten, kdo se ptá.
//
// ⭐ PROČ GENERÁTOR A NE TŘI RUČNÍ SOUBORY. Resolver je hostitelský singleton:
// jeden na stroj, pinovaný na jednu adresu. Katalog `placement` umí jen jednu
// roli na službu, takže „na každý stroj" se vyjadřuje rozpadem po rolích —
// týmž způsobem, jakým už v katalogu stojí `netinit-backend|frontend|experimental`.
// Tři ručně udržované kopie téhož kontejneru by se rozešly; je to jen otázka
// času (viz brána `mesh-ingress-one-generator`, kde přesně to nastalo). Zdroj
// je proto jeden a soubory jsou VÝSTUP, hlídaný `--check`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDirectRun } from "./lib/cli-entry.mjs";

const ROOT = process.cwd();

// Role, které dostávají VLASTNÍ resolver aplikaci. `frontend` tu chybí záměrně:
// jeho resolver bydlí uvnitř `docker-compose.coolify-prebuilt.yml` (edge stack)
// a běží tam nepřetržitě — vytáhnout ho odtud znamená sáhnout na stack, který
// servíruje veřejný web, takže to je samostatný krok, ne vedlejší účinek téhle
// opravy. Brána `kazdy-stroj-ma-resolver` hlídá OBĚ podoby naráz: každá role,
// která hostí konzumenty, musí mít právě jeden pin — ať vlastní, nebo vestavěný.
export const SLOTY_S_VLASTNIM_ROUTEREM = ["backend", "experimental"];

export const souborProSlot = (slot) => `docker-compose.coolify-mesh-router-${slot}.yml`;

export function vykresliMeshRouter(slot) {
  const SLOT = slot.toUpperCase();
// ⛔ VÝKLAD ŽIJE TADY, NE VE VÝSTUPU. Compose jde na server jako ARGUMENT
// PŘÍKAZU a soutěží s ARG_MAX, takže vygenerovaný soubor nese konfiguraci a
// jedno varování — nic víc. (Brána `compose-nese-konfiguraci-ne-prozu`.)
//
// Mesh resolver = hostitelský singleton. Drží pinovanou adresu na síti mesh-dns
// (`MESH_DNS_RESOLVER_IP`), na kterou míří `dns:` všech kontejnerů na TOMTO
// stroji, a předává jejich dotazy do meshe přes vlastní netbird agenta.
//
// Healthcheck je levný a POCTIVÝ: proces sám o sobě nic nedokazuje, adresa
// 100.x na wt0 ano.
  return `# GENEROVÁNO scripts/gen-mesh-router.mjs — NEUPRAVUJ RUČNĚ (role \`${slot}\`).
# Změnu prováděj v generátoru a spusť: node scripts/gen-mesh-router.mjs
services:
  pki-init:
    build:
      context: .
      dockerfile: Dockerfile.pki-init
    container_name: \${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-mesh-router-pki-init
    restart: "no"
    environment:
      PKI_BRIDGE_URL: \${PKI_BRIDGE_URL:-}
      PKI_BUNDLE_REQUIRED: "false"
      PKI_BUNDLE_WAIT_S: \${PKI_BUNDLE_WAIT_S:-600}
    command: ["/usr/local/bin/assemble-ca-bundle.sh"]
    volumes:
      - pki-certs:/certs/pki
    healthcheck:
      disable: true
    networks:
      - internal

  mesh-router:
    image: \${IMAGE_NETBIRD}
    container_name: \${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-mesh-router
    restart: unless-stopped
    init: true
    cap_add:
      - NET_ADMIN
      - SYS_RESOURCE
    devices:
      - /dev/net/tun:/dev/net/tun
    sysctls:
      net.ipv4.ip_forward: "1"
      net.ipv4.conf.all.forwarding: "1"
    volumes:
      - mesh-router-data:/etc/netbird
      - mesh-router-data:/var/lib/netbird
      - pki-certs:/certs/pki:ro
    depends_on:
      pki-init:
        condition: service_completed_successfully
    networks:
      # Prázdný objekt, NE prázdná hodnota: null položku sítě compose validace pustí, ale
      # Coolify ji při nasazení ZAHODÍ — kontejner na síti prostě není a nikde
      # to nestojí (pki-bridge 2026-08-13: Traefik 504, mesh-dns osiřelá).
      internal: {}
      mesh-dns:
        # Pin. Bez něj by adresa churnovala s každým restartem a \`dns:\`
        # konzumentů by ukazovalo na cizí kontejner nebo do prázdna.
        ipv4_address: \${MESH_DNS_RESOLVER_IP:?vydává generate-secrets; coolify-sync-envs doručuje}
    extra_hosts:
      - "\${NETBIRD_MESH_HOST}:\${NETBIRD_MGMT_HOST:-host-gateway}"
      - "\${NETBIRD_DOMAIN}:host-gateway"
    environment:
      NB_SETUP_KEY: \${NETBIRD_STACK_KEY_${SLOT}}
      NB_HOSTNAME: ${slot}-mesh-router
      NB_MANAGEMENT_URL: https://\${NETBIRD_MESH_HOST}:\${NETBIRD_MESH_PORT:-33073}
      NB_FORCE_REENROLL: \${NB_FORCE_REENROLL:-0}
      CORE_MESH_IP: \${CORE_MESH_IP:-}
      NB_SSL_TRUST_BUNDLE: /certs/pki/aisha-ca-bundle.pem
      SSL_CERT_FILE: /certs/pki/aisha-ca-bundle.pem
    entrypoint:
      - /bin/sh
      - -c
      - |
        set +e   # Kontejner musí ZŮSTAT NAŽIVU i když dílčí krok selže: dokud
                 # běží, drží pinovanou adresu a jde se ho zeptat proč mlčí.
                 # Mrtvý resolver je k nerozeznání od chybějícího.
        echo "[mesh-router] start (slot=${slot}, hostname=\$\${NB_HOSTNAME})"

        # CORE_MESH_IP není cíl, je to MĚŘIDLO: prázdná hodnota znamená, že peer
        # discovery neproběhla, takže mesh DNS nemá záznamy a vnitřní jména
        # propadnou mimo instanci. Ohlásit to je levné; hádat, proč api padá,
        # stálo hodiny.
        case "\$\${CORE_MESH_IP}" in
          ""|":"*)
            echo "[mesh-router] !!! CORE_MESH_IP je PRÁZDNÉ — peer discovery neproběhla."
            echo "[mesh-router] !!! Náprava: node scripts/coolify-mesh-sync.mjs --apply"
            ;;
        esac

        sysctl -w net.ipv4.ip_forward=1 2>&1 || echo "[mesh-router] WARN sysctl ip_forward selhal"
        iptables -P FORWARD ACCEPT 2>&1 || echo "[mesh-router] WARN policy FORWARD selhala"
        iptables -I FORWARD -j ACCEPT 2>&1 || echo "[mesh-router] WARN insert FORWARD ACCEPT selhal"

        # wt0 má MTU 1280 (WireGuard), eth0 1500. Bez clampu se velké TCP pakety
        # na hranici TIŠE zahazují — spojení se naváže a pak zamrzne.
        iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \\
          -j TCPMSS --clamp-mss-to-pmtu 2>&1 || echo "[mesh-router] WARN MSS clamp selhal"

        # Odchozí provoz přes wt0 maskujeme, aby se odpovědi vrátily přes conntrack.
        iptables -t nat -A POSTROUTING -o wt0 -j MASQUERADE 2>&1 \\
          || echo "[mesh-router] WARN MASQUERADE selhal"

        # ⛔ ŽÁDNÝ DNAT NA PEVNÉ PORTY. Port není adresa: pravidlo klíčované jen
        # portem posílá cizí provoz na jeden cíl (8080 = imgproxy i n8n).
        # Klienti mají ROUTU do rozsahu peerů a míří JMÉNEM; router je hop, ne cíl.

        # ─── DNS forwarder: jakmile je wt0 nahoře, přesměruj dotazy přicházející
        # z bridge sítí na vlastní netbird resolver (wt0:53). Tím se stane tenhle
        # kontejner mesh resolverem pro CELÝ stroj, bez závislosti na host netns.
        (
          _wt0=""
          while [ -z "\$\${_wt0}" ]; do
            _wt0=\$\$(ip -4 -o addr show wt0 2>/dev/null | awk '{print \$\$4}' | cut -d/ -f1 | head -1)
            [ -z "\$\${_wt0}" ] && sleep 2
          done
          echo "[mesh-router] DNS forwarder: :53 -> \$\${_wt0}:53"
          for _p in udp tcp; do
            iptables -t nat -C PREROUTING ! -i wt0 -p \$\${_p} --dport 53 \\
              -j DNAT --to-destination "\$\${_wt0}":53 2>/dev/null \\
            || iptables -t nat -A PREROUTING ! -i wt0 -p \$\${_p} --dport 53 \\
              -j DNAT --to-destination "\$\${_wt0}":53 2>&1 \\
            || echo "[mesh-router] WARN DNS DNAT \$\${_p} selhal"
          done
        ) &

        if [ "\$\${NB_FORCE_REENROLL:-0}" = "1" ]; then
          echo "[mesh-router] NB_FORCE_REENROLL=1 — mažu lokální stav NetBirdu"
          rm -rf /etc/netbird/* 2>/dev/null || true
        fi

        # Zápis do meshe se OPAKUJE DONEKONEČNA. Při studeném startu jede
        # management plane až PO tomhle kontejneru; jediný pokus by skončil
        # „context deadline exceeded" a resolver by nenaběhl do ručního restartu
        # — přesně stav, který nechal mesh potmě po restartu docker démona.
        if [ -n "\$\${NB_SETUP_KEY:-}" ]; then
          _pokus=0
          while true; do
            _pokus=\$\$((_pokus+1))
            # ⛔ NetBird 0.70 NEPÍŠE config.json (naměřeno 2026-09-06) — stav drží
            # default.json + active_profile.json. Podmínka na legacy cestu neplatila
            # NIKDE (6 z 6 agentů), takže se resolver při každém startu zapisoval jako
            # NOVÝ peer: nová mesh IP a osiřelý DNS záznam. U resolveru je to horší
            # než u běžné služby — jeho adresu má v dns: celý stroj.
            _nb_stav=""
            for _f in /etc/netbird/config.json /etc/netbird/default.json /var/lib/netbird/default.json; do
              [ -s "$$_f" ] && { _nb_stav="$$_f"; break; }
            done
            if [ -n "$$_nb_stav" ]; then
              echo "[mesh-router] připojuji se (stav v \$\${_nb_stav}, pokus \$\${_pokus})"
              netbird up --foreground-mode \\
                --management-url "\$\${NB_MANAGEMENT_URL}" \\
                --hostname "\$\${NB_HOSTNAME}" &
            else
              echo "[mesh-router] zapisuji se jako \$\${NB_HOSTNAME} (pokus \$\${_pokus})"
              netbird up --foreground-mode \\
                --management-url "\$\${NB_MANAGEMENT_URL}" \\
                --setup-key "\$\${NB_SETUP_KEY}" \\
                --hostname "\$\${NB_HOSTNAME}" &
            fi
            wait \$\$!
            echo "[mesh-router] netbird skončil — další pokus za 10 s"
            sleep 10
          done
        else
          echo "[mesh-router] WARN: NB_SETUP_KEY je prázdný — běžím naprázdno (bez meshe)"
          exec sleep infinity
        fi
    healthcheck:
      test: ["CMD-SHELL", "ip -o addr show wt0 2>/dev/null | grep -qE 'inet 100\\\\.'"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s
    labels:
      - "coolify.managed=true"
      - "traefik.enable=false"
      - "traefik.docker.network=coolify"

volumes:
  mesh-router-data:
    name: \${APP_NAME_PREFIX:?}_mesh-router-data
  pki-certs:
    name: \${APP_NAME_PREFIX:?}_pki-certs
networks:
  internal:
    external: true
    name: \${APP_NAME_PREFIX:?identita instance}-shared-net
  mesh-dns:
    external: true
    name: \${MESH_DNS_NETWORK:?vydává generate-secrets}
`;
}

// ⛔ CLI běží JEN při přímém spuštění. Bez téhle podmínky by import z brány
// (`kazdy-stroj-ma-resolver.gate.test.ts`) soubory PŘEPSAL a brána by nikdy
// nemohla zčervenat — sama by si drift, který má hlídat, cestou opravila.
// Naměřeno 2026-09-06 při prvním běhu té brány: vypsala „zapsáno …".
// ⛔ CLI ŽIJE VE FUNKCI, ne v modulovém rozsahu. Import z brány
// (`kazdy-stroj-ma-resolver.gate.test.ts`) by jinak soubory PŘEPSAL a brána by
// nemohla zčervenat — sama by si drift, který má hlídat, cestou opravila.
// A `process.exit` při načtení modulu ukončí i toho, kdo si odtud bere jen
// čistou funkci (brána `import-nesmi-zabit-proces`).
// Registr se drží U PARSOVÁNÍ, ne v dokumentaci: přepínač, který někdo přidá
// níž a sem ho nezapíše, tuhle stráž shodí na první použití.
const ZNAME_PREPINACE = new Set(["--check"]);

const NAPOVEDA = `gen-mesh-router — generuje compose mesh-routeru (jeden NA STROJ)

  bez přepínače  ZAPÍŠE vygenerované soubory
  --check        jen ověří shodu, NEZAPISUJE (používá brána)
  --help, -h     tahle nápověda`;

export function main(argv = process.argv) {
  /**
   * ⛔ NEZNÁMÝ PŘEPÍNAČ JE STOP, NE VÝCHOZÍ CHOVÁNÍ. Tenhle nástroj bez
   * přepínače ZAPISUJE. Kdyby překlep („--dry-run", „--checkk") jen propadl,
   * spustil by se zápis místo ověření — a to je pravý opak toho, co člověk
   * chtěl. Mlčky spolknutý přepínač je u zapisujícího nástroje tiché selhání.
   */
  const nezname = argv
    .slice(2)
    .filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a.split("=")[0]) && a !== "--help" && a !== "-h");
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(NAPOVEDA);
    process.exit(0);
  }
  if (nezname.length > 0) {
    console.error(`gen-mesh-router: neznámý přepínač: ${nezname.join(" ")}`);
    console.error(NAPOVEDA);
    process.exit(2);
  }
  const jenOver = argv.includes("--check");
  let neshody = 0;
  for (const slot of SLOTY_S_VLASTNIM_ROUTEREM) {
    const cesta = join(ROOT, souborProSlot(slot));
    const ocekavano = vykresliMeshRouter(slot);
    if (jenOver) {
      let mame = null;
      try { mame = readFileSync(cesta, "utf-8"); } catch { /* chybí */ }
      if (mame !== ocekavano) {
        neshody++;
        console.error(`✗ ${souborProSlot(slot)} ${mame === null ? "CHYBÍ" : "se rozešel s generátorem"}`);
      } else {
        console.log(`✓ ${souborProSlot(slot)}`);
      }
    } else {
      writeFileSync(cesta, ocekavano);
      console.log(`zapsáno ${souborProSlot(slot)}`);
    }
  }
  if (jenOver && neshody > 0) {
    console.error(`\nNáprava: node scripts/gen-mesh-router.mjs`);
    return 1;
  }
  return 0;
}

// Strážce vstupu má JEDEN domov: porovnává soubor (dev+ino), ne zápis cesty —
// symlink nebo jiný tvar téže cesty by u řetězcového porovnání lhal.
if (isDirectRun(import.meta.url)) {
  process.exitCode = main();
}
