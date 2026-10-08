# docker-compose.coolify-accel-hostfw.yml — firewall hostitele uzlu `gpu` (GPU)

> Prose k [docker-compose.coolify-accel-hostfw.yml](../../docker-compose.coolify-accel-hostfw.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady, kotvená k řádkům, které vysvětlují.
> Logika je v [infra/accel/hostfw.sh](../../infra/accel/hostfw.sh), výklad deklarací
> v [scripts/lib/accel-deklarace.mjs](../../scripts/lib/accel-deklarace.mjs).

## Proč tahle aplikace existuje

Uzel `gpu` nic veřejně nevystavuje — služby vrstvy jsou dosažitelné jen meshem
(„veřejné jen přes edge do meshe"). Naměřeno 2026-10-02 z cizí sítě: výchozí proxy
Coolify na 80/443 odpovídala celému internetu. Proxy serveru se proto deklaruje jako
`none` (`proxy` slotu v `coolify/servers.json`, nástroj `scripts/coolify-server-proxy.mjs`),
a tahle aplikace drží druhou vrstvu: firewall hostitele **jako kód**, nasazovaný
týmž cold-startem jako zbytek stacku.

**Kdy se nasazuje:** přepínačem je sama deklarace uzlu — `provision_when_env`
služby v katalogu je `[ACCEL_FW_NODE_OWNER, ACCEL_FW_SSH]`, ne lane vrstvy
`ACCEL_ENABLED`. Majitel 2026-10-05: nejdřív firewall, kouřový test lane (vLLM) až
po něm. Nový příznak by byl deklarace bez plniče; tyhle hodnoty firewall potřebuje
tak jako tak. Opačně to neplatí: zapnutá vrstva bez firewallu je chyba posudku
(`posudAccel` v lib/accel-deklarace.mjs).

`ufw` nestačí: Docker zapisuje svá pravidla před řetězce ufw. Pravidla proto žijí
ve vlastních řetězcích s jediným dotekem cizích: skok z `INPUT` veřejného
rozhraní a skok z `DOCKER-USER` podmíněný dockerovým mostem.

## `x-aisha-povinne-za-behu: [ACCEL_OWNER_PREFIX, ACCEL_FW_NODE_OWNER, ACCEL_FW_MODE, ACCEL_FW_SSH, ACCEL_FW_ADMIN_CIDRS, ACCEL_FW_CONFIRM_S, ACCEL_FW_INTERVAL_S]`

Bez nich firewall nenaběhne, ale `${…:?}` by je vtáhlo do build-time množiny
(Coolify je pak předá jako `--build-arg` a zapeče do historie obrazu — adresy
správy jsou data instance). Pole je prosté jméno: předlet nasazení
(`scripts/lib/povinne-promenne.mjs`, doktor fáze P, CI) je hlídá jako povinné
a NEPRÁZDNÉ, build je nevidí. Jsou to vstupy obsluhy (env-doktor je vede jako
`external` za lane `accel-hostfw`, heredoc cold-startu je propouští do
`.env.coolify`); platforma žádnou hodnotu nedosazuje.

`ACCEL_FW_CONFIRM_S` a `ACCEL_FW_INTERVAL_S` jsou v témže poli z jiného důvodu:
compose je čte HOLÉ (žádné `${X:-900}` — dosazená hodnota v compose je druhý domov
téhož čísla) a jejich výchozí hodnoty mají jediný domov v kontraktu env-doktora
(`static`, za lane `accel-hostfw`: 900 a 30 s; chybějící klíč doplní, deklaraci
obsluhy nepřepíše). Bez hodnoty by `start_period` vyšel jako `s` a nasazení spadlo
— předlet to řekne dřív a jménem.

`ACCEL_FW_UDP_MESH_PORT` v poli NENÍ a compose ho čte jako `${ACCEL_FW_UDP_MESH_PORT:-}`
(prázdné = normalizace): je VOLITELNÝ. Nejmenší oprávnění — modelový mesh v1
(varianta C) jede jen přes relay na TCP 443 a příchozí UDP na uzlu nic neobsluhuje.
Prázdno = žádné UDP pravidlo (zavřeno); port 1–65535 = přesně ten port v INPUT
i DOCKER-USER; cokoli jiného = firewall nenaběhne (výklad
`lib/accel-deklarace.mjs` `udpPortMeshe`). Dřív se otevíral `NETBIRD_MESH_PORT`
vždy; firewall ho už nečte. Kontrola uzlu i vnější sonda berou výjimku UDP z téže
deklarace.

## `container_name: ${ACCEL_OWNER_PREFIX}-accel-hostfw`

Identita vrstvy z deklarace vlastníka (revize Guru k A2-1), ne z `APP_NAME_PREFIX`:
při přesunu vrstvy do projektu operátora (A7) zůstává táž. Jméno na démonu nese
identitu (brána `jmena-na-sdilenem-hostiteli`). Holé `${…}` (povinnost viz výš) —
prázdná identita by dala neplatné jméno `-accel-hostfw` a nasazení by spadlo i tak.

## `network_mode: host`, `cap_drop: [ALL]`, `cap_add: [NET_ADMIN, NET_RAW]`

Pravidla patří do síťového jmenného prostoru HOSTITELE. Nejmenší oprávnění:
`NET_ADMIN` (zápis pravidel) a `NET_RAW` (iptables otevírá raw socket), nic víc —
žádný docker socket, žádné `pid: host`, `no-new-privileges`, kořen jen pro čtení.
`/run` je tmpfs: stav pro healthcheck a zámek iptables zůstávají v kontejneru
(zámek hostitele `/run/xtables.lock` se NEmontuje — bind neexistujícího souboru by
Docker založil jako adresář a rozbil iptables hostitele; na nf_tables zámek
nepotřeba, legacy je jen záložní backend).

## Backend iptables

Ubuntu hostitele má iptables v1.8.11 (nf_tables). Kontejner nese oba backendy a
použije TENTÝŽ, ve kterém drží Docker řetěz `DOCKER-USER`; `iptables -V` zvoleného
binárního souboru ho musí potvrdit, jinak NIC (stav `SELHALO`, unhealthy). Legacy
se nevolá naslepo — první volání `iptables-legacy` na nft hostiteli by nechalo
jádro dotáhnout legacy tabulku; zkouší se jen tehdy, když legacy `filter`
v `/proc/net/ip_tables_names` už je. Docker v nativním nftables režimu (bez
`DOCKER-USER`) = nenabíhá.

## Pořadí pravidel

`AISHA-HOSTFW-IN` (skok z `INPUT -i <veřejné rozhraní>`): lo → ESTABLISHED,RELATED →
nutné ICMP (destination-unreachable kvůli PMTU, time-exceeded, parameter-problem;
IPv6 navíc packet-too-big a objevování sousedů) → TCP 22 ze správcovských adres
(`ACCEL_FW_ADMIN_CIDRS`; čítač těchto pravidel potvrzuje enforce) → TCP 22 komukoli
JEN s `ACCEL_FW_SSH=svet` → cokoli ze správcovských adres → UDP port meshe (jen
s deklarací `ACCEL_FW_UDP_MESH_PORT`) → zbytek. `AISHA-HOSTFW-FWD` (skok z `DOCKER-USER -i <veřejné rozhraní>
-o docker0|br-+`): ESTABLISHED,RELATED → ICMP → cokoli ze správcovských adres → UDP
meshe (jen s deklarací; podle `--ctorigdstport`, tedy původního portu před DNAT) → zbytek.

## Deklarace uzlu (rozhodnutí majitele 2026-10-05)

- **SSH hostitele** — `ACCEL_FW_SSH`: `svet` (komukoli; přístup hlídá sshd, jen klíč —
  ne firewall), nebo `sprava` (jen ze správcovských adres). Volba je v deklaraci uzlu
  (data instance), ne v kódu: bez ní firewall nenaběhne. „Světu" platí JEN pro tcp/22
  v `INPUT`, nikdy pro jiný port ani pro publikované porty kontejnerů.
- **Všechny ostatní příchozí porty jen ze správcovských adres** — i porty, které
  publikují kontejnery: Docker je DNATuje a pouští přes `FORWARD`, mimo `INPUT`, proto
  totéž pravidlo stojí i v řetězci pod `DOCKER-USER`. Z nesprávcovské adresy se
  publikovaný port zahodí (enforce), ze správcovské projde.
- **Odchozí** — firewall ho neomezuje: do `OUTPUT` nesahá a skok z `DOCKER-USER`
  míří jen z veřejného rozhraní DO mostů. Agenti NetBird (443/tcp a 3478/udp na edge
  forků podle varianty C, UDP WireGuard) tak projdou a odpovědi jim pouští
  ESTABLISHED,RELATED. Omezení odchozího provozu na výčet (DNS, NTP, registry, váhy
  modelů…) je samostatné rozhodnutí — deklarace ho dnes nenese.

- **Vlastník uzlu** — `ACCEL_FW_NODE_OWNER`: identita vrstvy (tvar `ACCEL_OWNER_PREFIX`),
  které jediné smí na stroji běžet firewall hostitele. Pravidla jsou stav celého stroje
  (řetězce `AISHA-HOSTFW-*`): druhý vlastník vrstvy by spustil druhý firewall, který by
  se o tytéž řetězce pral — a při vlastním selhání by sundal pravidla vlastníka.
  Firewall se na vlastnictví ptá DŘÍV než na cokoli jiného (i v `--plan` a `--vrat`);
  cizí identita, chybějící nebo vadná deklarace = `SELHALO` s pojmenovanou příčinou
  a ŽÁDNÉ volání iptables.

Správcovská adresa je instanční — patří do deklarace a overlaye instance, nikdy do
platformového kódu (testy používají dokumentační rozsahy 192.0.2.0/24, 2001:db8::/32).

Povolený provoz se vrací (`RETURN`), ne přijímá: rozhoduje dál zbytek řetězců
hostitele a Dockeru, hostfw jen zahazuje SVŮJ zbytek. Veřejné rozhraní = rozhraní
výchozí trasy (IPv4; výchozí trasa IPv6 jiným rozhraním = nenabíhá). Dvojče
`ip6tables` se nasazuje vždy, když jádro IPv6 má — i bez veřejné IPv6 adresy.

Brány: `hostfw-bezpecne-poradi` (plán z DRY_RUN, mutace), `hostfw-souziti-s-ci-vm`
(simulace: po nasazení i návratu cizí řetězce beze změny, nft se nevolá).

## `ACCEL_FW_MODE` — measure | enforce

`measure`: tatáž sada, zbytek jen počítá (`RETURN`, čítač `aisha-hostfw:zbytek`) —
co by enforce zahodil. `enforce`: zbytek `DROP`. Cokoli jiného (i prázdno) a prázdné
nebo vadné adresy správy = firewall NENABĚHNE: vlastní pravidla z dřívějška sundá,
žádný DROP, unhealthy (fail-closed — neznámý bezpečnostní přepínač nesmí znamenat
ani „otevřeno", ani „zamčená správa").

## `ACCEL_FW_CONFIRM_S: ${ACCEL_FW_CONFIRM_S}` — auto-návrat

Po přechodu na enforce čeká hostfw na nárůst čítače pravidla SSH ze správy, tedy na
NOVÉ spojení ze správy, které enforce pravidly prošlo (navázaná spojení počítá
pravidlo ESTABLISHED, ne SSH — trvalé multiplexované spojení Coolify proto nepotvrdí
nic). Potvrzení dá vnější sonda doktora z adresy správy (TCP connect na 22) nebo
jakékoli nové SSH ze správy. Bez nárůstu do okna sundá JEN svoje skoky a řetězce,
stav `VRACENO` (unhealthy) a zůstane tak do dalšího nasazení. Po potvrzení zapíše na
konec vlastního řetězce značku s otiskem sady (pravidlo bez cíle — nic nepropouští);
další start s TOUŽ sadou pravidla nepřepisuje a znovu nečeká. `start_period`
healthchecku je stejně dlouhé jako okno, takže čekání na potvrzení se nepočítá
za selhání.

**Jak potvrdit (změřeno 2026-10-06):** „Validate Server“ v Coolify enforce NEPOTVRDÍ, protože Coolify drží
multiplexované SSH a nové spojení neotevře. Stejně tak `ssh <uzel>` se sdíleným spojením (`ControlMaster auto`)
se jen přilepí na existující spojení. Potvrdí jen NOVÉ spojení ze správcovské adresy, ručně, po startu enforce:
`ssh -o ControlMaster=no -o ControlPath=none -J <stroj ve správcovské síti> <uživatel>@<adresa uzlu> true`.

## `ACCEL_FW_INTERVAL_S: ${ACCEL_FW_INTERVAL_S}`

Smyčka ověřuje svá pravidla (`-C`) a chybějící doplní — typicky skok z
`DOCKER-USER` po restartu Dockeru. Potvrzení se tím nemění (táž sada).

## `DRY_RUN: ${DRY_RUN:-}`

Přepínač náhledu: výslovné `1` = hostfw jen vypíše plán a nic nenasadí (stav
`NAHLED`, unhealthy); `0` nebo nenastaveno = ostrý běh. Compose nic nedosazuje
(prázdné `:-` je jen „nenastaveno") a skript jinou hodnotu NEVYKLÁDÁ: `true`,
`yes` a podobné jsou neznámý přepínač bezpečnostního nástroje → firewall
nenaběhne (stav `SELHALO`, žádný DROP).

## Kde skript v kontejneru žije (`ENV` v `Dockerfile.accel-hostfw`)

Adresář stavu (`HOSTFW_STAV_DIR`, tmpfs `/run` z tohoto compose — čte ho
healthcheck), `/proc/net` (`HOSTFW_PROC_NET`) a krok čekání na potvrzení
(`HOSTFW_KROK_S`) deklaruje obraz. `hostfw.sh` je nedosazuje: bez nich skončí hned
a s vysvětlením (brány je míří na dočasné adresáře simulovaného hostitele).

## Ukončení kontejneru

Na `TERM` pravidla zůstávají — přenasazení je tak bez okna; další start je převezme
(táž sada se nepřepíše, jiná se zapíše atomicky přes `iptables-restore --noflush`).
Před odebráním aplikace: `docker exec <kontejner> /opt/aisha/infra/accel/hostfw.sh --vrat`.

## Soužití s CI VM (dohoda s Android)

Most CI VM, jeho nftables tabulky a jeho dvě pravidla v `DOCKER-USER` hostfw
nevidí: skok do `AISHA-HOSTFW-FWD` je podmíněný dockerovým mostem, nic se
neflushuje, `nft` se nevolá. V nftables vyhrává drop v kterékoli základní
řetězci — každá strana proto zahazuje jen svůj provoz.

## Mimo tenhle soubor (otevřené)

- Přímé spojení agentů (WireGuard, P2P) má vlastní UDP port; modelový mesh v1 jede
  přes relay (TCP 443) a příchozí UDP nepotřebuje. Kdyby měření `netbird status -d`
  v okně testu ukázalo potřebu P2P, port se otevře deklarací uzlu
  `ACCEL_FW_UDP_MESH_PORT`, ne změnou kódu.
- Vnější sonda doktora (`scripts/lib/vnejsi-expozice.mjs`) nesmí běžet z CI VM na
  témže hostiteli (vlastní IP = hairpin, ne cizí síť) — sama to pozná a odmítne.
- Proxy `none` je v API Coolify jen TYP: zápis běžící kontejner proxy nezastaví
  (změřeno 2026-10-03, Coolify 4.3.16) a firewall v `enforce` ho zakryje i vnější
  sondě. Že na uzlu žádná proxy porty nepublikuje, měří výpis kontejnerů uzlu
  (`scripts/lib/kontejnery-uzlu.mjs`, kotva = kontejner tohoto firewallu): doktor
  fáze V a závěrečné ověření každého produkčního cold-startu naostro (i se
  `--skip-deploy`); nález i NEZMĚŘENO tam končí jako nedokončeno. V předletu
  cold-startu (krok 0, `--predlet-cold-startu=srovna|nemeni`) je stav sdíleného
  serveru — rozdíl typu proxy i tenhle nález — jen hlasité varování: žádný běh kvůli
  němu nezastaví; samostatný doktor ho hlásí jako FAIL. Kontejner proxy nikdo
  nezastavuje — kdo to udělá, je rozhodnutí majitele.
- Publikovaný UDP port se nesonduje (ticho neodliší „zahozeno" od „nedoručeno").
  Platí pravidlo nad stavem firewallu MĚŘENÝM na uzlu (healthcheck tohoto
  kontejneru): ve stavu `MERENI` nebo `VRACENO` je publikovaný UDP port nález, ve
  `VYNUCENO` ne; jediná výjimka je deklarovaný UDP `ACCEL_FW_UDP_MESH_PORT` (bez
  deklarace výjimka není).
- Port SSH do CI VM měří vnější sonda z deklarace instance `ACCEL_CI_VM_SSH_PORT`
  (otevřený smí být jen ze stanoviště v adresách správy): číslo portu, nebo
  výslovné `zadna` = na hostiteli uzlu žádná CI VM není (pak se neměří a výstup to
  řekne). Hodnotu dodává obsluha (kontrakt env-doktora `external`, heredoc
  cold-startu); bez ní nebo s čímkoli jiným sonda hlásí NEZMĚŘENO, port se nehádá.
