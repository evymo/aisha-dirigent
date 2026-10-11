# Veřejná předávka auditu před vydáním

**Stav k 2026-10-11: NO-GO pro veřejný celostackový release a plugin Store publication.** Draft review zdrojů může pokračovat. Tento dokument zachovává veřejně sdělitelné výsledky; podrobné bezpečnostní důkazy a reprodukce se předávají odděleně podle `SECURITY.md`.

## Posuzované revize

| Rozsah | Přesný commit |
|---|---|
| Původní celostackový audit, 2026-10-05 | `07505122090dcd98844494b8bddd630b9c4127dd` |
| Veřejná base následného plugin review | `e9b790bb67b53fa8e12284aef2a92c0beafa2f92` |
| Plugin draft [PR #7](https://github.com/evymo/aisha-dirigent/pull/7) | `ffbb71f06449f7be85056f50cc154ad1d9c6fd67` |

Původní audit zahrnul inventuru 12 762 sledovaných cest, testy, build, typy, lint, statické a skutečné DB kontroly, secret scan, licenční podklady a ruční review vybraných kritických cest. Neznamená ruční sémantické review každého řádku. Nativní Codex Security Deep Scan nebyl dostupný. Dnešní plugin review je samostatné ruční review přesného diffu, nikoli nový celostackový audit.

## Původní bezpečnostní blokace

| ID | Oblast | Stav | Požadavek pro uzavření |
|---|---|---|---|
| S-01, P1 | Outbound HTTP / SSRF hranice | Otevřeno | Oprava v release revizi a cílená regrese skutečné transportní hranice. |
| S-02, P2 | Izolace výstupu web rendereru | Otevřeno | Oprava v release revizi a regrese izolačního kontraktu. |
| S-03, P1 | Vynucení LLM data residency | Otevřeno | Oprava v release revizi a testy povolených i zamítnutých dispatch cest. |
| S-04, P1 | Kontrakt spend admission | Otevřeno | Oprava v release revizi a regrese přes skutečnou RPC/DB hranici. |

Relevantní veřejné zdroje těchto čtyř nálezů se mezi původní auditovanou revizí a plugin review hlavou nezměnily. Dílčí změny logování nebo zápisu souborů nejsou samy důkazem remediace. Detaily dosažitelnosti, reprodukce a interní evidence nejsou součástí této veřejné předávky. Zelené plugin nebo web testy neuzavírají tyto čtyři nálezy.

## Release checklist

- [ ] Uzavřít S-01 až S-04 na přesné skutečně vydávané revizi a nezávisle ověřit relevantní regrese.
- [ ] Konvergovat reviewed backendové implementace nástrojů, projektové RPC autorizace, audited mutations a tool effect/auth metadata do veřejné release větve; doložit skutečné nasazení.
- [ ] Ověřit public-client PKCE S256, resource/audience binding, minimální scopes a izolaci plugin tokenů od ostatních API a DB exchange cest. Pouhá allowlist položka klienta nestačí jako důkaz izolace.
- [ ] Uzavřít známou blokaci refresh-token replay u issueru a doložit fresh/upgrade, broker, refresh, logout/revoke a relink regresní výsledky. ZIP issuer neaktualizuje.
- [ ] Uzavřít skutečnou blokaci RAG mesh transportu a doložit dosažitelnost, TLS identity, embedding/model-space vazby a projektovou/namespace izolaci v cílové topologii. Lokální nebo text fallback ji neověřuje.
- [ ] Uzavřít původní SDK build a servisní agregátor, chyby měřidel/kvality, coverage a E2E collection; doložit také dosud nezměřené lanes, které patří do konkrétního release scope. Přeskočené případy nejsou úspěšně ověřené.
- [ ] Uzavřít licenční podklady skutečně distribuovaných komponent, zejména případné PyMuPDF image, vendored notices a licence přesných verzí v SBOM. Metadata jiného projektu nepřebírat jako důkaz licence.
- [ ] Vyřešit předání úplných licenčních podmínek samostatných plugin artefaktů (P-01 ve [snapshot review](PLUGIN_PR7_REVIEW_ffbb71f.md)); opravu připravuje samostatná plugin relace, zde není ověřena.
- [ ] Dokončit domain verification, přesný hosted callback, veřejné privacy/terms/support cíle, sample-only reviewer account, walkthrough a hosted pozitivní/negativní/relink testy pro OpenAI a Claude.
- [ ] Vyřešit portal icon upload a provést publisher review a explicitní release rozhodnutí. Draft upload není submission ani publication.
- [ ] Zachovat explicitní zdroj Claude instalace kvůli shodnému package ID lokálního 0.7.0 a cloud draftu; nepoužít cloud folder jako automatický upgrade legacy pluginu.
- [ ] Aktivovat případnou CI šablonu pouze autorizovaným postupem s potřebným workflow scope. Soubor mimo `.github/workflows` není aktivní CI.

Repozitář zachovává **Elastic-2.0** podle rozhodnutí vlastníka. Veřejné označení má odpovídat source available / fair-code; nejde o OSI open-source licenci. Hosted-service podmínky a licence jednotlivých distribuovaných komponent je nutné posuzovat samostatně.

## Co je doložené testy

Původní měření na `0750512`: web 6 411 pass / 907 skip, proces skončil kvůli coverage; gates 9 005 pass / 24 skip; script tests 571 pass; DB 2 911 pass / 34 skip; services 50 z 51 sad prošlo, SDK validátor zablokoval agregátor. Výsledky jsou historické, nepřenášejí se automaticky na dnešní release revizi. Jednotlivé sady se překrývají a nesčítají do unikátního počtu testů.

Exact-head plugin měření a odlišení lokálně provedených versus převzatých kontrol jsou v [plugin review](PLUGIN_PR7_REVIEW_ffbb71f.md) a [evidenci](2026-10-11-review-evidence.json). NPM dependency audit s exportem metadat zde neproběhl; konkrétní souhlas k tomuto exportu nebyl udělen. Žádný z těchto dokumentů není certifikací bezchybnosti ani souhlasem k merge, deploy nebo publish.
