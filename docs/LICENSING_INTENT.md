# AISHA Guru — licenční a komunitní model (zadání pro právníka)

> **Stav:** ROZHODNUTO 2026-06-06 — **Elastic License 2.0** (fair-code); AGPL zamítnuto
> · **Vlastník:** Evymo s.r.o.
> **Pozn.:** Nejsem právník a tohle není právní rada. Je to *zadání* — popis záměru,
> podle kterého má licenci a smluvní vrstvu finalizovat advokát. Cílem je, aby
> rozhodnutí byla srozumitelná a aby finální text přesně seděl na to, co chceme.

---

## 1. Co chceme (jednou větou)

Kód AISHA Guru má být **veřejně dostupný a volně použitelný** — kdokoli si ho nasadí
pro sebe, nasadí ho u klientů a vylepšuje ho. Jediné, co si Evymo vyhrazuje, je
provozovat **nadstavbu jako placenou službu**: interní modely + to, jak AISHA
*vyhodnocuje a routuje* dotazy (včetně placených modelů třetích stran). Registrace je
vstupenka do komunity a ke službě, **ne podmínka pro použití kódu**. Model je z rodiny
„ala n8n" — otevřený kód + hostovaná služba.

---

## 2. Čtyři vrstvy a kde je hranice

| Vrstva | Co to je | Pravidlo |
|---|---|---|
| **Otevřená vrstva (kód)** | framework, KB schéma, extension, workflows | smí se: používat, upravovat, šířit, nasazovat u klientů |
| **Hostovaná nadstavba (služba)** | interní modely, vyhodnocení & routing, přístup k placeným modelům | běží **jen u Evymo**, nikdy se nedistribuuje — tohle je produkt a moat („není to chatbot") |
| **Registrace & komunita** | účet, komunita, sektorová podpora | zdarma; **nepovinná pro běh kódu**, povinná pro službu a komunitu |
| **Příspěvky** | zlepšení od uživatelů | dobrovolné, pod lehkým CLA; odměny případně později, kryté z předplatného |

**Sektory:** v licenci žádné jmenované vertikály. „Odbory", „politika" apod. jsou jen
**sektory**; pro sektory umíme nabídnout podporu a další zapojení. Tím si nezamykáme
žádnou budoucí stranu.

---

## 3. Licence — tady je skutečné rozhodnutí (a proč je pochybnost o AGPL na místě)

Klíčová otázka **není** „která open-source nálepka", ale:

> **Chceme ostatním zakázat hostovat tu otevřenou vrstvu jako konkurenční službu?**

Rozhodovací kritérium:

> **Je otevřený framework užitečný jako služba sám o sobě, nebo je bez naší
> hostované nadstavby jen prázdná skořápka?**

- **Skořápka bez ceny bez našeho mozku** → licence kódu je pro moat skoro kosmetická
  → můžeš si dovolit *pravé* open source (AGPL) kvůli legitimitě a étosu commons.
- **Užitečný i samostatně** → potřebuješ **fair-code**, který hostování-jako-službu
  přímo zakáže (n8n SUL / Elastic v2).

| Volba | Dovolí | Zakáže | „Služba jen pro nás"? | Pravé OSS (OSI)? | Poznámka |
|---|---|---|---|---|---|
| **AGPL-3.0** | použití, úpravy, nasazení u klientů, i hostování | uzavřít fork (nutí zveřejnit změny) | **NE** — kdokoli smí hostovat, když zveřejní zdroj | Ano | §13 riziko pro tebe: drž nadstavbu striktně oddělenou, jinak copyleft sáhne i na ni; část enterprise klientů AGPL odmítá |
| **n8n Sustainable Use License** | použití pro sebe, úpravy, nasazení u klientů | nabízet to **jako službu třetím stranám** | **ANO** | Ne (fair-code) | Přesně model, na který se odkazuješ („ala n8n") |
| **Elastic License v2** | totéž, čistší a kratší text | managed service, obcházení klíče, mazání notices | **ANO** | Ne (fair-code) | Nejčitelnější varianta |
| **+ časovač (BSL/FSL)** | dnes restrikce, později uvolnění | — | dočasně ANO | později ano | Po 2–4 letech se překlopí do Apache/MIT (étos „jednou commons") |

**Doporučení narovinu:** jestli je „**službu provozujeme my**" tvrdá čára (a ty to říkáš
opakovaně), pak **AGPL není ten přesný nástroj — fair-code (Elastic v2, nebo n8n SUL) ano.**
AGPL hostování *nezakazuje*, jen nutí konkurenta zveřejnit jeho úpravy. AGPL si vyber
jen tehdy, když ti víc záleží na „pravé open source + commons" než na exkluzivitě
hostingu — a vědomě počítáš s tím, že moat ti drží **ochranná známka + hostovaný mozek**,
ne licence.

**Default, který bych ti dal:** **Elastic License v2** na otevřenou vrstvu (přesně sedí,
krátká, čitelná) + nadstavba proprietární a hostovaná + lehký CLA. Pokud chceš commons
étos a OSI nálepku, **AGPL** — ale pak vědomě pustíš exkluzivitu hostingu.

---

## 4. Neporušujeme tím nějaké licence? (závislosti)

- **Tvůj vlastní kód:** relicence z dnešní **Apache-2.0** na cokoli výše je tvoje právo —
  držíš copyright a příchozí příspěvky byly pod Apache (kompatibilní). Žádný problém.
- **Permisivní závislosti** (MIT/BSD/Apache/OFL — React, Vite, TypeScript, Tailwind,
  Keycloak, Fastify, Zod, PostgREST, Playwright, Nunito Sans…): bez problému, mohou být
  v projektu pod kteroukoli z výše uvedených licencí.
- **Dvě závislosti hlídat** — nejsou OSS a **nejsou pod tvojí licencí**:
  - **n8n (Sustainable Use License)**
  - **Elasticsearch (SSPL)**

  Drž je jako **oddělené služby** (běží vedle, voláš je přes API). Nevendoruj jejich
  zdroják do svého repa, nepřelicencovávej je a nenabízej *je samotné* jako službu.
  Tvůj `NOTICE` je už dnes správně eviduje.

---

## 5. Veřejně na GitHubu — ano, ale dvě branky napřed

Veřejný repo **neztrácí ochranu** (moat = hostovaný mozek + známka). Než přepneš na public:

1. **Projeď CELOU git historii gitleaksem** (máš ho). `.gitignore` je zralý — ignoruje
   `.env*`, PII rostery, PKI klíče, `.backup/` — ale to chrání jen pracovní strom, **ne
   staré commity**. Co bylo někdy commitnuté, vyčisti z historie (`git filter-repo`).
2. **Drž proprietární nadstavbu v odděleném (privátním) repu/službě** — zvlášť pokud
   zvolíš AGPL (kvůli §13, aby copyleft nesáhl na tvůj mozek).
3. **Zkontroluj `NOTICE` a hlavičky** — známky AISHA / Evymo / Dirigent nejsou součástí
   licence kódu (fork smí kód, ne tvé jméno).

---

## 6. Registrace — povinná, nebo ne?

- **K použití otevřeného kódu:** NE, nepovinná (jinak to není „volně použitelné").
- **K přístupu do komunity, sektorové podpory a hostované službě:** ANO. Tak to mají
  i ostatní — otevřený kód zdarma, účet pro službu.
- **Známka & „powered by AISHA":** forky smí použít kód, ne tvoje jméno; „powered by
  AISHA" jen pro registrované / licencované.

---

## 7. Otevřené otázky pro právníka + další kroky

1. ~~Potvrdit volbu licence~~ → **ROZHODNUTO: Elastic License 2.0.** Právník zvaliduje
   znění `LICENSE` proti oficiálnímu textu (elastic.co/licensing/elastic-license).
2. **Dual-licensing:** komerční licence pro klienty, kteří fair-code/AGPL nechtějí
   (umožní to CLA).
3. **Entita a známka:** registrace ochranné známky AISHA (a sektorových názvů zvlášť,
   ať si nezamkneš ruce).
4. **Finální texty:** LICENSE + CLA (individuál + entita) + krátké hlavičky do zdrojáků.
5. **Hotovo (2026-06-06):** `LICENSE` (ELv2), `NOTICE`, `package.json` (`Elastic-2.0`),
   `CLA.md` (draft) a sekce v `CONTRIBUTING.md` jsou v repu. Před zveřejněním právník
   zvaliduje znění proti oficiálnímu zdroji.

---

## Rychlé shrnutí (pro tebe, ne pro právníka)

- Model = **otevřený kód + hostovaná placená služba** (ala n8n). ✔ to je ono.
- **Nadstavba = naše služba** (modely + routing/vyhodnocení). ✔
- **Registrace:** ne pro kód, ano pro službu/komunitu. ✔ tak to mají i ostatní.
- **Veřejně na GitHubu:** ano, klidně hned — po gitleaks historii a oddělení mozku.
- **Licence: ROZHODNUTO — Elastic License 2.0.** AGPL zamítnuto (nezakazuje
  konkurenční hosting; pro „službu jen my" je ELv2 přesný nástroj).
