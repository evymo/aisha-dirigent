# ADR-004: Federovaný zdroj — volání jako uživatel (trezor relací, důkaz identity, zápisy)

> **Status:** Návrh — rev. 4 (revize rady potvrzena 7b 25. 9.; Aisha Guru: ANO jako základ PR A, 6 podmínek
> zapracováno; implementaci ověří brány a `tools/definer-guard`). Zapracováno: revize autora federace brokeru (downstream fork), bezpečnostní revize
> rady aisha-team (7b: model hrozeb, 5 blokujících / 3 vysoké; d8: kritéria bran předem) a 6 podmínek Aisha Guru
> (upstream) pro PR A. Specifika prvního zdroje jsou v dokumentaci jeho pluginu ve forku, ne tady (ADR-003).
> **Datum:** 2026-09-25
> **Kontext:** `services/svc-source-broker/docs/SOURCE_FEDERATION.md` (Path B, „What needs follow-up"),
> `federated_caller_for` / `federated_identity_link`, `packages/broker-kit` (control), ADR-003 (jádro zná
> druhy, ne jména). Zadání provozovatele: model jednoho forku pro federaci zdroje (23. 9.) a
> „plnohodnotná komunikace přes API s ověřením a za uživatele, nasadit, otestovat, PR do upstreamu" (25. 9.).
> Návrh je obecný: jádro zná druh „zdroj s federací", žádné jméno zdroje.

## Model hrozeb (zkráceně podle revize rady)

Aktivum: token zdroje = plná práva uživatele u zdroje; u zdroje z příkladu níž bez expirace a bez stropu počtu — jeden únik
platí, dokud ho někdo výslovně neodhlásí. Aktéři: přihlášený uživatel aishy (i zlovolný), admin/staff aishy,
kompromitovaný broker, klient držící stav mezi kroky, pozorovatel logů a telemetrie, záloha nebo replika DB.
Hranice: klient ↔ broker (token KC), broker ↔ DB (servisní role), broker ↔ zdroj (token uživatele), KC ↔ broker.

## Rozhodnutí

1. **Trezor relací u zdroje je v jádře, obecně podle providera.** Tabulka `federated_source_sessions
   (id, user_id, provider, provider_id, token_ct bytea, refresh_ct bytea NULL, key_id, version, expires_at,
   verified_at, revoked_at, created_at)`. Heslo uživatele se neukládá nikdy. „Jedna aktivní relace" drží DB:
   unikátní částečný index `(user_id, provider) WHERE revoked_at IS NULL`; živá vazba `(provider, provider_id)`
   patří nejvýš jednomu uživateli aishy (druhý `connect` téhož účtu zdroje = odmítnutí, nebo výslovné převzetí
   s odvoláním první vazby).
2. **Token šifruje BROKER, ne databáze.** AES-256-GCM klíčem `FEDERATION_VAULT_KEY`, který žije jen v tajemstvích
   brokeru (generate-secrets, kritický klíč), s `key_id` pro rotaci. AAD = `provider | user_id | session_id | v1`,
   takže šifrový text nejde přenést k jinému uživateli ani relaci. Nonce je NÁHODNÉ 96bitové pro každé šifrování
   a pod jedním `key_id` se nikdy neopakuje (opakované nonce u GCM prozradí autentizační klíč); klíč se rotuje
   dřív, než pod ním proběhne 2^32 šifrování. Důvody (revize rady B2, P1, S3):
   - obecné `aisha_decrypt_column_audited` je granted `authenticated` a pouští admin/staff — se sdíleným klíčem
     by otevřelo token z jakékoli kopie šifrového textu (záloha, replika, log, chyba);
   - klíč šifrování sloupců se nastavuje `ALTER DATABASE … SET app.column_encryption_key`
     (`infra/postgres/set-passwords.sh:35`, `entrypoint-wrapper.sh:119`), je tedy čitelný každou relací se SQL;
     klíč odvozený uvnitř DB by trezor neochránil;
   - stejnou vlastnost má `app.settings.vault_encryption_key` (čte ho `001_vault_pgcrypto.sql`; do DB ho nese
     `ALTER DATABASE … SET` i `PGOPTIONS` služby db v `docker-compose.coolify.yml:164`) — trezor nestaví ani na něm;
   - klíč brokeru není v záloze DB — šifrování zálohu opravdu chrání.
   Databáze drží jen neprůhledný šifrový text. (Čitelnost tajemství v DB je samostatný nález platformy.)
   **Řetěz klíče (součást PR A, ne próza):** `generate-secrets.mjs` (kritický klíč, jako `COLUMN_ENCRYPTION_KEY`) →
   `${FEDERATION_VAULT_KEY}` v compose BROKERU (žádná výchozí hodnota) → doručení přes cold-start a sync-envs;
   fail-loud je ZPĚTNÉ ČTENÍ sync-envs (kontrakt env-doktora, druh `hex`: prázdný klíč v Coolify = aplikace FAILED),
   ne `${…:?}` v compose — ten by klíč vynutil do build-time množiny a zapekl do `docker history` (rohatka
   build-time tajemství). Klíč NIKDY do DB: ne do env služby postgres, ne do
   `PGOPTIONS`, ne jako GUC (`ALTER DATABASE/ROLE … SET`) — hlídá brána A15. Rotace přes `key_id` je NÁSTROJ
   (pojmenovaný navazující krok PR C, viz Postup), ne ruční postup.
3. **Trezor čte jen servisní role — a stráž stojí na volajícím.** RLS zapnuté bez povolující politiky,
   `REVOKE ALL … FROM PUBLIC, anon, authenticated` na tabulce i RPC. RPC `…_put`, `…_get_for_caller`,
   `…_version`, `…_revoke` jsou SECURITY DEFINER se `SET search_path` a stráží `public.is_service_role()`
   (rozhoduje podle role z JWT / `SET ROLE`, `aisha/db/sql/functions/is_service_role.sql` — NIKDY podle
   `current_user`, který je uvnitř DEFINER vlastník funkce). `…_put` přijímá `user_id` jen od servisní role.
   `…_revoke` smí servis, sám uživatel pro SVOU relaci (kontrola subjektu) a admin výslovně. Každé čtení
   šifrového textu = řádek auditu (bez hodnoty). Nad migrací poběží `tools/definer-guard` rady.
4. **Připojení účtu zdroje — jeden mechanismus, dvě routy.** `/auth/source/start|login` je PŘIHLÁŠENÍ DO AISHY
   přes zdroj; nové `POST /federation/:provider/connect` je PŘIPOJENÍ účtu zdroje k UŽ přihlášenému uživateli.
   Obě volají tentýž kontrakt pluginu (bod 7). Volající se bere z ověřeného tokenu Keycloaku (JWKS), nikdy
   z těla požadavku.
   - **Stav mezi kroky** `begin` → `pokracuj` nosí klient, ale je AEAD (klíč brokeru, odvozený pro účel
     „stav toku"), uvnitř `sub` z KC, provider, `exp` (≤ 5 min) a nonce; jednorázový. Použitá nonce jsou v DB
     (`federated_flow_nonces`, unikátní — sdílené mezi replikami brokeru), prošlá maže tik stávajícího plánovače
     brokeru (`services/svc-source-broker/src/scheduler.ts`) pod `pg_try_advisory_lock`, aby repliky úklid nezdvojily.
     Pozměněný, cizí (`sub` ≠ volající), prošlý nebo opakovaný stav = 400.
   - **Limit proti hádání hesel:** connect je jinak orákulum hesel proti zdroji (zdroj z příkladu rate limit nemá).
     Stav limitu v DB, sdílený mezi replikami — stávající `api_rate_limits` (úklid `cleanup_old_rate_limits()` ve
     stejném tiku plánovače). Dnešní `enforce_rate_limit` počítá podle `auth.uid()` a BEZ něj tiše propustí
     (`aisha/db/sql/functions/enforce_rate_limit.sql`), broker ale volá jako servis → servisní varianta
     `enforce_rate_limit_for(p_user_id, …)`, fail-closed. Klíče: (uživatel aishy, otisk cílového jména) a
     (uživatel aishy); strop na cílové jméno napříč uživateli z počtu neúspěchů v auditu (bez hodnot).
     Překročení = 429 a zdroj další pokus nedostane.
   - **Údaje nikam:** heslo a kód broker jen předá zdroji — žádný log, trace, Sentry (tělo, breadcrumbs), error
     handler, validační hláška, audit ani stav. Platí pro všechny kanály, ne jen pro vlastní logger.
   - **Nahrazení relace** (nový connect) nejdřív odhlásí STARÝ token u zdroje (bod 6).
5. **Volání jako uživatel, žádný tichý pád na servis.** Čtení i zápisy pro přihlášeného uživatele jdou JEHO
   tokenem z trezoru. Chybí-li relace nebo je odvolaná/prošlá → 409 „připoj účet"; servisní účet se NEPOUŽIJE.
   Servisní účet zůstává jen pro systémové běhy (plánovač), pojmenovaný a oddělený v kódu. Broker přestane
   vracet token zdroje klientovi (dnes `routes/auth.ts:279`).
   **Paměť brokeru jen pro čtení:** dešifrovaný token smí broker držet v procesu (klíč = id relace + `version`),
   ale při KAŽDÉM použití ověří levným `…_version` (bez šifrového textu), že relace není odvolaná a verze sedí —
   odvolání a nahrazení tedy platí okamžitě i napříč replikami. Zápis čte trezor vždy čerstvě.
6. **Odvolání a životnost.** U zdroje s neexpirujícími tokeny je `logout` POVINNÝ: nahrazení relace,
   `DELETE /federation/:provider`, vypršení `expires_at` (politika instance), deaktivace uživatele aishy
   a (až bude) backchannel z KC volají `logout` starého tokenu. `revoked_at` se nastaví VŽDY; nepovedený
   `logout` (síť, 5xx) se zapíše do auditu „odhlášení u zdroje neproběhlo" a opakuje ho stávající plánovač brokeru
   (`scheduler.ts`, tik pod `pg_try_advisory_lock`): frontou jsou řádky trezoru s `revoked_at IS NOT NULL AND
   logout_done_at IS NULL` (`logout_attempts`, `logout_next_at`, odstupňované opakování, strop pokusů → audit
   „ruční zásah"). Nová fronta nevzniká. Plugin, jehož tokeny neexpirují, bez `logout` se nezaregistruje.
   Reakce na odpovědi zdroje nad tokenem z trezoru: **401** → u zdroje s refresh NEJDŘÍV refresh (souběžné
   refresh téže relace serializovaně, zámek user + provider), odvolat až při selhání refresh; bez refresh →
   `revoked_at` + „připoj účet". **403** → token platný, bez práva: NEodvolávat. **5xx / síť / timeout** →
   „zdroj nedostupný", NEodvolávat. Nikdy „identita neexistuje" (vzor #1071).
7. **Kontrakt pluginu zdroje — krokový.** `SourceAdapterModule` dostane volitelné `createFederation()`:
   - `begin(údaje) → {hotovo: relace} | {vyzva: {druh: 'otp' | 'mfa' | …, stav}}`, `pokracuj(stav, odpověď) → totéž`
     (OTP: e-mail → kód → token; heslo bez MFA: `begin` hned „hotovo");
   - `whoAmI(token) → provider_id` z API zdroje;
   - `logout(token) → 'hotovo' | 'nepodporovano'`; `tokenyExpiruji: boolean` (bod 6);
   - relace = `{token, refresh?, expiresAt?}`; rotace refresh uloží nový refresh atomicky s access tokenem.
   A `createControlTarget()` (`IControlTarget.execute(action, conn, caller)` s `caller.federatedCallerId`).
   `adapters/plugin-host.ts` je zaregistruje vedle `createDataSource()`. Jádro zná druh „zdroj s federací",
   ne jméno zdroje; dnešní OTP/GraphQL jednoho zdroje napevno v `routes/auth.ts:40-57` se přestěhuje do adaptéru
   v instance-data (převzetí nabídl autor forku).
8. **Zápis jen s důkazem identity — pokaždé a týmž tokenem.** Před KAŽDÝM zápisem `whoAmI(token)` z odpovědi
   zdroje, NEPRÁZDNÉ, rovno NEPRÁZDNÉMU `federated_caller_for(provider, user)`, jinak 403 a zdroj nedostane
   žádné zápisové volání. `whoAmI` i zápis používají TENTÝŽ token z jednoho čtení trezoru (souběžný reconnect
   nevloží jiný token mezi důkaz a zápis). Důkaz se mezi zápisy necachuje (zápisy jsou řídké; cache by vytvořila
   okno, kdy se identita u zdroje změní a zápis projde). Zápisy jdou přes `driveControlledWrite` /
   `registerControl`; zapnutí zápisů je vlastnost VAZBY (datově), ne proměnná prostředí.
9. **Vazba identit je jedna.** `aisha_auth.identities` + `federated_identity_link` / `federated_caller_for`.
   Do `federated_identity_link` se promítne: `email_verified` výchozí `false` a výslovně, „jednou ověřený" neplatí
   navždy, stráž volajícího sjednocená s `call_subject` (fáze 1).
10. **Keycloak Token Exchange je volba instance.** Deklarovaná v overlayi a realm ji nemá → start selže nahlas.
    Mrtvou konfiguraci `KEYCLOAK_BROKER_CLIENT_ID/SECRET/AUDIENCE` (`config.ts:239-241`) oživit, nebo smazat.

## Co to řeší

- Dnes volá zdroj za všechny jeden servisní účet; „federace" se tváří hotově, ale zdroj identitu z těla přepíše
  identitou tokenu (u prvního zdroje naměřeno 23. 9.). Po změně jedná zdroj s aishou jako s uživatelem a práva
  rozhoduje sám — druhá sada práv v aishe nevzniká.
- Vlastnictví účtu zdroje uživatel dokáže přihlášením; vazba přestává být „tvrzená".
- Zápisová cesta přežije přechod zdroje ze služby na plugin (fork dnes drží zápisy v samostatné službě, kterou
  synchronizace s upstreamem smaže).

## Co to NEDĚLÁ

- **Odhlášení z aishy relaci u zdroje zatím NEUKONČÍ** — backchannel logout z Keycloaku není ověřený (kdo ho
  přijímá). Do té doby ukončí relaci jen odpojení, vypršení, deaktivace nebo nahrazení.
- Path A (Keycloak User Storage SPI) ani tlačítko „Přihlásit se přes <zdroj>" v Keycloaku.
- Nemění přihlášení přímo do zdroje. Neukládá heslo.
- Neřeší čitelnost klíče šifrování sloupců (`ALTER DATABASE … SET`) — samostatný nález platformy; trezor na něm
  nestojí (bod 2).

## Ověřeno proti kódu (design-verify, upstream `0c1043458`)

| Tvrzení | Kde |
|---|---|
| vazba a socket existují, obecně podle providera | `aisha/db/sql/functions/federated_caller_for.sql:13-37`, `federated_identity_link.sql:10-50` |
| tabulka vazby nemá token, expiraci ani odvolání | `aisha_auth.identities`, `infra/postgres/000_init_roles_schemas.sql:187` |
| login do zdroje vrací token zdroje KLIENTOVI | `services/svc-source-broker/src/routes/auth.ts:279` |
| přihlášení je napevno OTP/GraphQL jednoho zdroje | `routes/auth.ts:40-57, 139, 157` |
| servisní token zdroje se drží v paměti, ne per uživatel | `src/auth.ts:43-157` (`SourceAuthManager`) |
| čtení jde pevnou identitou operátora | `source-read.ts:55` |
| control kontrakt existuje, v produkci nevolaný | `packages/audience-types/src/connector.ts:45-50`, `packages/broker-kit/src/control.ts:30-66`, `registry.ts:22` |
| plugin host načítá jen `createDataSource()` | `adapters/plugin-host.ts:64-71` |
| obecný decrypt pouští admin/staff a je granted `authenticated` | `aisha/db/sql/functions/aisha_decrypt_column_audited.sql:15-45` |
| klíč sloupců je GUC na úrovni DB (čitelný relacemi) | `infra/postgres/set-passwords.sh:35`, `infra/postgres/entrypoint-wrapper.sh:119` |
| `is_service_role()` rozhoduje podle role z JWT / `SET ROLE`, ne `current_user` | `aisha/db/sql/functions/is_service_role.sql` |
| KC: token-exchange zapnutý, realm má jen google/apple | `Dockerfile.keycloak:32,150`, `keycloak/aisha-realm.json:1178-1200`, `keycloak/source-federation-template.json:3` |

## Příklad: zdroj s neexpirujícími tokeny a bez MFA

Syntetický případ, na kterém je kontrakt nejpřísnější: přihlášení jménem a heslem vydá při KAŽDÉM přihlášení nový
token bez expirace a bez stropu počtu; odhlášení zneplatní jen token, kterým se volá; zdroj nemá rate limit ani MFA.
Pak: `begin` vrací rovnou „hotovo"; `tokenyExpiruji = false`, takže `logout` je povinný (bod 6) a `expires_at` určuje
politika instance; broker token drží a znovu používá (nikdy „přihlášení na každý požadavek" — tokeny by se u zdroje
hromadily); limit v connect je jediná ochrana proti hádání hesel. Kontrakt konkrétního zdroje (routy, tvar odpovědi,
aplikace u zdroje) patří do dokumentace jeho pluginu v instance-data, ne sem, a ověří ho JEDEN test proti živé
instanci zdroje — ne brány (ty běží proti falešnému zdroji, deterministicky).

## Brány (kritéria předem)

Katalog sabotáží sestavila rada (d8 s kandidáty 7b; mimo git, protože popisuje slabiny dneška). Každá brána:
proti `0c1043458` červená, po PR zelená, na každé sabotáži zase červená; falešný zdroj počítá volání a rozliší
tokeny; negativní kontroly mají kotvu ve stejném běhu (sentinel se najde tam, kde být má).
- **PR A (trezor):** A1 šifrový text neotevře obecný decrypt ani `authenticated`/admin · A2–A3 REVOKE/RLS · A4 stráž
  na volajícím, ne `current_user` · A5 `search_path` · A6 `put` jen servis · A7 jedna aktivní relace · A8 nahrazení
  s `logout` starého tokenu · A9 odvolaná/prošlá se nevrací · A10 revoke cizí odmítnut · A11 žádný plaintext ·
  A12 audit čtení · A13 sentinel tokenu nikde mimo trezor · A14 rotace refresh atomicky.
- **PR B (routy, důkaz, zápisy):** B1 volající z KC, ne z těla · B2/B3 `whoAmI` z odpovědi zdroje, neprázdné obě
  strany · B4/B5 důkaz před každým zápisem, zápis až po něm · B6 bez tichého servisu · B7 token nikdy klientovi ·
  B8 heslo/kód nikde (log, trace, Sentry, chyby, audit, stav) — s kladnou kotvou v TÉMŽE výstupu (řádek
  „connect proběhl" v logu je, sentinel ne), jinak projde i prázdný log · B9 matice 401/403/5xx/timeout · B10 stav AEAD,
  vázaný, prošlý i opakovaný odmítnut · B11 odpojení vždy `revoked_at`, nepovedený `logout` zaznamenán ·
  B12 zápisy z vazby, ne z env · B13 jeden `provider_id` jednomu uživateli · B14 TE bez realmu = start selže ·
  B15 jméno zdroje v jádře (statická) · A15 klíč brokeru nikdy v DB (env služby postgres, `PGOPTIONS`,
  `ALTER DATABASE/ROLE … SET`, skripty `infra/postgres` — statická, červená na podvrženém řádku) · B16 odvolání platí hned i s pamětí brokeru · B17 limit 429 · B18 refresh
  před odvoláním, serializovaně · B19 důkaz a zápis týmž tokenem.

## Rizika a otevřené otázky

- **Token zdroje = plná práva uživatele u zdroje**; broker drží ekvivalent jeho přihlášení. Mitigace: šifrování
  klíčem brokeru s AAD, čtení jen servisní rolí, `expires_at`, povinný `logout`, audit čtení.
- **Kompromitovaný broker** otevře tokeny (má klíč i servisní roli) — to platí pro jakýkoli trezor, který broker
  potřebuje používat. Rotace `FEDERATION_VAULT_KEY` (`key_id`) + hromadné odvolání s `logout` jako postup reakce.
- **Pořadí vůči synchronizaci forku:** nejdřív jádro (tento ADR), pak plugin zdroje ve forku, teprve pak
  synchronizace, která smaže dnešní službu zdroje.

## Postup (každý krok ověřený, než začne další)

1. Revize: rada potvrdila (7b), Aisha Guru ANO jako základ PR A s 6 podmínkami (zapracováno, rev. 4).
2. PR A (upstream): trezor + RPC + řetěz `FEDERATION_VAULT_KEY` (generate-secrets → compose brokeru → cold-start/
   env-doktor) + servisní limit + nonce + opakování `logout` v plánovači + brány A1–A15 (červená proti dnešku, zelená
   po, sabotáže) + `tools/definer-guard`.
3. PR B (upstream): kontrakt pluginu, routy connect / disconnect, volání jako uživatel, důkaz před zápisem přes
   `driveControlledWrite`, konec vracení tokenu klientovi, brány B1–B19.
4. Fork: plugin prvního zdroje + instance-data, zápisy vypnuté; test kontraktu proti živé instanci zdroje (devel).
5. Devel: nasadit, otestovat čtení jako uživatel, pak zapnout zápisy pro jednu vazbu.
6. Teprve potom synchronizace forku s upstreamem.
7. PR C (pojmenovaný navazující krok): nástroj rotace `FEDERATION_VAULT_KEY` přes `key_id` — přešifrování živých
   relací novým klíčem, odvolání starého, brána „po rotaci žádný šifrový text pod starým `key_id`".
