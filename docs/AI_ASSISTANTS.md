# AI asistenti (Copilot/Gemini/Codex…)

Cíl: aby kdokoliv (člověk i AI) pracoval konzistentně, bezpečně a s minimem šumu.

## Zdroj pravdy pro instrukce

- Univerzální instrukce pro všechny nástroje: [AGENTS.md](../AGENTS.md)
- GitHub Copilot specificky: `.github/copilot-instructions.md`

Pokud konkrétní nástroj podporuje „custom instructions“, vložte mu obsah z [AGENTS.md](../AGENTS.md) (a případně doplňte tool-specific poznámky).

## Doporučený režim práce

- Nejprve najdi skutečný root-cause (ne workaround).
- Dělej malé, ověřitelné změny.
- Po změnách vždy spusť `npm run test:run` a `npm run build`.

## E2E testování

- Návod pro lokální i remote běh Playwright testů: [docs/testing/E2E.md](testing/E2E.md)

## Citlivá data

- Žádné sensitive data do logů, testů, screenshotů, commit message.
- Chyby v auth/roles ber jako bezpečnostní incident (minimálně interně).
