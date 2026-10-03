# AISHA Platform

Jazykové verze:

- English: [README.md](README.md) (primární, zdrojová verze)
- Čeština: [README.cs.md](README.cs.md) (tento soubor)

> **Veřejná alfa (public alpha preview)** · verze `0.9.0-alpha.3` · [Elastic License 2.0](LICENSE)

Tento repozitář na GitHubu je **snímek bez historie** z upstream repozitáře údržbářů. Vývoj
probíhá v jejich vlastní forge; každé veřejné vydání vzniká z ověřeného snímku známého upstream
commitu (postup: [docs/release/PUBLIC_PREVIEW.md](docs/release/PUBLIC_PREVIEW.md)).

AISHA je samostatně hostovaná, samospravující platforma, ve které autonomní AI dirigent — **AISHA
Dirigent** — řídí dodávku softwaru a provoz: drží znalostní bázi a expertní pravidla, dohlíží na
agenty v editorech vývojářů, spouští brány kvality a souladu, nasazuje stack a léčí ho. Platforma je
**obecná šablona**: vše, co identifikuje konkrétní nasazení (domény, tajemství, operátoři, obsah,
právní texty), se vkládá při nasazení z privátního překryvu *instance-data*, nikdy sem.

## Česká verze dokumentace

Úplná dokumentace je vedena **anglicky** v [README.md](README.md). Česká verze tohoto souboru
i dalších veřejných dokumentů (`*.cs.md`) se generuje strojovým překladem z anglických zdrojů
při každém veřejném vydání a může za anglickou verzí dočasně zaostávat. Platí anglický text.

Rychlé odkazy:

- Dvě cesty dovnitř (vlastní instance / připojení editoru k hostované AISHE):
  [docs/onboarding/CONNECTION_GUIDE.md](docs/onboarding/CONNECTION_GUIDE.md)
- Architektura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Nasazení a provoz: [docs/deploy/](docs/deploy/)
- Bezpečnost: [SECURITY.md](SECURITY.md)
- Přispívání: [CONTRIBUTING.md](CONTRIBUTING.md) (česká verze: [CONTRIBUTING.cs.md](CONTRIBUTING.cs.md))

## License

Zdrojový kód v tomto repozitáři je licencován pod **Elastic License 2.0** (ELv2) — fair-code
model ve stylu n8n. Kód smíte používat, upravovat, provozovat pro sebe i nasazovat u svých klientů;
nesmíte ho nabízet třetím stranám jako hostovanou nebo spravovanou službu, obcházet licenční klíč
ani odstraňovat licenční poznámky.

Hostovaná služba **AISHA** (interní modely, vyhodnocování a směrování dotazů) je samostatná
proprietární nabídka provozovaná společností Evymo s.r.o. a není součástí tohoto repozitáře.

Výjimka: `packages/n8n-nodes-aisha` je záměrně pod licencí MIT (konvence komunity n8n).

Plné znění: [LICENSE](LICENSE) · [NOTICE](NOTICE) · [docs/LICENSING_INTENT.md](docs/LICENSING_INTENT.md) · [CLA.md](CLA.md)
