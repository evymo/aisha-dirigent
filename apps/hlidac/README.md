# Hlídač — device owner, který drží tablet v kiosku

Malá nativní Android aplikace (Java, bez Expo a bez knihoven). Tablet se nastaví
z QR kódu a hlídač se stane jeho **správcem zařízení**. Pak drží kioskovou
aplikaci instance v zámku, uděluje jí oprávnění, zapíná polohu a čas ze sítě
a v noci ji sám aktualizuje z platformy (bez Obchodu Play).

## Obecný kód, identita instance

Kód je stejný pro všechny instance. Z dat instance se berou (`HLIDAC_INSTANCE` → `hlidac.json`, vzor `hlidac.example.json`):

- jméno balíčku (`applicationId`), verze a popisek,
- kiosková aplikace (`kiosk.package`) a oprávnění, která hlídač udělí předem (`kiosk.grantPermissions`),
- ⛔ žádný prohlížeč: Řidič se na Androidu přihlašuje jménem a heslem RIQ ID ve vloženém WebView (rozhodnutí majitele 2026-09-28) — Kiosk Admin prohlížeč nevrací a do kiosku nepouští; Obchod Play v kiosku SKRÝVÁ (Play Protect by tiché instalace zamítal) a nikdy nenastaví `ENSURE_VERIFY_APPS`,
- časové pásmo a jazyk nastavení,
- otisk podpisového certifikátu (`signing.certSha256`).

Podpisový klíč leží v trezoru, nikdy v repu ani v datech instance.

⛔ **Jméno balíčku ani klíč se po prvním nasazení nemění.** Tablet přijme
aktualizaci hlídače jen se stejným podpisem. Jiný klíč znamená tovární reset
každého tabletu.

## Build

```bash
apps/hlidac/scripts/build.sh --test        # jednotkové testy (stačí vzor identity)

HLIDAC_INSTANCE=…/<fork>-instance-data/zarizeni/hlidac.json \
HLIDAC_KEYSTORE_PATH=… HLIDAC_KEY_ALIAS=… HLIDAC_KEYSTORE_PASSWORD=… \
  apps/hlidac/scripts/build.sh              # podepsané release APK
```

Repo nenese Gradle wrapper (žádné binárky). Skript si najde Gradle 8.13+ sám
(`$GRADLE`, cache wrapperu, `PATH`). Po buildu porovná otisk podpisu APK s tím,
který deklaruje instance.

## QR kód

```bash
HLIDAC_WIFI_PASSWORD=… node apps/hlidac/scripts/qr.mjs \
  --instance …/hlidac.json --apk-url https://…/hlidac.apk \
  [--wifi-ssid <síť> --wifi-security WPA] [--okno 02:00-04:00] < pin.txt
```

- Vypíše JSON pro QR.
- **PIN technika** se čte ze stdin. Do QR jde jen jeho otisk (PBKDF2-SHA256, 120 000 iterací).
- Heslo Wi-Fi jde jen z prostředí.

Tablet si hlídače stáhne z `--apk-url`, takže ta adresa musí být z nastavovací
sítě dosažitelná.

## Co hlídač vynucuje

**Pořád (i v servisu):**
- Systémový fotoaparát je povolený a je i na seznamu kiosku, protože kiosková aplikace fotí přes `ACTION_IMAGE_CAPTURE`.
- Obchod Play je SKRYTÝ (Play Protect by tiché instalace zamítal; device owner ho vypnout nesmí, jen skrýt). Žádný prohlížeč — přihlášení běží ve WebView appky.
- Hlídač je domovská obrazovka.
- Čas se bere ze sítě a poloha je zapnutá.
- Aktualizace systému jen v nočním okně.

**V kiosku navíc:**
- Zakázáno: nouzový režim, ladění USB, instalace z neznámých zdrojů, přidání uživatele, přenos souborů přes USB, externí média, změna času a vypnutí polohy.
- Tovární reset je zakázaný jen s platným PINem technika.
- Oprávnění kioskové aplikace se udělí předem a její odinstalace je zakázaná.

⛔ Záměrně **není** zapnuté `DISALLOW_INSTALL_APPS` — blokuje každou instalační
session, i tichou instalaci z device ownera. A **nikdy** `ENSURE_VERIFY_APPS`: po
skrytí Obchodu Play platí po timeoutu ověřovatele výchozí „povolit“; s touto
restrikcí by to bylo „zamítnout“ a tichá instalace by přestala fungovat.

## Noční okno

V okně (výchozí 02:00–04:00, jen když se tablet nabíjí) Kiosk Admin přejde do
popředí, stáhne a tiše nainstaluje novější verze appek i sebe (viz „Aktualizace
appek mimo Obchod Play“) a aplikaci po okně spustí znovu. Okno se zadává ve tvaru
`HH:MM-HH:MM` v rozsahu 00:00–23:59; jiné QR nevznikne a odmítnuté okno ukáže servis.

## Výbava — co hlídač rozdá appce

Adresa API a dveře (`host`, `port`, `kid`, `scope`) se do appky **nezapékají**.
Hlídač je dostane v QR (`vybava` v `hlidac.json`) a předá je kioskové appce
**řízenou konfigurací** (`setApplicationRestrictions`); appka je čte
`RestrictionsManager`em.

⭐ **Proč:** APK z Obchodu Play samo o sobě neví, kam se připojit ani čím se
ohlásit. Zadání majitele 2026-09-22: *„tím pádem by nám ani nemohl nikdo klepat
na dveře, protože by jen s appkou ve store nevěděl jak."* Změna adresy navíc
přestává znamenat nový build.

⛔ **Výbava není tajemství** a nesmí se jím stát. Adresa, port, `kid` a `scope`
jsou konfigurace — kdo je zná, ještě neumí zaťukat: klíč se odvozuje z kódu,
který zadá člověk. Kdyby hlídač rozdával i klíč, stačilo by ukrást tablet.

⛔ **Částečná sada dveří je vada, ne „bez dveří".** Appka by nabídku klepání
skryla a nikdo by se nedozvěděl proč. Buď všechny čtyři, nebo žádná.

⛔ Jména klíčů jsou kontrakt mezi `qr.mjs` a `Vybava.java` — hlídá je brána
`vybava-hlidace-ma-jeden-kontrakt`.

## Aktualizace appek mimo Obchod Play

Hlídač je device owner, takže balíček doručí `PackageInstaller`em bez součinnosti
řidiče a tablet zůstane v kiosku.

**Řetěz:**

```
hlidac.json: appky[] (balíček, versionCode, sha256)   ← deklarace v datech instance
        │
        ▼
bucket `zarizeni`  ← binárku sem nahraje ADMINISTRACE (PUT /zarizeni/appky/<balicek>)
        │  GET /zarizeni/appky            → seznam: co má být nainstalované
        │  GET /zarizeni/appky/<b>.apk    → balíček
        ▼
hlídač: instaluje jen když je versionCode VYŠŠÍ než na zařízení
```

Spouští se **při zavedení tabletu** (aby onboarding byl jeden krok) a pak v
**nočním okně**. Po instalaci se výbava předá znovu — při zavedení appka ještě
neexistuje, takže by ji `setApplicationRestrictions` neměl komu dát.

⛔ **Otisk se ověřuje PŘED instalací**; nesedí-li, balíček se ZAHODÍ. Tichá
instalace z device ownera je nejsilnější schopnost na tabletu — bez ověření by
z hlídače byl nástroj, jak na zařízení dostat cokoli.

⛔ **APK v repu nebydlí** (rozhodnutí majitele 2026-09-22): je to artefakt,
patří do úložiště. V datech instance je jen jeho **otisk**, a ten je závazný —
nahrání s jiným otiskem služba odmítne (409) a při startu nahlásí, když v
bucketu leží něco jiného nebo nic.

⚠️ **Android odmítne aktualizaci podepsanou jiným klíčem** než ta nainstalovaná.
U nového tabletu to nevadí — appku instaluje hlídač, takže podpis sedí od
začátku. Na tabletu, kde už appka je z jiného zdroje, se musí nejdřív
odinstalovat.

## Cesta ven (technik)

1. Nabídka vypnutí → Restartovat.
2. Na odpočtu hlídače 7× ťuknout na název a zadat PIN.
3. Otevře se servisní režim: kiosk je vypnutý a omezení zvednutá.
4. Tam jde tablet i **uvolnit**, tedy hlídač se vzdá role správce.

Po 5 chybných PINech se zadávání na 5 minut zastaví.

## Co ještě není

- **Aktualizace hlídače samotného.** Zdroj už existuje (`apk.sha256` v deklaraci
  + bucket `zarizeni`), ale hlídač si ho sám nebere — `Rozdavani` jede jen přes
  `appky[]`. Vlastní přeinstalace je nejcitlivější krok, jaký na tabletu je:
  vadný build vezme správu zařízení s sebou.
- **QR v administraci** (Správa zařízení). Dnes ho vyrábí skript.
- **Ověření vývojáře u Googlu.** Pro instalace mimo Play se balíček a klíč budou registrovat (v ČR od 2027).
