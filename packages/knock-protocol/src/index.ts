/**
 * `@aisha/knock-protocol` — drátový formát zaťukání na dveře.
 *
 * JEDNO MÍSTO PRAVDY pro tři konzumenty s různým prostředím:
 *   - brána (Node) — ověřuje rámec doručený HTTPS dotazem
 *   - samostatný UDP kontejner (Node) — ověřuje rámec z datagramu
 *   - mobilní aplikace (React Native) — rámec sestavuje
 *
 * Proto je jádro bez krypto závislosti a hašování se předává zvenčí
 * (`KnockCrypto`); Node adaptér je v `./node`, mobil si dodá vlastní.
 *
 * Referenční prototyp, ze kterého to vzniklo: `artefakty/spa-poc/` v instančním
 * repu (109 testů). Rozdíly proti němu jsou vědomé a jsou dva:
 *   1. `Uint8Array` místo `Buffer` — jinak by to v React Native neběželo
 *   2. TOTP nad SHA-256 místo SHA-1 — aby konzument potřeboval JEDINOU
 *      hašovací funkci; RFC 6238 to dovoluje a nic nasazeného se tím nemění
 */
export * from './bytes.js';
export * from './client-ip.js';
export * from './crypto.js';
export * from './derive.js';
export * from './frame.js';
export * from './otp.js';
export * from './request.js';
export * from './verify.js';

// `./door` se ZÁMĚRNĚ nereexportuje z kořene: potřebuje typy `ioredis`, kdežto
// kořen má zůstat bez závislostí, aby ho pobral i React Native. Kdo dveře
// obsluhuje (listener, brána, edge), importuje `@aisha/knock-protocol/door`.
