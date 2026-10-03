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

⛔ SVAZKY SE SDÍLEJÍ JMÉNEM, NE PROJEKTEM. `web-static` i `web-shell` mají
v obou souborech `name: ${APP_NAME_PREFIX}_…`, takže obě aplikace sahají na
TÝŽ svazek. Proto musí generátor běžet na TÉMŽE stroji jako `web`
(`placement: frontend`) — svazky Dockeru hranici hostitele nepřekročí.

Když generátor neběží, web se servíruje dál: nginx nenajde předgenerovaný
soubor v `/_static` a spadne na SPA fallback (`docker/nginx.conf`). Tedy
přesně dnešní chování — pomalejší první vykreslení, ale funkční web.

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

## `- "${WEB_RENDER_STATIC_HOST_DIR}:/out"` (od 2026-09-24; dřív doslovné níž)

Hostitelský adresář TÉTO instance, `/var/lib/<identita>/web-render/static`, tutéž
proměnnou mountuje `web` na `_static`. Doslovná cesta z nadpisu níž byla sdílená
všemi instancemi na stroji (naměřeno 2026-09-23: renderery dvou instancí psaly do
jednoho adresáře a `uklidOsirele` si navzájem mazaly stránky).

### Historie: `- /var/lib/aisha/web-static:/out`

⛔ VAZBA NA HOSTITELE, NE POJMENOVANÝ SVAZEK. Naměřeno 2026-08-31:
Coolify jména svazků PŘEPISUJE podle UUID aplikace — `name:` v compose
ignoruje. Dvě aplikace tak dostaly dva různé svazky
(`ul7mwfes…_web-static` vs `zkcs5zu7…_web-static`) a generátor psal do
prázdna, které nikdo neservíruje. Sdílení „jménem" tedy mezi aplikacemi
NEFUNGUJE, ať je `name:` jakékoli.
Absolutní cesta na hostiteli nemá co přepsat, a je to v tomhle repu
zavedená praxe (viz /var/lib/aisha/agent-runs v compose-exec).
Obě aplikace MUSÍ běžet na témž stroji — což zajišťuje `placement: frontend`.

⛔ CESTA JE DOSLOVNÁ, BEZ ${APP_NAME_PREFIX}. Coolify nasazení se zdrojem
svazku obsahujícím `${` ODMÍTNE („Invalid volume source: contains
forbidden character") — a `docker compose config -q` to přitom přijme,
takže se to projeví až v ostrém nasazení. Hlídá to brána
`coolify-compose-compliance`, jinak bych to zjistil až selháním.

Následek: dvě instance na TÉMŽE stroji by si tenhle adresář sdílely.
Je to táž expozice jako u zavedeného `/var/lib/aisha/agent-runs`
(compose-exec) a v tomhle uspořádání nenastane — každá instance má
vlastní server. Kdyby se to změnilo, řeší se to serverem, ne cestou.

## `- "${WEB_RENDER_SHELL_HOST_DIR}:/shell:ro"` (od 2026-09-24)

Skořápku sem při startu kopíruje `web` (`Dockerfile.web`) — do téže proměnné.

### Historie: `- /var/lib/aisha/web-shell:/shell:ro`

Skořápka TÉHOŽ buildu — generátor z ní čte hashované značky skriptů
a stylů. Hádat je nelze: Vite je při každém buildu přejmenuje.

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
