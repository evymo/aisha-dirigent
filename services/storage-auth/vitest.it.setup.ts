// Vstupy integrační lajny — DEKLARACE, ne přebití.
//
// ⛔ NAMĚŘENO 2026-08-24: konfigurační blok `env:` hodnoty přebíjí BEZPODMÍNEČNĚ.
// U svc-blockchain jsem tím vnutil testovací řetězec místo skutečného tokenu,
// který lajně dodává CI — PostgREST pak odpověděl 401
// `JWSError (Expected 3 parts; got 1)`, protože to nebyl JWT.
//
// Proto `??=`: když hodnotu dodá prostředí (CI, docker-compose.av-it.yml),
// zůstane. Když ji nedodá nikdo, tyhle testy ji stejně nepoužijí — jen se bez
// ní nedá importovat `config.ts`, který ji od 2026-08-24 VYŽADUJE.
process.env.POSTGREST_URL ??= "http://test-postgrest.invalid:3000";
process.env.KEYCLOAK_URL ??= "http://test-keycloak.invalid:8080";
process.env.KEYCLOAK_REALM ??= "testrealm";
