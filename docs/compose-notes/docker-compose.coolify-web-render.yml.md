# docker-compose.coolify-web-render.yml — notes

Prose extracted from `docker-compose.coolify-web-render.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

docker-compose.coolify-web-render.yml — generátor statických stránek.

⛔ PROČ VLASTNÍ APLIKACE A NE KONTEJNER V EDGE.

Naměřeno 2026-08-31 ve zdrojích Coolify (`GetContainersStatus.php`):
  $maxRestartCount = restart counts VŠECH kontejnerů aplikace → max()
  if ($maxRestartCount >= $application->max_restart_count)  // = 10
      StopApplication::dispatch(...)                        // compose down CELÉ aplikace

Edge stack nese veškerou veřejnou tvář — `web` drží web.* a corp.*,
`edge-proxy` api.*, auth.*, extra.*, ask.*, companion.*, dirigent.*, live.*
a mcp.*. Kontejner uvnitř edge, který se cyklí, tedy nesundá jen sebe, ale
přihlašování k extranetu i celý web. Dvakrát 2026-08-31 přesně takhle:
jednou `svc-web-artifact` v core, jednou tenhle generátor na edge.

Vyjmutí přes `exclude_from_hc` NESTAČÍ — ovlivňuje jen agregovaný stav,
restarty se počítají bez filtru (tamtéž, ~ř. 162).

Katalog `config/services.json` má tiery `required` / `important` / `optional`,
ale POUZE na úrovni aplikací. Generátor byl nedeklarovaný kontejner uvnitř
aplikace `edge` (tier: required), takže zdědil maximální kritičnost, aniž by
o tom kdo rozhodl. Tady se to napravuje: vlastní aplikace, `tier: optional`.

⛔ PŘEDÁNÍ PO SÍTI, NE PŘES DISK (varianta d-ii, rozhodnutí majitele 2026-10-02).
`web` a generátor jsou DVĚ Coolify aplikace a disk sdílet neumějí: Coolify 4.3.16
holý `${VAR}` ve zdroji svazku převede na pojmenovaný svazek KAŽDÉ aplikace zvlášť
(rozbor 2026-09-28), takže `web` vždy četl prázdný `_static`. Teď:
- generátor drží výstup i skořápku ve VLASTNÍCH svazcích (`web-render-out`,
  `web-render-shell`) a výstup servíruje sám (Fastify :3040, `src/servirovani.ts`);
- `web` si stránky TÁHNE přímo meshem — vlastní routa do rozsahu peerů, nginx
  `upstream` s keepalive a krátkou cache (tvář v meshi: `netbird-agent` +
  `web-render-mesh-ingress`, katalog `internal_url`);
- skořápku `web` při startu POSÍLÁ `PUT /shell` toutéž cestou s vlastním tajemstvím
  `WEB_RENDER_SHELL_TOKEN` (`src/skorapka.ts`, `docker/web-skorapka.sh`).
Podmínka „týž stroj“ tím odpadla.

Když generátor neběží, web se servíruje dál: nginx vydá poslední verzi z cache
(stale-if-error), a co v cache není, padá po krátkém timeoutu na SPA skořápku
(`docker/nginx.conf` `@spa`). Tedy nejhůř dnešní chování — pomalejší první
vykreslení, ale funkční web.

Servírování (`src/servirovani.ts`): globální limit požadavků na výdejních trasách
NEPLATÍ (volá jen Edge; 60/min na klienta by návštěvníkům vracel 429), ETag
a Last-Modified pro levnou revalidaci (304), obrázky jen v přesném tvaru
`<16 hex>.<přípona>`, a 412, když Edge pošle otisk jiné skořápky, než ze které
je výstup (`.skorapka-otisk` ve výstupu přežije restart). Zápisy stránek
i obrázků jsou atomické (dočasný soubor + rename); obrázek se nepřepisuje.
Bez `WEB_RENDER_SHELL_TOKEN` služba NEPADÁ (Coolify by ji po limitu restartů
zastavil i se servírováním) — `PUT /shell` jen odmítá 503 a start to hlasitě hlásí.

⛔ JMÉNA (naměřeno 2026-10-02 bránami při zavádění d-ii):
- Cíl trasy mesh-ingressu skládá derivace z `container_name` služby, kdežto Coolify
  `container_name` přepisuje a živý zůstává jen ALIAS. Proto `svc-web-render` nese
  `container_name` i alias se STEJNÝM jménem `<prefix>-svc-web-render`. Bez
  `container_name` se `WEB_RENDER_MESH_INGRESS_ROUTES` vůbec neodvodilo.
- `netbird-agent` je hostitel netns ingressu a alias cíle mít NESMÍ: ingress by
  cíl přeložil sám na sebe. Proto má jen holý seznam sítí.
- Bloky agenta a ingressu vyrábí `scripts/mesh-conformance-apply.mjs` z kanonického
  vzoru (`docker-compose.coolify-model.yml`). Do 2026-10-02 nástroj míjel identitní
  tvar jmen vzoru a nový stack zdědil jména MODELU (`<prefix>-model--netbird`,
  alias `<prefix>-svc-model`). Opraveno v nástroji.

⛔ `WEB_RENDER_SHELL_TOKEN` je HOLÝ `${VAR}`, ne `${VAR:?}`. Fail-fast `:?`
dělá z proměnné parse-required, a tím ji Coolify pošle i do buildu
(`docker history`), což rohatka build-time tajemství zastavila. Doručení
měří read-back v `coolify-sync-envs.sh` a služba bez tokenu nenaběhne
(`requiredEnv`).

⛔ MESH JMÉNO `<prefix>-web-render.<mesh>` vyrábí fáze F cold-startu
(`netbird-dns-provision.mjs`), stejně jako u ostatních edge→mesh upstreamů.
Na instanci, kde web-render přibyde běžným nasazením, je potřeba konvergence
(`cold-start --skip-create`) nebo `netbird-dns-provision --apply`. Do té doby
Edge servíruje SPA. Jméno PEERU (`frontend-web-render`) se nepoužívá záměrně:
po re-enrollmentu dostane NetBird nový peer s příponou a staré jméno zůstane
na odpojeném peerovi (`scripts/lib/mesh-peers.mjs`).

## `depends_on:`

⛔ AŽ PO CERTIFIKÁTECH. `pki-init` sestaví CA bundle do svazku, ze
kterého generátor níž čte `NODE_EXTRA_CA_CERTS`. Bez téhle podmínky
by první start proběhl s prázdným svazkem a `fetch` na `https://`
padl na ověření certifikátu — tedy přesně to, co tahle dvojice řeší.

## `dns:`

⛔ MESH DNS SE MUSÍ VYŽÁDAT. Bez `dns:` a `dns_search:` se kontejner ptá
výchozího resolveru Dockeru, který mesh jména nezná — služba pak padala
na `getaddrinfo ENOTFOUND <fork>-api.mesh.<fork>.internal`,
přestože NA obou správných sítích byla (naměřeno 2026-08-31 porovnáním
s kontejnerem `web`, který resolver z NETBIRD_DNS_IP nastavený má).
Být na síti a umět v ní přeložit jméno jsou dvě různé věci.

## `MESH_ENABLED: ${MESH_ENABLED:?vydává topologický resolver}`

⛔ ROUTA POTŘEBUJE SVÉ PROMĚNNÉ DEKLAROVANÉ TADY. Ve vloženém skriptu
jsou zapsané escapovaně (`$$${VAR}`), což pro compose NENÍ odkaz na
proměnnou, ale doslovný `$` pro shell kontejneru — takže je
`coolify-sync-envs` nevidí a na aplikaci se nikdy nedostanou.
Naměřeno 2026-08-31: `MESH_ENABLED=<unset>` a `FATAL: chybí
NETBIRD_PEER_CIDR` v běžícím kontejneru, přestože v .env.coolify byly.
Týž zápis jako u extranet-auth.

## `NETBIRD_DNS_IP: ${NETBIRD_DNS_IP:?vydává generate-secrets z MESH_DNS_RESOLVER_IP}`

`dns:` výš je direktiva compose (použije se při vzniku kontejneru);
skript routy potřebuje TUTÉŽ hodnotu ještě jako proměnnou prostředí.

## `WEB_RENDER_API_URL: ${API_UPSTREAM_MESH:?generátor čte publikované stránky přes mesh (s portem); veřejný tvar bez portu míří na 443, kde nikdo neposlouchá}`

⛔ MESH TVAR, NE VEŘEJNÝ. `API_UPSTREAM_PUBLIC` je
`https://<api>.mesh.<tld>` BEZ PORTU, tedy 443 — a tam nikdo
neposlouchá: mesh-ingress rozvádí API na portu SLUŽBY (3001), ne na 443.
Naměřeno 2026-09-01 z kontejneru s mesh routou:
  :443  → „Connection refused"
  :3001 → RPC get_branding_for_hostname vrátilo profil značky
Generátor přitom hlásil jen `TypeError: fetch failed`, takže se hledalo
v DNS, routě a certifikátech — ve třech vrstvách, které byly v pořádku.

`API_UPSTREAM_MESH` vydává táž derivace a nese port i schéma. Edge ho
používá už teď (`docker-compose.coolify-prebuilt.yml`, větev MESH_MODE),
takže tohle není nový kanál — jen se ho konečně drží i generátor.

## `NODE_EXTRA_CA_CERTS: /certs/pki/aisha-ca-bundle.pem`

⛔ DŮVĚRA K NAŠÍ PKI. Adresa výš je `https://` a certifikát vydává
naše vnitřní PKI — Node ji v základní sadě nemá, takže `fetch`
skončí na ověření certifikátu jako `TypeError: fetch failed`.
Naměřeno 2026-08-31: routa do mesh se postavila, jméno se přeložilo,
a přesto služba nenastartovala — chyběla poslední vrstva, důvěra.
Týž zápis jako ws-gateway (realtime) a mesh-router (edge).

## `WEB_RENDER_ANON_KEY: ${VITE_AISHA_BACKEND_ANON_KEY:-}`

⛔ ŽÁDNÉ `:?` U TAJEMSTVÍ. Parse-required stráž uvnitř `environment:`
si hodnotu vynutí do BUILDU — Coolify ji pošle i jako --build-arg
a zapeče do `docker history`. Chybějící hodnotu hlídá fail-closed
`requiredEnv` v config.ts, tedy tam, kde to nic neuniká.
⛔ JMÉNO MUSÍ SEDĚT NA TO, CO INSTANCE DEKLARUJE. Sáhl jsem po
`AISHA_ANON_KEY`, ale ta je v této instanci prázdná (délka 0) —
anonymní klíč se tu jmenuje `VITE_AISHA_BACKEND_ANON_KEY` (165 znaků)
a bere si ho i `web` o pár set řádků výš. Vymyšlené jméno znamená, že
hodnota nikdy nedorazí: generátor pak padal na `chybí WEB_RENDER_ANON_KEY`
v cyklu, což by po dosažení limitu restartů zastavilo CELÝ edge stack
(naměřeno 2026-08-31 — týž mechanismus shodil core).
⛔ ŽÁDNÉ VNOŘENÍ. Napsal jsem sem nejdřív `${AISHA_ANON_KEY:-${VITE_...}}`
jako řetěz deklarací — jenže build-time parser Coolify vnořenou
interpolaci neumí a brána `coolify-compose-compliance` to právem odmítla.
Bere se proto rovnou jméno, které tenhle soubor už používá pro službu
`web` o pár set řádků výš; jedna hodnota, jedno jméno, žádná větev.

## `LOG_LEVEL: info`

Úroveň logování je DEKLARACE, ne dosazení: služba ji vyžaduje
(`requiredEnv`) a bez ní nestartuje, takže se nikdy neloguje jinak,
než co je tady napsané.

## `- web-render-out:/out` a `- web-render-shell:/shell` (od 2026-10-02, d-ii)

Vlastní pojmenované svazky aplikace — Coolify je pojmenuje podle UUID, takže jsou
per instance konstrukcí a nic se nesdílí. `/out` plní generátor, `/shell` zapisuje
jen `PUT /shell` od webu. Vlastnictví srovnává entrypoint (`chown node`).

### Historie: `${WEB_RENDER_STATIC_HOST_DIR}:/out`, `${WEB_RENDER_SHELL_HOST_DIR}:/shell:ro` (2026-09-24 → 10-02)

Hostitelské adresáře instance odvozené z identity, sdílené s `web`. Nefungovalo:
Coolify holý `${VAR}` ve zdroji převedl na svazek každé aplikace zvlášť. Ještě dřív
doslovné `/var/lib/aisha/web-{static,shell}` — sdílené všemi instancemi na stroji
(naměřeno 2026-09-23: renderery dvou instancí psaly do jednoho adresáře).

## `- pki-certs:/certs/pki:ro`

Certifikáty vyrábí `pki-init` níž do SVAZKU TÉTO aplikace: Coolify
pojmenované svazky přepisuje na `<uuid>_<klíč>`, takže sdílet
`pki-certs` s jiným stackem nejde — každý si ho plní sám.

## `cap_add:`

⛔ ROUTA DO MESH SE MUSÍ POSTAVIT, JINAK JMÉNO NESTAČÍ. Kontejner mesh
jméno přeloží (je na síti mesh-dns), ale bez routy do rozsahu peerů se
na tu adresu nedostane — naměřeno 2026-08-31:
`UND_ERR_CONNECT_TIMEOUT` na 100.112.169.100, zatímco `extranet-auth`,
který routu staví, dostal od téže adresy odpověď.

⛔ VLOŽENO DOSLOVA, NE BIND MOUNTEM. Coolify staví na build serveru a na
cílovém uzlu repo NEMÁ; mount souboru z repa proto vyrobí ADRESÁŘ a služba
skončí v restart smyčce (`exit 126`). Shodu s kanonickým
`infra/mesh/mesh-client-route.sh` hlídá brána.

## `restart: unless-stopped`

Ve VLASTNÍ aplikaci je neomezený restart bezpečný: `StopApplication`
po dosažení limitu zastaví jen tuhle aplikaci, ne veřejnou tvář.
Přesně proto tu ta služba stojí samostatně (viz hlavička souboru).

## `pki-init:`

── Certifikáty ──────────────────────────────────────────────────────────────
⛔ VLASTNÍ pki-init, ne sdílený svazek. Coolify pojmenované svazky přepisuje
na `<app-uuid>_<klíč>` a `name:` v compose ignoruje, takže dva stacky si
`pki-certs` sdílet NEMOHOU — každý si ho musí naplnit sám. Týž vzor jako
realtime, edge a core.

## `build:`

Jednorázový krok, ne služba: bez vypnutého healthchecku by ho Coolify
počítal do zdraví aplikace a hotový kontejner ve stavu `exited(0)` by ji
držel věčně nezdravou. Obojí je proto níž záměrně.

⛔ TENHLE ODSTAVEC PATŘÍ POD KLÍČ, NE NAD NĚJ. Komentář nad názvem služby
spadá ještě do bloku služby PŘEDCHOZÍ, a brána `coolify-compose-compliance`
čte direktivy z textu bloku — zmínka o restartu v komentáři se tam proto
čte jako direktiva a obviní nevinnou službu (naměřeno 2026-08-31: hlásilo
to `svc-web-render`, který má `restart: unless-stopped`).

## `pki-certs:`

Naplní ho `pki-init` výš; generátor ho čte jen pro čtení.

## `internal:`

⛔ TÁŽ JMÉNA JAKO V EDGE, opsaná odtamtud. Vymyšlené jméno by Docker
vytvořil jako novou prázdnou síť a generátor by neviděl ani API, ani mesh.
