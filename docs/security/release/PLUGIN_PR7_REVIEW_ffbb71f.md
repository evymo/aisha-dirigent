# Snapshot review plugin draft PR #7

**Verdikt pro tuto revizi: draft review může pokračovat; hotová distribuce a Store publication zůstávají blokované.** V plugin diffu nebyla potvrzena nová runtime bezpečnostní zranitelnost. P-01 je samostatný distribuční nález; původní backendové blokace jsou uvedené pouze souhrnně v [release checklistu](PUBLIC_RELEASE_CHECKLIST_2026-10-11.md).

## Immutable rozsah

| Položka | Hodnota |
|---|---|
| PR | https://github.com/evymo/aisha-dirigent/pull/7 |
| Base | `e9b790bb67b53fa8e12284aef2a92c0beafa2f92` |
| Head | `ffbb71f06449f7be85056f50cc154ad1d9c6fd67` |
| Review ref při měření | `refs/heads/codex/public-aisha-plugin-2026-10-10` |
| Tree | `30a3bbf72a712d99a0d8e336e1396c6804c13202` |
| Pokrytí | Všech 17 přidaných souborů: 15 textových souborů a dvě PNG |

Ref byl načten a jeho shoda s požadovaným SHA ověřena. Review a build pracovaly s přesnými zdrojovými bajty odděleně od původního audit checkoutu. Případné pozdější změny PR nejsou součástí tohoto snapshot verdiktu. Nativní Codex Security scan/preflight nebyl dostupný; jde o ruční diff review.

## P-01 — P2: předání licenčních podmínek samostatných artefaktů

OpenAI a Claude manifesty správně deklarují `Elastic-2.0`. Čtyřsouborový portable ZIP a samostatný Claude cloud folder na této hlavě však neobsahují úplný text root `LICENSE`. Část Notices vyžaduje předat kopii podmínek příjemci každé části softwaru; SPDX identifikátor a repository URL tuto kopii nepředávají. Plný Git checkout root licenci obsahuje.

OpenAI allowlist je definovaný v [package.py:10](https://github.com/evymo/aisha-dirigent/blob/ffbb71f06449f7be85056f50cc154ad1d9c6fd67/extensions/aisha-dirigent-openai/scripts/package.py#L10). Ověřený ZIP má přesně čtyři položky a SHA-256 `77d5181c72f98ca2fe00e3d5fc8323a7665ee28c96a381c7c8fa0e6bc978411e`.

**Uzavření:** zajistit doložené předání nezměněných podmínek a příslušných notices se samostatnou distribucí. Podle následné předávky připravuje jiná plugin relace kopii stávající root licence do OpenAI ZIP, Claude folderu i preview a odpovídající package testy. Tato následná oprava na jiné hlavě zde nebyla ověřena. Nejde o změnu licence ani o IAM změnu; budoucí oprava může změnit čtyřsouborový allowlist a musí mít vlastní exact-head evidence.

## Výsledky review

| Hranice | Závěr |
|---|---|
| Veřejný payload | Pevný allowlist `plugin.json`, `mcp.json`, onboarding skill, PNG. Lokální auth preview, `.env`, provisioning, build nástroje a testy nejsou v ZIPu. Konkrétní nové zdroje neobsahují skutečné credentials. Public client ID není secret. |
| Builder | Odmítá source symlinky, path escape, static MCP headers, vybrané credential klíče, hooks a chybné skill/icon odkazy; determinismus a nepřepsání zdrojů pokrývají testy. Jde o částečnou lokální validaci, nikoli obecný detektor tajemství nebo plnou validaci vzdáleného JSON Schema. |
| Portable OAuth | Pevný HTTPS MCP endpoint; provided public client `aisha-openai-plugin`, `tokenEndpointAuthMethod: none`; bez sdíleného secretu nebo bearer headers. PKCE, callback, resource binding a backend izolaci musí doložit hosted testy. |
| Codex preview | Samostatný legacy formát používá lokální klient a loopback callback. Tato HTTP loopback konfigurace není součástí portable ZIPu a nemění HTTPS remote endpoint. Tokens drží host. |
| Claude cloud | Samostatný HTTPS remote MCP folder. Žádný lokální server, lifecycle hook nebo background installation. Syntax validation neprokazuje hosted registraci, callback ani refresh. |
| Projekty a writes | Oba skills vyžadují vlastní identitu, výběr dostupného projektu, autorizovaný handoff, ověření backend přijetí a zachování approval flow; nepovolují admin/service fallback. Skutečné ACL a účinky operací musí vynucovat backend/host. |
| Online versus lokální | Cloud session vrací navržené IDE instrukce jako artefakt; změny souborů vyžadují autorizovaný lokální workspace a zachování existujících pravidel. |
| Kolize názvů | Lokální Claude 0.7.0 a cloud draft mají shodné package ID; README zakazuje oba v jednom marketplace a vyžaduje explicitní zdroj. Root marketplace a celý legacy folder jsou diffem nezměněné. Codex preview má vlastní marketplace `aisha-preview`. |
| Metadata / backend | Balíček nevytváří backendové nástroje, tool-effect/auth metadata ani token isolation. Tyto reviewed backendové změny a jejich skutečné nasazení jsou release předpokladem. |
| CI / Store | GitHub Actions soubor je pouze neaktivní šablona mimo workflow adresář. Draft portal acceptance není submission/publication. Hosted OpenAI/Claude readiness nebyla tímto lokálním review prokázána. |

Oba PNG mají 256×256, shodný obsah, validní chunk CRC a žádné textové metadata chunky. Inventář všech 17 souborů, Git blobs a SHA-256 je v [evidenci](2026-10-11-review-evidence.json).

## Validace a její původ

**Provedeno v této review relaci:** Python 3.12.14; skutečné `python3 -m unittest discover -s tests -v`: 16 pass, 0 fail, exit 0. Portable ZIP a Codex preview build PASS; integrity a přesný obsah ZIPu ověřené. Claude CLI nebyla dostupná, validate se zde neopakoval. Žádná nová útočná reprodukce, live credential replay, IAM provisioning nebo externí runtime zásah.

**Převzaté od primární relace a přesného PR snapshotu:** web 6 411 pass / 911 conditional skip; light gates 8 712 pass / 19 conditional skip; heavy gates 313 pass; build/lint/i18n PASS; Claude CLI 2.1.296 strict package validate PASS. Tyto běhy nejsou zde samostatně reprodukované ani náhradou za celostackové testy. Předchozí chybný discovery s nulou testů a exit 5 nebyl započten jako validace.

Původní čtyři bezpečnostní blokace, issuer refresh replay a RAG mesh zůstávají oddělené release podmínky. Plugin ZIP je neřeší. Přesné opravené revize a relevantní regresní výsledky musí doložit další review. Kompletní interní audit a reprodukce nejsou v tomto veřejném PR.
