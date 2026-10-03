# Hlas (LiveKit) a Matrix — audit end-to-end

> Datum: 2026-09-29 · Stav kódu: `main` 9087ef3df · Rozsah: svc-livekit, svc-matrix, gateway, web + mobil, DB, compose/infra.
> Metoda: statická analýza kódu (file:line) + měření na živé instanci jen čtením (diagnostický ssh, přítomnost
> proměnných bez hodnot). Vznik: majitel chce, aby hlas a Matrix „plně a ověřeně fungovaly“; spouštěč byla oprava
> brány `rpc-sql-mapping` (K-18 v `docs/architecture/SELF_IMPROVEMENT_LOOP.md`), která odhalila 4 fantomová RPC.
> **Nic se neopravovalo** — tento dokument je podklad pro plán.

---

## 0. Verdikt

**Ani hlasový hovor, ani Matrix dnes nefungují od začátku do konce.** Nejde o jednu chybu, ale o přerušení
v každé vrstvě: UI není připojené, gateway volá neexistující proměnnou, služba podepisuje tokeny prázdným klíčem,
volá 4 neexistující RPC a klient se k místnosti nikdy nepřipojí. Mediální server instance jádra 29. 9. neběžel;
od 30. 9./1. 10. běží, ale bez veřejné domény.

**Naměřeno živě (instance jádra, 2026-09-29):**

| Co | Stav |
|---|---|
| gateway: `LIVEKIT_SERVICE_URL` (proměnná, kterou `functions.ts:159` čte) | **nenastavená** — compose nastavuje `SVC_LIVEKIT_URL` → vydání tokenu = 500 |
| svc-livekit: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_HOST`, `RECORDING_S3_*` | **nenastavené** → token podepsaný prázdným klíčem, nahrávání nemá kam |
| LiveKit server (SFU) pro instanci jádra | 2026-09-29 **neběžel**; **od 2026-09-30/10-01 běží** (LiveKit + coturn instance jádra na Backendu), zatím **bez veřejné domény** (stav 2026-10-01) |
| gateway: `MATRIX_SERVICE_URL` | nastavená |
| Totéž u druhé instance na stejném hostiteli | stejný obraz: `SVC_LIVEKIT_URL` ano, `LIVEKIT_SERVICE_URL` ne |

---

## 1. Tok „uživatel vstoupí do hlasové místnosti“ (konzultace, PTT, nahrávání)

| # | Krok | Stav | Důkaz |
|---|---|---|---|
| 1 | Web UI hovoru | ❌ | `ConsultationCallWindow.tsx`, `StoryVoicePanel.tsx`, `RecordingConsentBanner.tsx`, `MatrixInbox.tsx` nikdo neimportuje; mobil připojuje jen PTT (`mobile-app/src/app/project/[id].tsx:226`) |
| 2 | `create_consultation_call` (volající) | ✅ SQL | `create_consultation_call.sql:32-38` zakládá `voice_rooms` + `consultation_sessions`; **není v heals** |
| 3 | Upozornění volaného | ❌ | odkaz `/member/story?call=<id>` (`src/hooks/useConsultationCall.ts:270`) nic neobslouží; realtime posluchač (`:205-234`) je mrtvý — nic nevysílá `db_changes` (B8) |
| 4 | Prohlížeč → gateway `/functions/v1/create-livekit-token` | ❌ | `functions.ts:159-160` čte jen `LIVEKIT_SERVICE_URL`, compose nastavuje `SVC_LIVEKIT_URL` (`docker-compose.coolify.yml:375`); getter hází mimo try → 500 (změřeno živě) |
| 5a | svc-livekit `/create-token`: autentizace | ✅ | `packages/security/src/jwt.ts:85` |
| 5b | vyhledání místnosti, členství ve story | ❌ | fantomová RPC `get_voice_room_by_livekit_name`, `check_story_membership` |
| 5c | autorizace konzultace | ❌ | `token.ts:43-56` nekontroluje, že volající je caller/callee — token do cizího hovoru |
| 5d | podpis tokenu | ❌ | `LIVEKIT_API_KEY/SECRET` nejsou v env (`docker-compose.coolify-domain-services.yml:378-381`; změřeno živě) → `config.ts:19-21` = `''` |
| 5e | `upsert_call_participant` | ⚠ | funkce je, ale není v heals; chyby spolknuté (`token.ts:82`) |
| 6 | Klient → média | ❌ | web volající nevolá `connectToRoom` (`useConsultationCall.ts:279-303`); časovač nepřijetí čte starou hodnotu (`:300`); mobil po 60 s vždy pošle `missed` a zavře místnost uprostřed hovoru (`mobile-app/src/hooks/useConsultationCall.ts:263-265`); `VITE_LIVEKIT_URL` není ve web buildu; PTT (web i mobil) nastaví `connected` bez vytvoření Room (`useStoryVoiceChannel.ts:207-222`, mobil `:193-212`) |
| 7 | Mediální server a TURN | ❌/? | instance jádra SFU nemá (živě); `coolify/livekit.yaml:11-22` bez `use_external_ip`/`node_ip`; porty v konfiguraci ≠ publikované (7881 TCP nepublikován); coturn bez `external-ip` a zakazuje vlastní podsíť LiveKitu (`coturn.conf:36-38`); `NETBIRD_TURN_*` se do init nepředají → `user=:`; `LIVEKIT_RTC_PORT`/`TURN_PORT`/`TURN_TLS_PORT` výchozí prázdné (`aisha-env-doctor.mjs:1031-1033`); LiveKit chybí v `config/services.json` |
| 8 | Odchod, webhooky | ❌ | `LIVEKIT_WEBHOOK_URL=…/livekit-webhook` (`config/domains.env:277`) nemá trasu → 404; `call_events` a `recording_url` nemají zapisovatele; PTT místnosti se nezavírají |
| 9 | Nahrávání | ❌ | `get_consultation_session` fantom; chybí `LIVEKIT_HOST`, `RECORDING_S3_*`; žádná služba Egress ani Redis → 502; `stop` neověří, že egress patří k relaci (`recording.ts:98-120`); souhlas jednostranný (`update_recording_consent_audited.sql`) |

## 2. Tok „uživatel dostane identitu v Matrixu / místnost story“

| # | Krok | Stav | Důkaz |
|---|---|---|---|
| 1 | gateway → svc-matrix `/token-exchange` | ✅ | `MATRIX_SERVICE_URL` nastavená (compose `:377`, živě) |
| 2 | registrace/přihlášení | ⚠ | funguje, ale **každé volání = nové přihlášení a nové zařízení**; Synapse `rc_login` burst 3 (`homeserver.yaml:107-113`) → pod dotazováním chatu 429 → 502 (`matrix-identity.ts:117-136`); rotace registračního tajemství všechny zamkne (`:162-173`); SSO mapuje na `preferred_username` (`homeserver.yaml:87`), služba na KC `sub` (`:67`) → **dva účty na člověka**; jméno z fantomového RPC |
| 3 | místnost story | ❌ | `create_room` a mapování fungují, akce `join` neexistuje (`client-ops.ts:99-218`) → pozvaní se nepřipojí; `create_story_matrix_room.sql:23-32` bez kontroly členství + `UNIQUE(story_id, room_type)` → kdokoli obsadí/unese místnost story |
| 4 | vstup appservice (Synapse → AISHA) | ❌ | Synapse posílá na `/_matrix/app/v1/transactions/{txn}`, služba má jen `/webhook` (`webhook.ts:25-26`) → 404; `MATRIX_WEBHOOK_SECRET` se negeneruje (`aisha-cold-start.sh:3442`), Synapse posílá `AISHA_HS_TOKEN` → 401; neplatné hodnoty enumu auditu (`webhook.ts:55-57`) spolknuté; cesta n8n `/webhook/matrix` ≠ workflow `matrix-aisha`, workflow neaktivní a potřebuje negenerovaný token |
| 5 | Element Call | ❌ | `element-call-config.json:8-13` míří `livekit_service_url` na SFU místo lk-jwt; `matrix-rtc-auth` bez domény (`coolify-deploy-init.sh:2528-2531`); `LIVEKIT_DOMAIN` výchozí interní jméno (`domains.env:140`) |

## 3. Čtyři fantomová RPC — přepoužití napřed

| RPC | Služba čte | Návrh |
|---|---|---|
| `get_consultation_session` | `caller_id`, `callee_id`, `recording_consent` | tenká služební čtečka nad `consultation_sessions` JOIN `voice_rooms` (existující `get_active_consultation_session` vrací jen poslední aktivní relaci volajícího — na nahrávání úzké) |
| `get_voice_room_by_livekit_name` | `id`, `is_active`, `story_id`, `room_type` | tenká služební čtečka; `livekit_room_name` je UNIQUE a indexovaný |
| `check_story_membership` | jen pravdivost | přepojit na existující `is_story_participant(p_user_id, p_story_id)` (služba smí o kýmkoli); **nepokrývá vlastníka story** — buď doplnit vlastníka, nebo použít tentýž predikát jako `compose_context` (vlastník ∨ účastník ∨ správa) |
| `get_profile_display_name` | `display_name` | existující `get_my_profile_visibility` → `display_name_public` (už přes `format_display_name_for_public`), voláno za uživatele |

## 4. Seznam přerušení (mimo 4 RPC)

| # | Kde | Priorita | Oprava |
|---|---|---|---|
| H-1 | gateway `functions.ts:159-160` × compose `SVC_LIVEKIT_URL` | P0 | jedno jméno (číst `SVC_LIVEKIT_URL` jako Matrix, nebo nastavit v compose); test kontraktu jména |
| H-2 | svc-livekit bez `LIVEKIT_API_KEY/SECRET`, `LIVEKIT_HOST`, `RECORDING_S3_*` | P0 | do compose s `:?`, `requireEnv` v `config.ts` (fail-closed místo prázdného klíče) |
| H-3 | SFU instance jádra (stav 10-01: běží, bez veřejné domény) | P0 | veřejná doména přes edge + UDP pro média; zapsat stack do `config/services.json` |
| H-4 | klient se nepřipojí (web volající, PTT web i mobil); mobil ukončí po 60 s | P0 | `connectToRoom`, zrušit časovač po `Connected`, skutečná Room v PTT |
| H-5 | `token.ts:43-56` autorizace konzultace | P0 (bezpečnost) | pro `room_type='consultation'` jen caller/callee |
| H-6 | web UI hovoru a Matrixu nepřipojené; `?call=` bez obsluhy | P0 | trasa + obsluha příchozího hovoru |
| H-7 | realtime B8 (`db_changes` nikdo nevysílá) | P0 | podle `docs/remediation/NEXT_STEPS.md` B8 |
| H-8 | NAT/porty LiveKitu a coturnu | P0 | `use_external_ip`/`node_ip`, shodné publikované porty, coturn `external-ip`, povolit peer LiveKitu |
| H-9 | chybí Egress + Redis | P1 | doplnit, nebo nahrávání v UI vypnout |
| H-10 | Matrix appservice: cesta, tajemství, enum, n8n | P1 | trasa `/_matrix/app/v1/transactions/:txn`, `MATRIX_WEBHOOK_SECRET = AISHA_HS_TOKEN`, platné enumy |
| H-11 | `livekit-webhook` bez trasy, `call_events` bez zapisovatele | P1 | `/webhook` v svc-livekit (ověřit JWT LiveKitu), zápis `call_events` a `left_at` |
| H-12 | přihlášení do Matrixu při každém požadavku | P1 | cache tokenu per uživatel, odhlásit stará zařízení |
| H-13 | `create_story_matrix_room` bez kontroly členství (obsazení místnosti story) | P1 (bezpečnost) | stráž účastník/vlastník/správa |
| H-14 | `get_story_general_matrix_room`, `get_story_ptt_room`, `get_room_participants`, `join_ptt_channel` bez stráže | P1 (bezpečnost) | stráže členství |
| H-15 | jednostranný souhlas s nahráváním; `stop` nesvázaný s relací | P1 | souhlas per strana; kontrola egress ↔ relace |
| H-16 | celé SQL hlasu a Matrixu mimo heals (`heals-pokryva-sot.baseline.json:138,197,398,789,792,916,1153,1154,1238`), včetně opravy úniku `get_story_matrix_rooms` z 07-17 | P1 | `\ir` + zmenšit dluh — jinak opravy do běžící DB nedotečou |
| H-17 | politika `Participants_can_view_room_members` rekurze 42P17 (na allowlistu); `voice_rooms` ji dědí | P2 | definer pomocník `is_call_participant()` |
| H-18 | Matrix bez `join`; dva účty na člověka | P2 | akce `join`; sjednotit localpart na `sub` |
| H-19 | Element Call konfigurace, `matrix-rtc-auth` bez domény | P1 | lk-jwt URL, trasa, veřejná doména |
| H-20 | dokumentace | P3 | `mobile-app/docs/WIRE_UP_COMPLETION_PLAN.md:133` („backend COMPLETE“), `docs/tasks/v2-missing-rpc-functions.md:30-31`, poznámky compose LiveKitu (`TURN_STATIC_SECRET`, sdílená síť) neodpovídají |

## 5. Co jde ověřit kde

**Testy a throwaway DB:** kontrakt jména proměnné v gateway, cesta appservice transakce, skutečné testy tras
svc-livekit (dnes jen `livekit-jwt.unit.test.ts`, žádný test trasy), webhook Matrixu na skutečné cestě (dnešní test volá
handler přímo s mockem), stráže RPC, rekurze 42P17, heals na existující DB, platnost enumů, testy hooků s falešnými
časovači (dnešní mockují `livekit-client`, takže chyby připojení nevidí).

**Jen živě:** ICE/TURN z vnější sítě, mapování UDP portů, Egress do S3, doručení appservice ze Synapse, limity
přihlášení, Element Call → lk-jwt → SFU, dosažitelnost PostgRESTu ze svc-matrix. `matrix-federation.gate` běží jen online
a v CI se přeskakuje; `livekit-real-connect.gate` je textová kontrola dvou hooků; e2e test neexistuje.

## 6. Doporučené pořadí

1. **Konfigurace a infrastruktura (bez nich nic):** H-1, H-2, H-3, H-8 — a živě změřit, že token jde vydat a klient
   se spojí přes TURN z vnější sítě.
2. **Bezpečnost před zapnutím:** H-5, H-13, H-14, H-15 + 4 RPC se strážemi, vše s `\ir` (H-16).
3. **Klient:** H-4, H-6, H-7 — s testy hooků na falešných časovačích.
4. **Životní cyklus a nahrávání:** H-9, H-11.
5. **Matrix:** H-10, H-12, H-18, H-19.
6. **E2E test** hovoru a identity Matrixu na nasazené instanci (dnes žádný).
