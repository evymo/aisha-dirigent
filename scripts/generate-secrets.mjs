#!/usr/bin/env node
/**
 * generate-secrets.mjs
 *
 * Single-process secret generation for aisha-cold-start.sh step 2.
 * Replaces ~60 openssl/python3/bash subprocess forks with ONE node invocation.
 *
 * Performance: ~60ms (single process) vs ~2-3s (60+ subprocess forks).
 *
 * Usage (called by aisha-cold-start.sh):
 *   eval "$(node scripts/generate-secrets.mjs \
 *     --env-coolify "$ENV_COOLIFY" \
 *     --preserve "${PRESERVE_STATEFUL_SECRETS:-1}" \
 *     --strength-floor "$STRENGTH_FLOOR" \
 *     --netbird-mgmt-host "${NETBIRD_MGMT_HOST:-host-gateway}" \
 *     --nocodb-admin-email "${NOCODB_ADMIN_EMAIL:-admin@example.com}")"
 *
 * Output: one `KEY='value'` line per secret. All generated values use
 * characters safe for single-quoting (base64url / hex / words).
 */

import crypto from 'node:crypto';
import { deriveSubnets, resolverFor, ipInCidr, NETBIRD_PEER_CIDR } from './lib/derive-subnets.mjs';
import { hlaskyPovinnychKlicu, jeHlaskaMistoHodnoty } from './lib/hlasky-z-compose.mjs';
import { posudVapidPar, vyrobVapidPar } from './lib/vapid-par.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return undefined;
}

const envCoolifyPath  = getArg('env-coolify')        ?? process.env.ENV_COOLIFY              ?? '';
const envBackupPath   = getArg('env-backup')         ?? process.env.ENV_PROD_BACKUP          ?? '';
const preserve        = (getArg('preserve')          ?? process.env.PRESERVE_STATEFUL_SECRETS ?? '1') !== '0';
// Pořadí zdrojů: výslovný argument → ZJIŠTĚNÁ adresa uzlu, kde netbird podle
// topologie běží (generate-coolify-context emituje <SLUŽBA>_HOST_ADDR) →
// hodnota v prostředí → `host-gateway` pro jednouzlovou instalaci, kde je
// hostitel a management totéž. Zjištěná adresa stojí PŘED prostředím záměrně:
// prostředí nese to, co bylo, kdežto topologie to, co je.
// ⛔ `||`, ne `??`. `getArg` vrací PRÁZDNÝ ŘETĚZEC, když volající předá
// `--netbird-mgmt-host=""` — a cold-start to dělá vždy, když proměnná není
// nastavená. S `??` prázdný argument PŘEBIL odvozenou adresu a výsledkem byla
// prázdná hodnota, tedy horší stav než ta zastaralá, kterou jsme opravovali.
// Naměřeno porovnáním vygenerovaného výstupu proti nasazenému env, PŘED zápisem.
const netbirdMgmtHost = getArg('netbird-mgmt-host')
  || process.env.NETBIRD_HOST_ADDR
  || process.env.NETBIRD_MGMT_HOST
  || 'host-gateway';
// Mesh TLD drives the internal service hostnames (netbird.<tld>, backend.<tld>).
// Per-instance so a FORK's peers/queues live on ITS mesh, not the donor's
// mesh.aisha.internal. Default keeps the upstream instance byte-identical.
const meshTld         = (getArg('mesh-tld')           ?? process.env.MESH_TLD                  ?? 'mesh.aisha.internal').trim().replace(/^\.+|\/+$/g, '');
// ── Instance-owned mesh-DNS network ─────────────────────────────────────────
// A stable, collision-free home for the single-purpose NetBird resolver. The
// resolver (mesh-router) pins ipv4_address on THIS network; consumers attach to
// it and point dns: at MESH_DNS_RESOLVER_IP. Because we own the address space,
// the resolver IP is a DETERMINISTIC constant — NETBIRD_DNS_IP no longer churns
// with Coolify's dynamic coolify-network IPAM and survives any restart. Subnet
// is instance-scoped: override MESH_DNS_SUBNET if two instances ever share a
// docker host (their mesh-dns nets must not collide). See memory tenant-jednoucelove-dns-navrh.
// Override-only: prázdné = ODVOĎ z identity (viz deriveSubnets níž, po deployPrefix).
// Literální default `10.99.0.0/24` tu byl instanční kolizní past — dvě instance
// na jednom hostu dostaly TÝŽ subnet. Odvození je deterministické z deployPrefixu.
// Hodnota se počítá NÍŽ, přes `declaredOverride` — potřebuje vault (`backup`),
// aby uměla odlišit deklaraci od ozvěny vlastního výstupu.
//
// Pin HIGH in the subnet (the .250 host), OUT of the dynamic-allocation path. Docker
// assigns bridge IPs low-first (.2, .3, …), so consumers that share this network
// never reach a high host — the resolver's pin can't lose the race to a consumer
// that grabbed .2 first (which is exactly what broke a low pin on first deploy).
// --strength-floor=1 / AISHA_SECRET_STRENGTH_FLOOR=1 — passed by aisha-cold-start.sh
// on --wipe runs (volumes purged → safe to re-key STATEFUL secrets too). Without
// it, stateful below-floor values are only WARNed about, never changed (re-keying
// a live DB password breaks stacks whose images don't reconcile roles on start —
// netbird-db / langfuse use stock postgres images, unlike aisha-db's pg17).
const strengthFloor   = (getArg('strength-floor')    ?? process.env.AISHA_SECRET_STRENGTH_FLOOR ?? '0') === '1';

// ⛔ STACK UŽ EXISTUJE → NEPŘÍTOMNÝ VSTUP JE „NEVÍM", NE „NIC TAM NENÍ"
// (naměřeno 2026-09-20/21 na nasazení jiné instance). Čerstvý worktree neměl ani
// `.env.coolify`, ani `.env-prod-backup` — oba jsou gitignored, takže v novém
// checkoutu prostě nejsou. `firstNonEmpty` pak nenašel NIC a `pg()` bez váhání
// vymintoval nové hodnoty: ze 197 spravovaných klíčů bylo 94 jiných, mezi nimi
// PKI_SVAULT_KEY, COLUMN_ENCRYPTION_KEY, COSMOS_SIGNER_MNEMONIC, N8N_ENCRYPTION_KEY.
// Klíč CA pak nešel dešifrovat („vault instance id does not match"), vydávání
// certifikátů se zastavilo — a NIC NESPADLO. Generátor proběhl správně.
//
// Ochrana stavových klíčů (`--preserve`) tu přitom byla — jenže chrání jen
// HODNOTY, KTERÉ VIDÍ. Když nevidí nic, nemá čeho se chytit.
//
// Závora proto stojí na VSTUPU, ne u mintování: volající, který ví, že stack
// existuje (cold-start `--skip-create`), to řekne, a generátor pak stavový klíč
// bez vstupu NEVYROBÍ — odmítne běh, vyjmenuje dotčené klíče a řekne, odkud je
// obnovit. Wipe (`--strength-floor`) je výjimka: svazky jsou smazané, takže
// nový klíč nic nezničí.
//
// Bezpečnostní přepínač: přijímá JEN 0/1. Cokoli jiného (`true`, `yes`, překlep)
// by se jinak tiše vyhodnotilo jako „stack neexistuje" a generátor by klíče
// vyrobil — tedy přesně to, čemu závora brání. Výslovný přepínač má přednost
// před prostředím; nepřítomnost obou = volající nic netvrdí (první instalace).
const stackExistsHodnota = getArg('stack-exists') ?? process.env.AISHA_STACK_EXISTS;
if (stackExistsHodnota !== undefined && stackExistsHodnota !== '0' && stackExistsHodnota !== '1') {
  process.stderr.write(`⛔ [generate-secrets] --stack-exists / AISHA_STACK_EXISTS přijímá jen 0 nebo 1, ne '${stackExistsHodnota}'.\n`);
  process.exit(2);
}
const stackExists     = stackExistsHodnota === '1';

// ── Existing env file parser (same logic as preserve_or_gen in bash) ────────

function parseEnvFile(filePath) {
  const result = {};
  if (!filePath || !fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    // Match KEY=rest-of-line, then strip an inline comment (see stripInlineComment).
    // .env-style files carry format hints as trailing comments
    // (config/domains.env.example `KEY=   # https://...`); without this strip the
    // comment leaks AS the value, shadowing the derived instance-data/web-design
    // URL → overlay never applied (2026-06-30).
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      result[key] = stripInlineComment(line.slice(eq + 1));
    }
  }
  return result;
}

const existing = parseEnvFile(envCoolifyPath);
const backup = parseEnvFile(envBackupPath);

// Strip a `# comment` (leading, or whitespace-preceded) where the `#` is followed
// by whitespace. A `#` glued to text stays literal — URL fragment `...git#main`,
// color `#FF6A1A`, token. Single point of truth: parseEnvFile (file values) AND
// cleanEnvValue (process.env values) both use it, so a shell-leaked comment
// (`export KEY=   # https://...` from the domains.env.example fallback,
// aisha-cold-start.sh:625-634) can never shadow a derived URL.
function stripInlineComment(s) {
  return String(s ?? '').replace(/(^|\s)#\s.*$/, '');
}

function cleanEnvValue(value) {
  return stripInlineComment(value).trim().replace(/^["']|["']$/g, '');
}

/**
 * Override je DEKLARACE, ne OZVĚNA vlastního výstupu.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * Odvozená hodnota (subnet z identity) má override kanál pro případ, že si dvě
 * instance sednou na týž hostitel. Jenže ten kanál je `process.env`, a cold-start
 * do prostředí sype CELÝ vault (`load_env_file_keys "$ENV_PROD_BACKUP" overwrite`,
 * aisha-cold-start.sh). Do vaultu přitom píše `coolify-pull-envs.mjs` to, co je
 * nasazené v Coolify — tedy náš VLASTNÍ výstup z minula. Kruh je uzavřený:
 *
 *   generate-secrets → Coolify → coolify-pull-envs → vault → env → „override"
 *
 * Odvození se pak nikdy nedostane ke slovu a zděděná hodnota je nesmrtelná.
 * NAMĚŘENO 2026-08-13: vault nesl subnet, který na varře už držel cizí nájemník;
 * odvozený rozsah byl volný. `preservedValue` byl kvůli přesně tomuhle zavřený
 * (viz komentář u subnetů níž) — hodnota se vrátila druhými dveřmi.
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * 1. Výslovný CLI argument je vždy deklarace — vyhrává.
 * 2. Hodnota z prostředí SHODNÁ s vaultem je ozvěna → ignoruj, odvoď znovu.
 * 3. Hodnota z prostředí ODLIŠNÁ od vaultu je čerstvá deklarace (operátorský
 *    export nebo .env.local, který vault ještě nepřebil) → ctít.
 *
 * Bod 3 drží operátorský kanál otevřený: kdo chce rozsah zvolit, dostane ho.
 * Ozvěna se pozná tím, že se ROVNÁ tomu, co jsme sami minule vydali.
 *
 * @param {string} argName jméno CLI argumentu (bez `--`)
 * @param {string} key jméno proměnné prostředí
 * @returns {string} deklarovaná hodnota, nebo '' když se má odvodit
 */
function declaredOverride(argName, key) {
  const explicit = String(getArg(argName) ?? '').trim();
  if (explicit) return explicit;

  const fromEnv = cleanEnvValue(process.env[key] ?? '');
  if (!fromEnv) return '';

  const echo = cleanEnvValue(backup[key] ?? '');
  if (echo && fromEnv === echo) {
    console.warn(
      `[generate-secrets] ${key} v prostředí je jen ozvěna vaultu (${envBackupPath || '.env-prod-backup'}), ` +
        `ne deklarace — odvozuji hodnotu z identity instance. ` +
        `Chtěnou volbu předej jako --${argName} (nebo hodnotu ve vaultu smaž).`,
    );
    return '';
  }
  return fromEnv;
}

// ⛔ HLÁŠKA NENÍ HODNOTA (naměřeno 2026-09-16 na guru). Trezor nesl u
// KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET a EXTRANET_OIDC_SECRET doslovný text
// z `${KLIC:?…}` v compose; generátor ho zachovával přes každý běh i wipe, import
// realmu ho dosadil jako SECRET klienta `aisha-user-admin` (servisní účet s právem
// spravovat uživatele) — a ten text je veřejně v repu. env-doktor to od #992
// HLÁSIL, generátor to dál ZACHOVÁVAL. Hláška se proto čte jako CHYBĚJÍCÍ hodnota:
// odvozené/statické klíče dostanou svou výchozí hodnotu, tajemství čerstvou —
// a klíč se zapíše do `hlaskyVTrezoru`, aby běh u stavových tajemství nahlas
// řekl, že cílový systém (realm) musí dostat novou hodnotu také.
const HLASKY_Z_COMPOSE = hlaskyPovinnychKlicu(path.join(__dirname, '..'));
const hlaskyVTrezoru = new Set();

function firstNonEmpty(key) {
  for (const source of [backup, process.env, existing]) {
    const value = source[key];
    if (value === undefined || value === '') continue;
    const cista = cleanEnvValue(value);
    if (jeHlaskaMistoHodnoty(key, cista, HLASKY_Z_COMPOSE)) {
      if (!hlaskyVTrezoru.has(key)) {
        hlaskyVTrezoru.add(key);
        warn(`${key}: hodnotou je HLÁŠKA z \`\${${key}:?…}\` v compose, ne hodnota — ZAHAZUJI ji a dosazuji skutečnou (veřejný text nesmí zůstat tajemstvím).`);
      }
      continue;
    }
    return cista;
  }
  return undefined;
}

function preservedValue(key, fallback = '') {
  const value = firstNonEmpty(key);
  return value === undefined ? fallback : value;
}

// Mesh-DNS rozsah a jeho resolver — jediné dva override kanály, jejichž ZÁLOŽNÍ
// hodnota je ODVOZENÁ (ostatní mají literální default, tedy pravé deklarace).
// Právě u odvozených dává ozvěna vaultu smysl odmítnout: odvození je
// deterministické, takže o nic nepřijdeme — jen o setrvačnost. Deklarace ano.
const meshDnsSubnetOverride = declaredOverride('mesh-dns-subnet', 'MESH_DNS_SUBNET');
const meshDnsResolverIpOverride = declaredOverride('mesh-dns-resolver-ip', 'MESH_DNS_RESOLVER_IP');

// deriveSubnets žije v scripts/lib/derive-subnets.mjs — tenhle soubor se při
// importu SPUSTÍ, takže čistá funkce v něm nešla otestovat (viz import výš).

/**
 * Zachovej adresu — ale NE takovou, která nemůže fungovat.
 *
 * `preservedValue` recykluje existující hodnotu napořád. U adresy se sentinelem
 * `@…invalid` (nebo `@example.*`) to znamená, že se jednou zapsaná značka
 * „operátor ji nenastavil" už nikdy sama nenahradí odvozenou — a pgAdmin na ní
 * padal v restartovací smyčce od 15. 12., protože `.invalid` doménu odmítá jako
 * nedoručitelnou.
 *
 * Je to táž třída jako „preserved-secret strength floor" níž: hodnota, která
 * NEPROJDE politikou, se nemá zachovávat, ale přegenerovat. Operátorem zadaná
 * adresa se zachová beze změny — sentinel není adresa.
 */
function isSentinelEmail(value) {
  if (!value || !value.includes('@')) return true;
  const domain = value.slice(value.indexOf('@') + 1).toLowerCase();
  return domain.endsWith('.invalid') || /^example\.(com|org|net)$/.test(domain);
}

function preservedEmail(key, fallback = '') {
  const value = firstNonEmpty(key);
  if (value === undefined) return fallback;
  return isSentinelEmail(value) ? fallback : value;
}

/**
 * Adresa z CLI — ale sentinel se nepočítá jako zadaná hodnota.
 *
 * `aisha-cold-start.sh` volá tenhle generátor s
 *
 *     --nocodb-admin-email="${NOCODB_ADMIN_EMAIL:-${SMTP_ADMIN_EMAIL:-admin@example.invalid}}"
 *
 * tedy sentinel PŘEDÁVÁ jako argument. A argument má přednost před odvozením,
 * takže by oprava uvnitř generátoru neplatila právě při cold startu — jediné
 * cestě, kterou se tyhle hodnoty do .env.coolify dostávají.
 *
 * Filtr je proto TADY, ne u volajícího: opraví se tím každý volající najednou
 * a nová cesta nemůže sentinel propašovat znovu.
 */
function emailArg(name) {
  const value = getArg(name);
  return value === undefined || isSentinelEmail(value) ? undefined : value;
}

// Central operational admin email — ONE place. All service admin emails cascade
// from ADMIN_EMAIL; operator overrides it in env/.env-prod-backup.
//
// ZÁLOŽNÍ HODNOTA SE ODVOZUJE Z DOMÉNY INSTANCE, ne ze sentinelu.
//
// Dřív tu stálo `admin@example.invalid` — RFC6761 značka „operátor ji ještě
// nenastavil". Čitelný záměr, ale měl cenu: pgAdmin `.invalid` doménu ODMÍTÁ
// jako nedoručitelnou a padal v restartovací smyčce (změřeno 2026-07-29, dole
// od 15. 12.). Značka „nenastaveno" tedy službu nezastavila v konfiguraci, ale
// až za běhu — a env-doctor mlčel, protože klíč vyplněný BYL.
//
// Instance přitom vlastní doménu zná. Odvozená `admin@<PUBLIC_TLD>` je platná,
// per instanci správná a shodná s tím, co už dnes mají NOCODB_ADMIN_EMAIL
// a PLATFORM_ADMIN_EMAIL. Sentinel zůstává jen tam, kde není z čeho odvodit.
const adminEmailDomain = firstNonEmpty('PUBLIC_TLD');
const adminEmail = emailArg('admin-email')
  ?? preservedEmail('ADMIN_EMAIL', adminEmailDomain ? `admin@${adminEmailDomain}` : 'admin@example.invalid');
const nocodbAdminEmail = emailArg('nocodb-admin-email') ?? preservedEmail('NOCODB_ADMIN_EMAIL', adminEmail);

// ── Preserved-secret strength floor ─────────────────────────────────────────
//
// Incident class (verified in production 2026-06-12): pg() recycles ANY existing
// value forever, including legacy values that predate current strength policy.
// A JWT_SECRET preserved at length 20 crashlooped PostgREST on a fresh post-wipe
// stack (PostgREST hard-requires jwt-secret ≥ 32 chars) → core never healthy,
// cold-start aborted. POSTGRES_PASSWORD was similarly preserved at length 9.
//
// Policy:
//  - JWT_SECRET floor = 32 (PostgREST hard constraint). It is STATELESS (signing
//    key only — no volume state) → below-floor values are ALWAYS re-keyed, and
//    the dependent ANON_KEY / SERVICE_ROLE_KEY JWTs are regenerated in the same
//    run (old ones would fail signature verification).
//  - General floor = 24 chars for every other pg()-managed secret. Conservative:
//    every generator here emits ≥ 32 chars (hex(16) = 32, secret(24) = 32 b64url),
//    so a healthy generated value can never trip the floor. These keys may back
//    stateful volumes (DB passwords, encryption keys) → below-floor values are
//    re-keyed ONLY under --strength-floor (wipe runs), otherwise WARN + preserve.
//  - Exempt: identifier-ish / empty-by-design / identity keys where length says
//    nothing about strength or where re-keying loses identity.
const JWT_FLOOR     = 32; // PostgREST: jwt-secret must be ≥ 32 chars
const GENERAL_FLOOR = 24;

const KEY_FLOORS = { JWT_SECRET: JWT_FLOOR };

// Provably stateless: signing material only, no volume/DB state depends on the
// raw value. Safe to re-key on ANY run (dependent JWTs are regenerated below).
const STATELESS_KEYS = new Set(['JWT_SECRET']);

// No floor at all. NOTE: operator-supplied/BYOK keys (OPENAI_API_KEY, RESEND_API_KEY,
// TELEGRAM_*, …) flow through preservedValue(), never pg(), so they are exempt
// by construction and not listed here.
const FLOOR_EXEMPT = new Set([
  'LIVEKIT_API_KEY',          // identifier: 'API' + hex(6) = 15 chars by design
  'MINIO_ROOT_USER',          // username, fixed default 'aisha-minio-admin'
  'COSMOS_SIGNER_MNEMONIC',   // BIP39 validator identity — NEVER auto-re-key
  'PKI_CLIENT_KEY_B64',       // empty-by-design, filled post-deploy
  'NETBIRD_STACK_KEY_FRONTEND',     // empty-by-design, filled by netbird-bootstrap.sh
  'NETBIRD_STACK_KEY_BACKEND',
  'NETBIRD_STACK_KEY_INTEGRATION',
  'NETBIRD_STACK_KEY_EXPERIMENTAL',
  // ⛔ DRUHÁ POLOVINA PÁRU. Klíč sám neřekne, KTERÝ to v NetBirdu je — to říká
  // jeho `_ID`. Bez něj `netbird-bootstrap.sh` nemůže existující klíč ověřit
  // a raději ho přerazí, což vždy strhne redeploy CELÉ flotily. Naměřeno
  // 2026-08-15: „present but *_ID is missing — regenerating" u všech čtyř,
  // při KAŽDÉM běhu, protože se `_ID` nezachovávalo přes přegenerování.
  'NETBIRD_STACK_KEY_FRONTEND_ID',
  'NETBIRD_STACK_KEY_BACKEND_ID',
  'NETBIRD_STACK_KEY_INTEGRATION_ID',
  'NETBIRD_STACK_KEY_EXPERIMENTAL_ID',
]);

/** Keys re-keyed by the floor in this run (drives dependent regeneration). */
const rekeyedKeys = new Set();

/** Stavové klíče, které by se nad EXISTUJÍCÍM stackem vymintovaly bez vstupu.
 *  Sbírají se všechny, ne jen první — obsluha při obnově potřebuje seznam, ne dohad. */
const stavoveBezVstupu = new Set();

function warn(message) {
  // stderr ONLY — stdout is eval'd by aisha-cold-start.sh.
  process.stderr.write(`WARN [generate-secrets] ${message}\n`);
}

/** Return explicit/prod-backup/existing value if preserve mode + key non-empty, else call generator.
 *  Preserved values below the per-key strength floor are discarded (stateless
 *  keys: always; stateful keys: only under --strength-floor) — see policy above. */
function pg(key, generator) {
  if (preserve) {
    const value = firstNonEmpty(key);
    if (value !== undefined) {
      const floor = FLOOR_EXEMPT.has(key) ? 0 : (KEY_FLOORS[key] ?? GENERAL_FLOOR);
      if (value.length >= floor) return value;
      const stateless = STATELESS_KEYS.has(key);
      if (stateless || strengthFloor) {
        rekeyedKeys.add(key);
        warn(
          `${key}: preserved value (length ${value.length}) is below the strength floor (${floor}) — ` +
          `DISCARDED, generating fresh. ` +
          (key === 'JWT_SECRET'
            ? 'PostgREST hard-requires jwt-secret >= 32 chars (a weak preserved value crashloops PostgREST); dependent ANON_KEY/SERVICE_ROLE_KEY are regenerated in this run. '
            : '') +
          `Cause: ${stateless ? 'key is stateless (safe to re-key any run)' : '--strength-floor active (wipe run, volumes purged)'}. ` +
          `Anything still presenting the old value must be re-issued.`,
        );
      } else {
        warn(
          `${key}: preserved value (length ${value.length}) is below the strength floor (${floor}) ` +
          `but the key may back stateful volumes — PRESERVED unchanged (re-keying on a non-wipe run ` +
          `could break running stacks). Rotate it manually, or run cold-start --wipe ` +
          `(passes --strength-floor) to re-key it safely.`,
        );
        return value;
      }
    }
  }
  const vyrobeno = typeof generator === 'function' ? generator() : generator;
  // Prázdná hodnota „z principu" (NETBIRD_STACK_KEY_*, PKI_CLIENT_KEY_B64 — plní je
  // až bootstrap) není nový kryptoklíč, takže závoru nespouští. Bezstavový
  // JWT_SECRET se smí vyrobit kdykoli (závislé JWT se přegenerují v tomtéž běhu).
  if (preserve && stackExists && !strengthFloor && !STATELESS_KEYS.has(key) && vyrobeno !== '') {
    stavoveBezVstupu.add(key);
  }
  return vyrobeno;
}

// ── Generators (all in-process — no subprocess forks) ───────────────────────

/** N random bytes as lowercase hex string. */
function hex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** N random bytes as standard base64, no newlines (for Go StdEncoding consumers). */
function b64std(bytes) {
  return crypto.randomBytes(bytes).toString('base64');
}

/**
 * N random bytes as URL-safe base64, no padding, no leading '-'.
 * Matches bash gen_secret(): openssl rand -base64 N | tr -d '\n=' | tr '/+' '_-'
 * with leading-dash retry.
 */
function secret(bytes) {
  let s;
  do {
    s = crypto.randomBytes(bytes).toString('base64url').replace(/=+$/, '');
  } while (s.startsWith('-'));
  return s;
}

/**
 * HS256 JWT signed by jwtSecret.
 * Matches bash gen_aisha_jwt() (python3 hmac.new variant).
 */
function aishaJwt(role, jwtSecret) {
  const b64u = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const h = b64u({ alg: 'HS256', typ: 'JWT' });
  const p = b64u({ role, iss: 'aisha', iat: now, exp: now + 60 * 60 * 24 * 365 * 15 });
  const sig = crypto.createHmac('sha256', jwtSecret)
    .update(`${h}.${p}`)
    .digest('base64url')
    .replace(/=+$/, '');
  return `${h}.${p}.${sig}`;
}

/** BIP39 256-bit mnemonic (24 words) using the bip39 npm package. */
function bip39Mnemonic() {
  const require = createRequire(import.meta.url);
  const bip39Path = require.resolve('bip39', {
    paths: [process.cwd(), path.join(__dirname, '..')],
  });
  const bip39 = require(bip39Path);
  return bip39.generateMnemonic(256);
}

// ── Output collector ─────────────────────────────────────────────────────────

const lines = [];

/**
 * Emit a KEY='value' assignment.
 * All generated values are safe for single-quoting:
 *  - base64url / hex / fixed strings: no single-quote chars
 *  - BIP39 mnemonic: spaces are fine inside single quotes
 *  - JWT tokens: dots and hyphens are fine inside single quotes
 */
function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

const emittedKeys = [];
function emit(key, value) {
  emittedKeys.push(key);
  lines.push(`${key}=${shellQuote(value)}`);
}

// ── Secret definitions (mirrors the bash else-block in step 2) ───────────────

const POSTGRES_PASSWORD   = pg('POSTGRES_PASSWORD',   () => secret(32));  emit('POSTGRES_PASSWORD',   POSTGRES_PASSWORD);
const JWT_SECRET          = pg('JWT_SECRET',           () => secret(48));  emit('JWT_SECRET',           JWT_SECRET);

// ANON_KEY / SERVICE_ROLE_KEY are JWTs SIGNED BY JWT_SECRET — they may only be
// preserved when JWT_SECRET itself was preserved. Whenever JWT_SECRET is fresh
// (absent from all sources, preserve=0, or floor-re-keyed above) the dependents
// MUST regenerate in the same run: keeping old ones produces a signature
// mismatch and PostgREST/Realtime reject every request.
const jwtSecretPreserved = preserve
  && firstNonEmpty('JWT_SECRET') !== undefined
  && !rekeyedKeys.has('JWT_SECRET');

function jwtDependent(key, role) {
  if (jwtSecretPreserved) return pg(key, () => aishaJwt(role, JWT_SECRET));
  if (preserve && firstNonEmpty(key) !== undefined) {
    rekeyedKeys.add(key);
    warn(
      `${key}: preserved value DISCARDED — JWT_SECRET was re-keyed this run and the old ${key} ` +
      `is signed by the previous secret (would fail signature verification). Regenerating.`,
    );
  }
  return aishaJwt(role, JWT_SECRET);
}

const ANON_KEY            = jwtDependent('ANON_KEY', 'anon');                  emit('ANON_KEY',            ANON_KEY);
const SERVICE_ROLE_KEY    = jwtDependent('SERVICE_ROLE_KEY', 'service_role');  emit('SERVICE_ROLE_KEY',    SERVICE_ROLE_KEY);

emit('VAULT_ENCRYPTION_KEY',        pg('VAULT_ENCRYPTION_KEY',        () => hex(32)));
emit('COLUMN_ENCRYPTION_KEY',       pg('COLUMN_ENCRYPTION_KEY',       () => hex(32)));
emit('KEYCLOAK_ADMIN_PASSWORD',     pg('KEYCLOAK_ADMIN_PASSWORD',     () => secret(24)));
emit('KEYCLOAK_DB_PASSWORD',        pg('KEYCLOAK_DB_PASSWORD',        () => secret(32)));
emit('KEYCLOAK_CLIENT_SECRET',      pg('KEYCLOAK_CLIENT_SECRET',      () => secret(32)));
// aisha-user-admin — servisní účet, kterým gateway zakládá uživatele. Secret se
// PŘEDGENERUJE tady, ne razí Keycloakem: realm šablona ho dosazuje na místo
// ${KC_ADMIN_CLIENT_SECRET} při renderu, gateway čte TUTÉŽ proměnnou, a obě to
// musí být jedna hodnota. Bez generátoru zůstane prázdná: v realmu by přistál
// LITERÁL "${KC_ADMIN_CLIENT_SECRET}" jako heslo klienta a gateway by cestu
// napořád hlásila jako nenakonfigurovanou (503) — tichý stav, který vypadá
// jako rozhodnutí operátora, ačkoli je to chybějící článek dodávky.
emit('KC_ADMIN_CLIENT_SECRET',      pg('KC_ADMIN_CLIENT_SECRET',      () => secret(32)));
// aisha-pki-issuer client_credentials secret — PRE-GENERATED here (not minted by
// Keycloak) so it lands in .env.coolify → is synced onto aisha-pki BEFORE that
// stack's wave-2 deploy. The pki-renewer sidecar (docker-compose.coolify-pki.yml)
// then holds the correct secret at container start; container env is immutable
// after start, so a KC-minted secret PATCHed in later (during bootstrap) would
// never reach the running renewer. aisha-bootstrap-user-init.sh Step 10b creates
// the KC 'aisha-pki-issuer' client WITH this exact value, so the renewer
// authenticates as soon as Keycloak is up — no post-boot redeploy needed.
emit('AISHA_PKI_ISSUER_CLIENT_SECRET', pg('AISHA_PKI_ISSUER_CLIENT_SECRET', () => secret(32)));
emit('LANGFUSE_DB_PASSWORD',        pg('LANGFUSE_DB_PASSWORD',        () => secret(32)));
emit('LANGFUSE_OIDC_SECRET',        pg('LANGFUSE_OIDC_SECRET',        () => secret(32)));
emit('LANGFUSE_NEXTAUTH_SECRET',    pg('LANGFUSE_NEXTAUTH_SECRET',    () => secret(32)));
emit('LANGFUSE_SALT',               pg('LANGFUSE_SALT',               () => secret(32)));
emit('LANGFUSE_ENCRYPTION_KEY',     pg('LANGFUSE_ENCRYPTION_KEY',     () => hex(32)));
emit('LANGFUSE_PUBLIC_KEY',         preservedValue('LANGFUSE_PUBLIC_KEY', 'pk-lf-aisha-prod'));
emit('LANGFUSE_SECRET_KEY',         pg('LANGFUSE_SECRET_KEY',         () => `sk-lf-${hex(16)}`));
emit('LANGFUSE_ADMIN_EMAIL',        preservedEmail('LANGFUSE_ADMIN_EMAIL', adminEmail));
emit('LANGFUSE_ADMIN_PASSWORD',     pg('LANGFUSE_ADMIN_PASSWORD',     () => secret(24)));

// Appsmith admin — email cascades from ADMIN_EMAIL; password generated + preserved.
emit('APPSMITH_ADMIN_EMAIL',        preservedEmail('APPSMITH_ADMIN_EMAIL', adminEmail));
emit('APPSMITH_ADMIN_PASSWORD',     pg('APPSMITH_ADMIN_PASSWORD',     () => secret(24)));

// Platform admin (Keycloak realm seed) — email cascades from ADMIN_EMAIL; the
// TEMPORARY password is generated + preserved. render-realm-and-start.sh
// substitutes these into the realm import so no personal account is in git.
emit('PLATFORM_ADMIN_EMAIL',        preservedEmail('PLATFORM_ADMIN_EMAIL', adminEmail));
emit('PLATFORM_ADMIN_PASSWORD',     pg('PLATFORM_ADMIN_PASSWORD',     () => secret(24)));

emit('N8N_ENCRYPTION_KEY',          pg('N8N_ENCRYPTION_KEY',          () => secret(32)));
emit('N8N_OIDC_SECRET',             pg('N8N_OIDC_SECRET',             () => secret(32)));
emit('N8N_BASIC_AUTH_PASSWORD',     pg('N8N_BASIC_AUTH_PASSWORD',     () => secret(24)));
emit('N8N_DB_PASSWORD',             pg('N8N_DB_PASSWORD',             () => secret(32)));
// Sdílené tajemství neveřejných webhooků n8n (hlavička x-aisha-webhook-token,
// pověření „AISHA Webhook Auth“). Nikdo ho negeneroval → pověření nevzniklo a
// aktivní cron workflowy padaly na „Credentials not found“ (naměřeno 2026-09-17).
emit('N8N_WEBHOOK_AUTH_TOKEN',      pg('N8N_WEBHOOK_AUTH_TOKEN',      () => secret(32)));
// Heslo vlastníka n8n, kterým se bootstrap (n8n-workflow-init) při KAŽDÉM
// nasazení přihlásí a vyrobí API klíč. Dřív náhodné a zahozené → klíč jen při
// prvním nasazení, pak slepá ulička (naměřeno RIQ 2026-09-07, guru 2026-09-18).
emit('N8N_BOOTSTRAP_OWNER_PASSWORD', pg('N8N_BOOTSTRAP_OWNER_PASSWORD', () => secret(32)));

emit('REDIS_PASSWORD',              pg('REDIS_PASSWORD',              () => secret(32)));
emit('REDIS_PASSWORD_CORE',         pg('REDIS_PASSWORD_CORE',         () => secret(32)));
emit('REDIS_PASSWORD_LANGFUSE',     pg('REDIS_PASSWORD_LANGFUSE',     () => secret(32)));
emit('REDIS_PASSWORD_N8N',          pg('REDIS_PASSWORD_N8N',          () => secret(32)));
emit('REDIS_PASSWORD_ADMIN',        pg('REDIS_PASSWORD_ADMIN',        () => secret(32)));

const RABBITMQ_DEFAULT_PASS = pg('RABBITMQ_DEFAULT_PASS', () => secret(32));
emit('RABBITMQ_DEFAULT_PASS',       RABBITMQ_DEFAULT_PASS);
emit('LIVEKIT_API_KEY',             pg('LIVEKIT_API_KEY',             () => `API${hex(6)}`));
emit('LIVEKIT_API_SECRET',          pg('LIVEKIT_API_SECRET',          () => secret(48)));
emit('LIVEKIT_TURN_PASSWORD',       pg('LIVEKIT_TURN_PASSWORD',       () => secret(24)));

emit('MATRIX_REGISTRATION_SHARED_SECRET', pg('MATRIX_REGISTRATION_SHARED_SECRET', () => secret(32)));
emit('MATRIX_MACAROON_SECRET_KEY',        pg('MATRIX_MACAROON_SECRET_KEY',        () => secret(32)));
// Nahrávací tokeny storage-auth (nahrání přes API místo presigned URL MinIA,
// která nese mesh host — z terénu nedosažitelný).
emit('STORAGE_UPLOAD_TOKEN_SECRET',       pg('STORAGE_UPLOAD_TOKEN_SECRET',       () => secret(48)));

// svc-source-broker federation: the broker signs/verifies inbound source
// webhooks with this HMAC. Generated here so coolify-sync-envs.sh bulk-pushes it
// to the broker app; mirror the same value on the source signer.
emit('SOURCE_WEBHOOK_HMAC_SECRET',        pg('SOURCE_WEBHOOK_HMAC_SECRET',        () => secret(48)));
// Klíč trezoru relací federovaného zdroje (ADR-004): broker jím šifruje tokeny uživatelů
// u zdroje (AES-256-GCM). Žije JEN v env aplikace brokeru — nikdy v DB (GUC, PGOPTIONS,
// env služby postgres; brána A15). Zachovává se (pg): nová hodnota = všechny uložené
// relace nečitelné. Rotace je nástroj přes key_id (PR C), ne vedlejší účinek generátoru.
emit('FEDERATION_VAULT_KEY',              pg('FEDERATION_VAULT_KEY',              () => hex(32)));
emit('MATRIX_FORM_SECRET',                pg('MATRIX_FORM_SECRET',                () => secret(32)));
emit('SYNAPSE_DB_PASSWORD',               pg('SYNAPSE_DB_PASSWORD',               () => secret(32)));
emit('SYNAPSE_OIDC_CLIENT_SECRET',        pg('SYNAPSE_OIDC_CLIENT_SECRET',        () => secret(32)));

// ── Web Push (VAPID) ────────────────────────────────────────────────────────
// Klíčový pár P-256 pro webová oznámení. Prohlížeč se přihlásí k odběru
// VEŘEJNÝM klíčem, svc-push podepisuje SOUKROMÝM — a poskytovatel (FCM, Mozilla)
// ověřuje, že k sobě patří.
//
// ⛔ PROČ PÁR NARAZ A NE DVĚ NEZÁVISLÁ `pg()`: půlka páru je HORŠÍ než žádný
// klíč. Kdyby se zachoval starý veřejný a vygeneroval nový soukromý, prohlížeč
// by se dál hlásil k odběru starým klíčem, server by podepisoval novým a
// poskytovatel by odmítl s 403 — bez jediného zápisu u nás. Proto se zachovává
// jen ÚPLNÝ pár; chybí-li kterákoli polovina, vyrábí se nový a obě se přepíší.
// Cena přepsání je známá a snesitelná: odběry vzniklé pod starým klíčem přestanou
// platit a prohlížeč si při příští návštěvě vyžádá nový.
//
// Posudek i výroba žijí v `lib/vapid-par.mjs` — týž, podle kterého jedná
// env-doktor. „Úplný" nestačí: zachovat se smí jen pár, který K SOBĚ PATŘÍ.
// Chybí-li veřejný (nebo je to náhoda, kterou do 2026-09-23 vyráběl doktor
// druhem `secret`), ODVODÍ se ze soukromého — žádná rotace. Stav, který doktor
// odmítne opravit bez člověka (`stop`), tu končí novým párem: generátor běží při
// přestavbě prostředí, kdy je rotace ohlášená cena (viz výš), ne tichý zásah.
const VAPID = (() => {
  if (!preserve) return vyrobVapidPar();
  const posudek = posudVapidPar({
    verejny:  firstNonEmpty('WEB_PUSH_VAPID_PUBLIC_KEY') ?? '',
    soukromy: firstNonEmpty('WEB_PUSH_VAPID_PRIVATE_KEY') ?? '',
  });
  // ⛔ Nad EXISTUJÍCÍM stackem je chybějící vstup „nevím" (viz `stackExists` výš)
  // a nový pár tu znamená rotaci: odběry v prohlížečích tiše zaniknou. Pár nejde
  // přes `pg()`, takže by jeho závoru obešel — proto se k ní hlásí sám. Odvození
  // veřejného klíče ze soukromého nic nemintuje, a závoru proto nespouští.
  if ((posudek.akce === 'vyrobit' || posudek.akce === 'stop') && stackExists && !strengthFloor) {
    if (posudek.akce === 'stop') warn(`VAPID: ${posudek.duvod}`);
    stavoveBezVstupu.add('WEB_PUSH_VAPID_PUBLIC_KEY');
    stavoveBezVstupu.add('WEB_PUSH_VAPID_PRIVATE_KEY');
    return { verejny: '', soukromy: '' }; // nevypíše se — běh na konci odmítne
  }
  if (posudek.akce === 'stop') {
    warn(`VAPID: ${posudek.duvod} → vyrábím NOVÝ pár (rotace; odběry pod starým klíčem zaniknou)`);
    return vyrobVapidPar();
  }
  if (posudek.akce === 'doplnit-verejny' || posudek.akce === 'nahradit-verejny') warn(`VAPID: ${posudek.duvod}`);
  return { verejny: posudek.verejny, soukromy: posudek.soukromy };
})();
emit('WEB_PUSH_VAPID_PUBLIC_KEY',  VAPID.verejny);
emit('WEB_PUSH_VAPID_PRIVATE_KEY', VAPID.soukromy);

emit('REALTIME_SECRET_KEY_BASE',    pg('REALTIME_SECRET_KEY_BASE',    () => hex(64)));
emit('LOGFLARE_API_KEY',            pg('LOGFLARE_API_KEY',            () => secret(24)));
emit('RAGNAROK_API_KEY',            pg('RAGNAROK_API_KEY',            () => secret(32)));
emit('MAESTRO_API_KEY',             pg('MAESTRO_API_KEY',             () => secret(32)));
emit('KRONOS_API_KEY',              pg('KRONOS_API_KEY',              () => secret(32)));
emit('ELASTIC_PASSWORD',            pg('ELASTIC_PASSWORD',            () => secret(32)));
emit('COSMOS_VALIDATOR_PASSWORD',   pg('COSMOS_VALIDATOR_PASSWORD',   () => secret(24)));
// ── DVEŘE NA EDGE ────────────────────────────────────────────────────────────
// ⛔ BEZPEČNOSTNÍ PŘEPÍNAČ MUSÍ PŘEŽÍT WIPE. `.env.coolify` se staví heredocem
// OD NULY; `placeholder` v env-doctoru by doplnil PRÁZDNO, a prázdno znamená
// `off` — dveře by se po přestavbě prostředí TIŠE OTEVŘELY a nikdo by si toho
// nevšiml, protože otevřený edge vypadá jako fungující edge.
// Proto `preservedValue`: hodnota se replayuje z `.env-prod-backup` > prostředí
// > stávajícího `.env.coolify`. Druhá polovina páru je řádek v heredocu
// cold-startu — bez OBOU se klíč neobjeví ani v `--print-keys`.
emit('EDGE_DOOR_MODE',              preservedValue('EDGE_DOOR_MODE', 'off'));
// Adresa Ragnaroku — vlastnost NASAZENÍ, ne platformy (viz env-doctor).
// Bez fallbacku: prázdno je legitimní stav (integrace se prostě nepoužívá),
// ale VYMYSLET adresu by znamenalo tvrdit něco o cizím stacku.
emit('RAGNAROK_URL',                preservedValue('RAGNAROK_URL'));
// KNOCK_UPSTREAM se tu už NEVYDÁVÁ: holé `http://svc-knock:3017` byl nárok bez
// vlastníka. Adresu odvozuje derive-domains s identitou instance (env-doktor, derived).
emit('CHAIN_ID',                    preservedValue('CHAIN_ID', 'aisha-1'));
emit('MONIKER',                     preservedValue('MONIKER', 'aisha-validator'));
emit('COSMOS_SIGNER_MNEMONIC',      pg('COSMOS_SIGNER_MNEMONIC',      bip39Mnemonic));

emit('IMGPROXY_KEY',                pg('IMGPROXY_KEY',                () => hex(32)));
emit('IMGPROXY_SALT',               pg('IMGPROXY_SALT',               () => hex(32)));

const MINIO_ROOT_USER     = pg('MINIO_ROOT_USER',     () => 'aisha-minio-admin');
const MINIO_ROOT_PASSWORD = pg('MINIO_ROOT_PASSWORD', () => secret(32));
emit('MINIO_ROOT_USER',     MINIO_ROOT_USER);
emit('MINIO_ROOT_PASSWORD', MINIO_ROOT_PASSWORD);
// Rotation history — persisted across runs (cleared by rotation handler after success)
emit('MINIO_ROOT_USER_OLD',     preservedValue('MINIO_ROOT_USER_OLD'));
emit('MINIO_ROOT_PASSWORD_OLD', preservedValue('MINIO_ROOT_PASSWORD_OLD'));
// S3 aliases (compose doesn't support nested ${VAR:-${OTHER}} fallback in Coolify)
emit('S3_ACCESS_KEY', MINIO_ROOT_USER);
emit('S3_SECRET_KEY', MINIO_ROOT_PASSWORD);
// ⛔ JMENOVANÉ MinIO ÚČTY ODSTRANĚNY 2026-08-26 — neměly konzumenta.
// Zakládal je `shared-minio-init` v `docker-compose.coolify-shared.yml`, jenže
// ten stack byl přežitek: MinIO se přestěhoval do jádra (`docker-compose.
// coolify.yml`), žádná vlna `shared` nenasazovala, a v Coolify po něm zůstával
// jen prázdný záznam, který kazil každé měření „je stack zdravý".
//
// Změřeno před odstraněním: k MinIO se VŠICHNI konzumenti (langfuse,
// observability, domain-services, jádro) hlásí rootem — `MINIO_ROOT_USER`,
// `MINIO_ACCESS_KEY`, `S3_ACCESS_KEY`. `MINIO_USER_CORE` ani
// `MINIO_USER_LANGFUSE` nečetl v běhu NIKDO.

const INTERNAL_API_KEY = pg('INTERNAL_API_KEY', () => secret(32));
emit('INTERNAL_API_KEY',         INTERNAL_API_KEY);
emit('BROKER_TOKEN_SECRET',      INTERNAL_API_KEY);
// Shared intranet API key (X-Intranet-Api-Key) — gateway /token-exchange +
// intranet routes, the Appsmith datasource (provision-intranet.sh), and the
// source broker's least-privilege minting all present THIS value. Distinct from
// INTERNAL_API_KEY (admin bearer); kept as its own managed secret.
const INTRANET_API_KEY = pg('INTRANET_API_KEY', () => secret(32));
emit('INTRANET_API_KEY',         INTRANET_API_KEY);
// Token, kterým si dveře (svc-knock) berou z brány roster SCHVÁLENÝCH tabletů
// (`/internal/knock/roster`, 2026-09-28). Vlastní klíč jen pro tuhle dvojici,
// ne INTERNAL_API_KEY — přístupy mezi službami se nezaměňují. Nese jen veřejné
// klíče zařízení; únik neotevře dveře, jen prozradí, kdo je schválený.
emit('KNOCK_ROSTER_TOKEN',       pg('KNOCK_ROSTER_TOKEN',       () => secret(32)));
emit('POSTGREST_SERVICE_TOKEN',  SERVICE_ROLE_KEY);
emit('NOCODB_DB_PASSWORD',       POSTGRES_PASSWORD);

emit('NOCODB_JWT_SECRET',        pg('NOCODB_JWT_SECRET',        () => secret(48)));
emit('NOCODB_OIDC_SECRET',       pg('NOCODB_OIDC_SECRET',       () => secret(32)));
emit('NOCODB_ADMIN_EMAIL',       nocodbAdminEmail);
emit('NOCODB_ADMIN_PASSWORD',    pg('NOCODB_ADMIN_PASSWORD',    () => secret(24)));

emit('APPSMITH_OIDC_SECRET',              pg('APPSMITH_OIDC_SECRET',              () => secret(32)));
emit('APPSMITH_INTRANET_OIDC_SECRET',     pg('APPSMITH_INTRANET_OIDC_SECRET',     () => secret(32)));
emit('APPSMITH_ENCRYPTION_PASSWORD',      pg('APPSMITH_ENCRYPTION_PASSWORD',      () => secret(32)));
emit('APPSMITH_ENCRYPTION_SALT',          pg('APPSMITH_ENCRYPTION_SALT',          () => hex(16)));
// Appsmith admin login. provision-appsmith.sh + provision-intranet.sh REQUIRE
// this (fail-fast, no committed default); without generating it here the
// autonomous cold-start could not provision the Appsmith admin user.
emit('APPSMITH_ADMIN_PASSWORD',           pg('APPSMITH_ADMIN_PASSWORD',           () => secret(24)));

emit('CLICKHOUSE_USER',          preservedValue('CLICKHOUSE_USER', 'clickhouse'));
emit('CLICKHOUSE_PASSWORD',      pg('CLICKHOUSE_PASSWORD',      () => secret(32)));

emit('PKI_DB_ROOT_PASSWORD',     pg('PKI_DB_ROOT_PASSWORD',     () => secret(24)));
emit('PKI_DB_PASSWORD',          pg('PKI_DB_PASSWORD',          () => secret(24)));
emit('PKI_SVAULT_KEY',           pg('PKI_SVAULT_KEY',           () => hex(32)));
emit('PKI_DEFAULT_SECRET',       pg('PKI_DEFAULT_SECRET',       () => hex(32)));
emit('OPENXPKI_RPC_HMAC',        pg('OPENXPKI_RPC_HMAC',        () => hex(32)));
// OpenXPKI WebUI/operator login. We emit the PASSWORD (portable — no host-side
// crypt, unlike an $5$ digest which macOS openssl can't produce); pki-init hashes
// it in-container with `openssl passwd -5` where -5 is available. The operator
// retrieves the plaintext from the pki app env for WebUI login. A BYO
// OPENXPKI_OPERATOR_PASSWORD_HASH (if set) still wins in pki-init. This closes the
// 2026-07-13 gap where a --wipe left the digest unset → pki-init FATAL.
emit('OPENXPKI_OPERATOR_PASSWORD', pg('OPENXPKI_OPERATOR_PASSWORD', () => secret(24)));
emit('PKI_OIDC_SECRET',          pg('PKI_OIDC_SECRET',          () => secret(32)));
// oauth2-proxy: cookie_secret must be exactly 16/24/32 bytes → hex(16) = 32 ASCII chars
emit('PKI_COOKIE_SECRET',        pg('PKI_COOKIE_SECRET',        () => hex(16)));
emit('PKI_CLIENT_KEY_B64',       pg('PKI_CLIENT_KEY_B64',       () => ''));

emit('NETBIRD_OIDC_CLIENT_ID',   preservedValue('NETBIRD_OIDC_CLIENT_ID', 'netbird'));
emit('NETBIRD_OIDC_SECRET',      pg('NETBIRD_OIDC_SECRET',      () => secret(32)));
emit('NETBIRD_MGMT_SECRET',      pg('NETBIRD_MGMT_SECRET',      () => secret(32)));
emit('NETBIRD_RELAY_SECRET',     pg('NETBIRD_RELAY_SECRET',     () => secret(32)));
// NETBIRD_DATASTORE_ENC_KEY: Go StdEncoding — must use standard (not URL-safe) base64
emit('NETBIRD_DATASTORE_ENC_KEY',pg('NETBIRD_DATASTORE_ENC_KEY',() => b64std(32)));
emit('NETBIRD_DB_PASSWORD',      pg('NETBIRD_DB_PASSWORD',      () => secret(32)));
emit('NETBIRD_TURN_USERNAME',    preservedValue('NETBIRD_TURN_USERNAME', 'netbird-turn'));
emit('NETBIRD_TURN_PASSWORD',    pg('NETBIRD_TURN_PASSWORD',    () => secret(24)));
emit('NETBIRD_AUTH_SCHEME',      preservedValue('NETBIRD_AUTH_SCHEME', 'Bearer'));
emit('NETBIRD_SANDBOX_GROUP',    preservedValue('NETBIRD_SANDBOX_GROUP', 'sandbox-run'));
// DERIVED (not preserved): the resolver's stable IP on the instance-owned
// mesh-DNS network. Hard-deriving is the whole point — preserving a stale value
// is exactly the churn/‘127.0.0.11 breaks public DNS’ trap this replaces.
// MESH_DNS_SUBNET / RESOLVER_IP / NETBIRD_DNS_IP + NETSEG_*_SUBNET se emitují
// níž, AŽ po deployPrefixu (deriveSubnets ho potřebuje). Sem nepatří — subnet
// je odvozený z identity, ne konstanta.
// ── Deploy namespace ────────────────────────────────────────────────────────
// The prefix this install names its Coolify apps with ("aisha" upstream, "riq"
// for a fork). This line WRITES the declaration every later consumer trusts to
// answer "which instance am I acting on?" — so a guess here is not a convenient
// default, it is a forged identity that fails closed nowhere downstream. On a
// Coolify hosting several instances side by side that means one tenant's
// secrets landing in another's production apps (measured 2026-07-21: 64 of 168
// variables in aisha-core, including COLUMN_ENCRYPTION_KEY).
//
// Resolved through preservedValue (backup → process.env → existing .env.coolify)
// rather than process.env alone, because this value must SURVIVE a re-run that
// does not happen to export it — otherwise a plain `generate-secrets` invocation
// would rewrite the fork's prefix to the upstream default, renaming every app
// the stack targets.
const deployPrefix = (
  preservedValue('APP_NAME_PREFIX', '') || preservedValue('AISHA_STORY', '')
).trim();
// --print-keys lists managed key NAMES and writes no env file, so there is no
// declaration to forge — the guard belongs to runs that actually emit one.
const emitsInstanceDeclaration = !args.includes('--print-keys');
if (!deployPrefix && emitsInstanceDeclaration) {
  console.error(
    'FATAL: cannot determine APP_NAME_PREFIX — not in the preserved backup, not in the\n' +
      '       environment, not in the existing .env.coolify.\n' +
      '       Refusing to invent one: this value decides which Coolify namespace every\n' +
      '       later script writes to, and a wrong guess writes into another instance.\n' +
      '       Declare it explicitly (APP_NAME_PREFIX=<instance>, or AISHA_STORY) — the\n' +
      '       upstream stack is APP_NAME_PREFIX=aisha, a fork is its own name.',
  );
  process.exit(1);
}
emit('APP_NAME_PREFIX', deployPrefix);

// mesh-DNS network name is instance-scoped (derives from the deploy prefix), so
// several instances on one host get distinct networks.
emit('MESH_DNS_NETWORK', preservedValue('MESH_DNS_NETWORK', `${deployPrefix}-mesh-dns`));

// ── Instanční subnety + netseg sítě — deterministicky z identity ─────────────
// Doručeny AŽ tady, protože deriveSubnets potřebuje deployPrefix. Override
// (arg/env) vyhrává; jinak odvození; preservedValue drží kontinuitu re-runů.
// Netseg jména mají JEDEN domov: tyhle proměnné (compose overlay i
// create-netseg.sh je čtou) — dřív compose dosazoval `:-aisha-*`, create-netseg
// literál, tři domovy pro totéž (naměřeno 2026-08-05, viz create-netseg.sh).
// `--print-keys` vypisuje jen JMÉNA spravovaných klíčů, žádnou deklaraci
// nevydává (viz `emitsInstanceDeclaration` výš), takže identita tam legitimně
// chybí a hodnoty nikoho nezajímají. Odvozujeme proto jen když je z čeho —
// jinak by fail-loud uvnitř deriveSubnets shodil právě ten režim, který se na
// identitu neptá. Pro ostrý běh je neprázdná identita zaručená FATAL větví výš.
const _sub = deployPrefix
  ? deriveSubnets(deployPrefix)
  : { frontend: '', backend: '', data: '', meshDns: '', meshDnsResolver: '' };
// SUBNETY SE ZÁMĚRNĚ NEZACHOVÁVAJÍ (`preservedValue`), jen odvozují nebo
// přebíjejí explicitním override. Táž třída jako `preservedEmail` výš: hodnota,
// která neprojde politikou, se nemá recyklovat, ale přegenerovat.
//
// Odvození je DETERMINISTICKÉ z identity, takže zachovávání nepřidává nic —
// stejné identitě vyjde stejný rozsah. Přidávalo jen jedno: nesmrtelnost
// zděděných hodnot. NAMĚŘENO 2026-08-11 na varra: aisha nesla z backupu
// 10.99.0.0/24, cizí nájemník tentýž rozsah už držel, a
// `docker network create --subnet 10.99.0.0/24` padl na „Pool overlaps with
// other one on this address space". Odvozený rozsah (10.185.167.0/24) je přitom
// volný a s ostatními nájemníky se nepotkává. Odvození existovalo, jen se přes
// zachovanou hodnotu nikdy nedostalo ke slovu.
//
// Operátorská volba má vlastní kanál (`--mesh-dns-subnet` / MESH_DNS_SUBNET,
// čtený do `meshDnsSubnetOverride`) a ten vyhrává — deklarace ano, setrvačnost ne.
const _meshDnsSubnet = meshDnsSubnetOverride || _sub.meshDns;
// Resolver NÁSLEDUJE subnet: při override rozsahu musí padnout dovnitř něj,
// jinak by `dns:` mířilo mimo síť. Vlastní override zůstává nejsilnější.
// Override PLATÍ, jen když padne DOVNITŘ účinného rozsahu. Adresa mimo něj není
// deklarace, ale setrvačnost — a přesně ta past, kterou subnety o pár řádků výš
// řeší tím, že se nezachovávají. Resolver tu díru měl otevřenou jinými dveřmi:
// `process.env.MESH_DNS_RESOLVER_IP` se čte jako override, takže zděděná hodnota
// přežila změnu rozsahu a byla nesmrtelná.
//
// NAMĚŘENO 2026-08-12: subnet se správně přeodvodil na nový rozsah (ten původní
// kolidoval s cizím nájemníkem), ale MESH_DNS_RESOLVER_IP zůstal hostitelskou
// adresou z toho STARÉHO rozsahu. Síť vznikla, mesh-router si na ni pinoval
// adresu mimo ni a Docker odmítl endpoint — vlna 2 padla a vzala s sebou 19
// aplikací. Chyba se přitom projeví až u startu kontejneru, tedy nejdál od
// místa, kde vznikla.
//
// (Konkrétní adresy sem nepatří ani jako příklad: brána no-hardcoded-network
// skenuje TEXT, a holá RFC1918 adresa v komentáři je pro ni natvrdo zadaný
// endpoint. CIDR rozsah projde, hostitelská adresa ne.)
const _meshDnsResolverDerived = meshDnsSubnetOverride
  ? resolverFor(_meshDnsSubnet)
  : _sub.meshDnsResolver;
let _meshDnsResolverIp = _meshDnsResolverDerived;
if (meshDnsResolverIpOverride) {
  if (ipInCidr(meshDnsResolverIpOverride, _meshDnsSubnet)) {
    _meshDnsResolverIp = meshDnsResolverIpOverride;
  } else {
    console.warn(
      `[generate-secrets] MESH_DNS_RESOLVER_IP=${meshDnsResolverIpOverride} leží mimo ` +
        `MESH_DNS_SUBNET=${_meshDnsSubnet} — beru to jako zděděnou hodnotu po změně ` +
        `rozsahu, ne jako volbu, a odvozuji ${_meshDnsResolverDerived}. ` +
        `Chtěná změna rozsahu se dělá přes --mesh-dns-subnet / MESH_DNS_SUBNET.`,
    );
  }
}
emit('MESH_DNS_SUBNET',          _meshDnsSubnet);
emit('MESH_DNS_RESOLVER_IP',     _meshDnsResolverIp);
emit('NETBIRD_DNS_IP',           _meshDnsResolverIp);
// Rozsah peerů — edge-proxy si přes něj staví routu do mesh (via mesh-router).
// Hodnota žije v derive-subnets (jediný domov), tady se jen vydává.
emit('NETBIRD_PEER_CIDR',        NETBIRD_PEER_CIDR);
emit('NETSEG_FRONTEND_SUBNET',   _sub.frontend);
emit('NETSEG_BACKEND_SUBNET',    _sub.backend);
emit('NETSEG_DATA_SUBNET',       _sub.data);
emit('NETSEG_FRONTEND_NET',      preservedValue('NETSEG_FRONTEND_NET',    `${deployPrefix}-frontend-net`));
emit('NETSEG_BACKEND_NET',       preservedValue('NETSEG_BACKEND_NET',     `${deployPrefix}-backend-net`));
emit('NETSEG_DATA_NET',          preservedValue('NETSEG_DATA_NET',        `${deployPrefix}-data-net`));

// ── Doručení pro compose `${VAR:?…}` — tyhle klíče dosud nevydával NIKDO ─────
// (změřeno 2026-08-05: compose je četl s fallbackem `:-aisha-*`, tedy jméno
// IMPLEMENTACE dosazené místo doručené hodnoty). Realm konstanty mají domov
// v keycloak/aisha-realm.json — tady se jen DORUČUJÍ, aby compose nemusel nic
// dosazovat; preservedValue drží kontinuitu existujících instalací.
emit('OIDC_APP_CLIENT_ID',   preservedValue('OIDC_APP_CLIENT_ID',   'aisha-app'));        // klient realmu
emit('WS_JWT_AUDIENCE',      preservedValue('WS_JWT_AUDIENCE',      'aisha-app'));        // aud = týž klient
emit('KC_ADMIN_CLIENT_ID',   preservedValue('KC_ADMIN_CLIENT_ID',   'aisha-user-admin')); // klient realmu
// Hostitelské cesty exec stacku: NOVÁ instalace je dostane instančně (víc
// instancí na hostu = různé cesty), existující si preservedValue drží tu svou.
emit('AGENT_REPO_PATH',      preservedValue('AGENT_REPO_PATH',      `/srv/${deployPrefix}/base-repo`));
emit('AGENT_RUNS_DIR',       preservedValue('AGENT_RUNS_DIR',       `/var/lib/${deployPrefix}/agent-runs`));
// Hostitelské adresáře předrenderování (výstup rendereru + skořápka webu), které
// sdílí renderer a web TÉŽE instance. Dřív doslovné /var/lib/aisha/web-{static,shell}
// — naměřeno 2026-09-23: renderery dvou instancí na jednom stroji zapisovaly do
// TÉHOŽ web-static. Jméno ZÁMĚRNĚ jiné než ten legacy literál: starý renderer
// jiné instance do něj píše, dokud nenasadí nový compose, a web by ho servíroval.
// Obsah je odvozený (re-render při startu, skořápku web kopíruje při startu), takže
// stěhování nic nestojí. Compose je čte jako `${VAR}` (celá cesta, bez výchozí hodnoty).
emit('WEB_RENDER_STATIC_HOST_DIR', preservedValue('WEB_RENDER_STATIC_HOST_DIR', `/var/lib/${deployPrefix}/web-render/static`));
emit('WEB_RENDER_SHELL_HOST_DIR',  preservedValue('WEB_RENDER_SHELL_HOST_DIR',  `/var/lib/${deployPrefix}/web-render/shell`));
// Bootstrap vlastník n8n: e-mail v doméně INSTANCE, ne v placeholder doméně.
emit('N8N_BOOTSTRAP_OWNER_EMAIL', preservedValue('N8N_BOOTSTRAP_OWNER_EMAIL',
  `n8n-owner@${(process.env.PUBLIC_TLD || '').trim() || meshTld}`));
// ⛔ NEPRESERVOVAT (naměřeno 2026-08-25). `preservedValue` vrací EXISTUJÍCÍ
// hodnotu, takže jednou zapsaná adresa přebije každou čerstvě zjištěnou —
// a přesně tím přežila přesun managementu na jiný uzel. V nasazení tak stála
// adresa, která nepatřila ŽÁDNÉMU z registrovaných serverů; agenti si na ni
// mapovali mesh jméno, nikdo tam neposlouchal, peer se prostě neobjevil. Mesh zůstala prázdná → CORE_MESH_IP prázdné → api 502
// a extranet-auth se zabil hláškou o prázdném EXTRANET_UPSTREAM_MESH → 404.
//
// Adresa uzlu NENÍ deklarace, je to POZOROVÁNÍ — mění se přesunem služby,
// re-provisioningem hostitele i změnou vazby role→server. Zjišťuje se proto
// při každém běhu (generate-coolify-context: profil váže roli na jméno
// serveru, Coolify k němu vydá ip) a do repa se nikdy nezapisuje.
emit('NETBIRD_MGMT_HOST',        netbirdMgmtHost);
emit('NETBIRD_MESH_HOST',        preservedValue('NETBIRD_MESH_HOST', `netbird.${meshTld}`));
// NETBIRD_STACK_KEY_* — filled by netbird-bootstrap.sh after first deploy
emit('NETBIRD_STACK_KEY_FRONTEND',       pg('NETBIRD_STACK_KEY_FRONTEND',       () => ''));
emit('NETBIRD_STACK_KEY_BACKEND',        pg('NETBIRD_STACK_KEY_BACKEND',        () => ''));
emit('NETBIRD_STACK_KEY_INTEGRATION', pg('NETBIRD_STACK_KEY_INTEGRATION', () => ''));
emit('NETBIRD_STACK_KEY_EXPERIMENTAL',       pg('NETBIRD_STACK_KEY_EXPERIMENTAL',       () => ''));
// Identifikátory týchž klíčů — bez nich se klíč nedá ověřit, jen přerazit.
emit('NETBIRD_STACK_KEY_FRONTEND_ID',     pg('NETBIRD_STACK_KEY_FRONTEND_ID',     () => ''));
emit('NETBIRD_STACK_KEY_BACKEND_ID',      pg('NETBIRD_STACK_KEY_BACKEND_ID',      () => ''));
emit('NETBIRD_STACK_KEY_INTEGRATION_ID',  pg('NETBIRD_STACK_KEY_INTEGRATION_ID',  () => ''));
emit('NETBIRD_STACK_KEY_EXPERIMENTAL_ID', pg('NETBIRD_STACK_KEY_EXPERIMENTAL_ID', () => ''));

emit('STUDIO_OIDC_SECRET',       pg('STUDIO_OIDC_SECRET',       () => secret(32)));
emit('STUDIO_COOKIE_SECRET',     pg('STUDIO_COOKIE_SECRET',     () => hex(16)));

// Extranet stojí za oauth2-proxy jako ostatní chráněné povrchy — nepřihlášený
// nemá dostat ani bundle. Tajemství klienta nastavuje provision-sso.sh do KC,
// cookie secret používá jen proxy sama. `hex(16)` = 32 znaků, což je délka,
// kterou oauth2-proxy přijímá pro AES; kratší hodnota mu shodí start.
emit('EXTRANET_OIDC_SECRET',     pg('EXTRANET_OIDC_SECRET',     () => secret(32)));
emit('EXTRANET_COOKIE_SECRET',   pg('EXTRANET_COOKIE_SECRET',   () => hex(16)));

emit('N8N_COOKIE_SECRET',             pg('N8N_COOKIE_SECRET',             () => hex(16)));
emit('OAUTH2_PROXY_COOKIE_SECRET',    pg('OAUTH2_PROXY_COOKIE_SECRET',    () => hex(16)));

emit('RABBITMQ_DEFAULT_USER',    preservedValue('RABBITMQ_DEFAULT_USER', 'aisha'));
emit('RABBITMQ_USER',            preservedValue('RABBITMQ_USER', 'aisha'));
emit('RABBITMQ_PASS',            RABBITMQ_DEFAULT_PASS);
// RABBITMQ_HOST/PORT tu NEJSOU: odvozuje je katalog (integration.internal_tcp_endpoints)
// a doručuje env-doktor (druh derived). preservedValue by vracel starou ozvěnu
// `backend.<mesh>:5673` — jméno bez peeru a host port (2026-09-17).

emit('PGADMIN_EMAIL',            preservedEmail('PGADMIN_EMAIL', adminEmail));
emit('PGADMIN_PASSWORD',         pg('PGADMIN_PASSWORD',         () => secret(24)));

// Pass-through: only persist if already set (manuální bootstrap post-deploy)
emit('REGISTRY_PROXY_USERNAME',  preservedValue('REGISTRY_PROXY_USERNAME'));
emit('REGISTRY_PROXY_PASSWORD',  preservedValue('REGISTRY_PROXY_PASSWORD'));
emit('RESEND_API_KEY',           preservedValue('RESEND_API_KEY'));
emit('NETBIRD_API_TOKEN',        preservedValue('NETBIRD_API_TOKEN'));
emit('TELEGRAM_API_HASH',        preservedValue('TELEGRAM_API_HASH'));
emit('TELEGRAM_API_ID',          preservedValue('TELEGRAM_API_ID'));
emit('TELEGRAM_BOT_TOKEN',       preservedValue('TELEGRAM_BOT_TOKEN'));
emit('MATRIX_BRIDGE_PROFILES',   preservedValue('MATRIX_BRIDGE_PROFILES'));

// ── Phase 2 autopilot — LLM Gateway (theopenco/llmgateway) ─────────────────
// DB schema password, JWT signing key, OIDC client secret + service-side
// bearer token. AISHA_LLM_GATEWAY_KEY is what devs put in their IDE
// (ANTHROPIC_API_KEY=$AISHA_LLM_GATEWAY_KEY) so the gateway authenticates.
// Also referenced by ai_provider_registry (auth_env_var=AISHA_LLM_GATEWAY_KEY)
// for clow backends that resolve to backend_kind=llm_gateway.
emit('LLM_GATEWAY_DB_PASSWORD',   pg('LLM_GATEWAY_DB_PASSWORD',  () => secret(32)));
emit('LLM_GATEWAY_SECRET',        pg('LLM_GATEWAY_SECRET',       () => secret(48)));
emit('LLM_GATEWAY_OIDC_SECRET',   pg('LLM_GATEWAY_OIDC_SECRET',  () => secret(32)));
emit('AISHA_LLM_GATEWAY_KEY',     pg('AISHA_LLM_GATEWAY_KEY',    () => secret(40)));

// NB: OPENCLAW_API_KEY (the openclaw adapter's shared bearer) is minted in the
// dedicated OpenClaw block below — do NOT add it here (would double-emit).

// Provider keys are BYOK — pass through from .env-prod-backup. Empty
// placeholder is acceptable; gateway returns "provider not configured"
// at runtime when a clow with that backend_kind is picked.
emit('ANTHROPIC_API_KEY',         preservedValue('ANTHROPIC_API_KEY'));
emit('OPENAI_API_KEY',            preservedValue('OPENAI_API_KEY'));
emit('GOOGLE_AI_API_KEY',         preservedValue('GOOGLE_AI_API_KEY'));

// ── Phase 2 autopilot — OpenClaw (agent-mesh advisory + ops channel) ───────
// Internal secrets generated; channel tokens (Matrix/Discord/Slack/Telegram)
// are BYOK — empty = channel disabled at runtime, not an error.
emit('OPENCLAW_API_KEY',          pg('OPENCLAW_API_KEY',         () => secret(32)));
emit('OPENCLAW_DB_PASSWORD',      pg('OPENCLAW_DB_PASSWORD',     () => secret(32)));
emit('OPENCLAW_SECRET',           pg('OPENCLAW_SECRET',          () => secret(48)));
emit('OPENCLAW_OIDC_SECRET',      pg('OPENCLAW_OIDC_SECRET',     () => secret(32)));
// OAuth2-proxy cookie signing secret for the openclaw-auth OIDC gateway (like
// N8N_COOKIE_SECRET). hex(16) = 16 bytes, an AES-128 key length oauth2-proxy accepts.
emit('OPENCLAW_COOKIE_SECRET',    pg('OPENCLAW_COOKIE_SECRET',   () => hex(16)));
emit('OPENCLAW_MATRIX_TOKEN',     preservedValue('OPENCLAW_MATRIX_TOKEN'));
emit('OPENCLAW_DISCORD_TOKEN',    preservedValue('OPENCLAW_DISCORD_TOKEN'));
emit('OPENCLAW_SLACK_TOKEN',      preservedValue('OPENCLAW_SLACK_TOKEN'));
emit('OPENCLAW_TELEGRAM_TOKEN',   preservedValue('OPENCLAW_TELEGRAM_TOKEN'));

// svc-local-ingest + svc-potok (optional tier): auth tokens for their cockpits.
// Generated on first cold-start, preserved across runs (vault backup / env / existing).
emit('INGEST_TOKEN',              pg('INGEST_TOKEN',              () => secret(32)));
emit('POTOK_TOKEN',               pg('POTOK_TOKEN',               () => secret(32)));

// Doprava ingest balíků přes objektové úložiště: SCOPED klíč k jedinému bucketu
// (politika `ingest-drop-rw`, minio-init v jádru). ⛔ Naměřeno 2026-09-06: MinIO
// má jen root pověření, a sdílet je do stacků enginu a brokera by kvůli jednomu
// bucketu rozdalo právo na VŠECHNY. Bucket je přitom jediná cesta, kterou balík
// přejde mezi stroji (engine=experimental, broker=backend).
emit('INGEST_DROP_ACCESS_KEY',    pg('INGEST_DROP_ACCESS_KEY',    () => 'ingest-drop-' + secret(8)));
emit('INGEST_DROP_SECRET_KEY',    pg('INGEST_DROP_SECRET_KEY',    () => secret(32)));

// ── Instance overlay (private KB seed layer) ────────────────────────────────
// Applied at deploy by scripts/deploy/instance-data-hook.sh (migrate container).
// The URL comes ONLY from the operator's config (AISHA_INSTANCE_DATA_GIT_URL in
// .env-prod-backup / env; preserve wins) — never derived from a forge host + org
// naming convention: a derived address of a SHARED host names a repo that does
// not exist (401/404) and the ENTIRE overlay silently drops. Empty = community
// install, hook no-ops.
{
  // Self-heal JSON-escaped slashes: a value copy-pasted from a raw Coolify API
  // dump arrives as `https:\/\/oauth2:…` (PHP json_encode escapes `/` as `\/`).
  // git would treat that as a relative path → overlay silently never clones.
  const unescapeJsonSlashes = (value) => String(value ?? '').replace(/\\\//g, '/');
  // GIT_TOKEN = operator credential for cloning PRIVATE git repos (any host).
  const gitToken = preservedValue('GIT_TOKEN', '');
  // Tokenize the RESOLVED url. The operator declares the overlay token-LESS
  // (no-hardcoded-deployment-config gate; the same URL also feeds build ARGs),
  // but the migrate container has no BuildKit secret — without the token here
  // the private clone 401s in instance-data-hook.sh and the ENTIRE instance
  // overlay (KB, operators, seed) silently never applies. Inject
  // oauth2:<token>@ only when the url has scheme+host but no userinfo and we
  // hold a git token (`oauth2:` works as the username on GitHub, GitLab and
  // Gitea-compatible hosts alike).
  const resolvedInstanceUrl = unescapeJsonSlashes(preservedValue('AISHA_INSTANCE_DATA_GIT_URL', ''));
  const tokenizedInstanceUrl =
    gitToken && /:\/\/[^/@]+\//.test(resolvedInstanceUrl) && !/:\/\/[^/@]+@/.test(resolvedInstanceUrl)
      ? resolvedInstanceUrl.replace('://', `://oauth2:${gitToken}@`)
      : resolvedInstanceUrl;
  emit('AISHA_INSTANCE_DATA_GIT_URL', tokenizedInstanceUrl);

  // Branded web design (private design repo). CLEAN url — NO embedded token:
  // svc-web-artifact's build adds GIT_TOKEN at clone time (BuildKit secret
  // git_token) and ingests it into domains/templates/${AISHA_SEED_DOMAIN}/ →
  // /seed-default → web_pages. Operator-declared only; empty = community
  // install → committed placeholder + domains/default.
  // ⛔ VYPNUTO SE MUSÍ DÁT DEKLAROVAT (2026-09-19, naměřeno na jednom z forků).
  // Dřív se adresa odvozovala z konvence `<org>-guru-web` a prázdná deklarace se
  // zahodila, takže fork NEMĚL JAK říct „žádný overlay": odvodilo se repo, které
  // neexistuje (404), `overlay-cachebust.sh` nepřečetl HEAD, CACHEBUST zůstal
  // prázdný a fail-loud pojistka v svc-web-artifact/Dockerfile build ZABILA —
  // `core` nešel nasadit a s ním stála celá vlna 3 a 15 navazujících aplikací.
  // Odvození je pryč (léčba je deklarace, ne lepší odvození); sentinel zůstává
  // pro deklarace, které ho už nesou. Tvar `<věc>-disabled.invalid` je zavedený
  // idiom (ingest-, extranet-, gateway-, live-, companion-, potok-, mesh-router-,
  // apex-redirect-, keycloak-alias-). `.invalid` je RFC 2606 TLD, takže se nikdy
  // nerozřeší.
  const DESIGN_VYPNUTO = 'design-disabled.invalid';
  const deklarovanyDesign = preservedValue('AISHA_WEB_DESIGN_GIT_URL', '');
  const designVypnut = deklarovanyDesign.trim() === DESIGN_VYPNUTO;
  emit('AISHA_WEB_DESIGN_GIT_URL',
    designVypnut ? '' : unescapeJsonSlashes(deklarovanyDesign));
}

// ── Federované přihlášení (Google / Apple) — operátorská pověření ───────────
//
// ⛔ NAMĚŘENO 2026-08-20 na riqi. `ENABLE_GOOGLE_OAUTH=true` i
// `ENABLE_APPLE_OAUTH=true` byly v heredocu cold-startu, ale ANI JEDNO
// pověření tam nebylo. Hodnoty žily jen v `.env.coolify`, kam je někdo
// (já) DOPSAL. Soubor přitom vypadal správně — a teprve wipe, který ho
// staví od nuly, by ukázal, že je pipeline nikdy nevyrobila.
//
// Výsledný stav po wipu by byl přesně ta vada, kvůli které tohle celé
// vzniklo: vlajka svítí „přihlášení Googlem funguje", za ní prázdno, a na
// přihlašovací stránce zase jen heslo. Vypadalo by to jako regrese.
//
// Sem patří proto, že `emit()` znamená tři věci naráz:
//   1. hodnota se dostane do `.env.coolify` (přednost: .env-prod-backup >
//      prostředí > stávající .env.coolify), tedy PŘEŽIJE WIPE;
//   2. klíč se objeví v `--print-keys`, takže ho reverzní sync bere do
//      trezoru jako trvanlivé tajemství (jinak by v záloze chyběl);
//   3. je to jedno místo, kde se o té množině rozhoduje.
//
// Prázdná hodnota je LEGITIMNÍ stav: kdo pověření nemá, ten prostě Google
// ani Apple na přihlašovací stránce nemá a heslo funguje dál. Proto žádné
// `:?` — federované přihlášení je nepovinné.
//
// APPLE_* není client secret, ale MATERIÁL KLÍČE. Apple stropuje secret na
// ES256 JWT s platností 6 měsíců, takže se secret nedeklaruje, ale razí
// (keycloak/mint-apple-secret.py) při každém startu i rolloutu.
emit('OAUTH_GOOGLE_CLIENT_ID',     preservedValue('OAUTH_GOOGLE_CLIENT_ID'));
emit('OAUTH_GOOGLE_CLIENT_SECRET', preservedValue('OAUTH_GOOGLE_CLIENT_SECRET'));
emit('OAUTH_APPLE_CLIENT_ID',      preservedValue('OAUTH_APPLE_CLIENT_ID'));
emit('OAUTH_APPLE_CLIENT_SECRET',  preservedValue('OAUTH_APPLE_CLIENT_SECRET'));
emit('APPLE_TEAM_ID',              preservedValue('APPLE_TEAM_ID'));
emit('APPLE_KEY_ID',               preservedValue('APPLE_KEY_ID'));
emit('APPLE_AUTH_KEY_B64',         preservedValue('APPLE_AUTH_KEY_B64'));

// ── Money přes VPN (svc-money) — operátorská pověření ───────────────────────
//
// ⛔ TÁŽ TŘÍDA JAKO FEDEROVANÉ PŘIHLÁŠENÍ VÝŠ. Klíče byly v Coolify založené
// (sync-envs je odvodil z compose), ale PRÁZDNÉ, a v cold-startu nebyly vůbec —
// takže i kdyby je někdo vyplnil, wipe by je smazal a `svc-money` by naskočil
// s prázdným tunelem. To není „stahování je vypnuté", to je selhání doručení
// převlečené za totéž.
//
// VPN_PROFILE_B64 je celý .ovpn profil VČETNĚ klientského certifikátu — patří
// mezi trvanlivá tajemství (`--print-keys` ⇒ jde do trezoru), ne do repa.
// MONEY_AGENDAS je JSON pole {key,label,port,clientId,clientSecret}; agendu
// rozlišuje PORT, takže kolize portů = tichá záměna dat mezi firmami.
// Nextcloud — dokumentové zdroje. Adresa a uživatel NEJSOU tajemství (jsou to
// neveřejná konfigurace), heslo ano; obojí ale musí být preservedValue, jinak
// je wipe smaže a lane se po přestavbě tiše nezapne. Heslo se drží v rclone
// obfuskovaném tvaru — čitelné rclone nebere.
emit('NEXTCLOUD_URL',                    preservedValue('NEXTCLOUD_URL'));
emit('NEXTCLOUD_USER',                   preservedValue('NEXTCLOUD_USER'));
emit('NEXTCLOUD_APP_PASSWORD_OBSCURED',  preservedValue('NEXTCLOUD_APP_PASSWORD_OBSCURED'));
// Dokumenty instance: pojmenovaný svazek `${APP_NAME_PREFIX}_local-ingest-docs` přímo
// v compose local-ingest. INGEST_DOCS_MOUNT (hostitelská cesta) zanikla — Coolify 4.3.16
// z `${VAR}` ve zdroji svazku udělá pojmenovaný svazek bez ohledu na hodnotu a
// `${VAR:-x}` rozvine vždy na x (naměřeno 2026-09-28, sourceIsLocal).
emit('DOCS_SYNC_INTERVAL',               preservedValue('DOCS_SYNC_INTERVAL', '300'));
emit('DOCS_SYNC_OFFSET',                 preservedValue('DOCS_SYNC_OFFSET', '100'));
emit('DOCS_SYNC_INCLUDE_SMLOUVY',        preservedValue('DOCS_SYNC_INCLUDE_SMLOUVY'));
emit('DOCS_SYNC_INCLUDE_DOKUMENTY',      preservedValue('DOCS_SYNC_INCLUDE_DOKUMENTY'));
emit('MONEY_HOST',          preservedValue('MONEY_HOST'));
emit('MONEY_AGENDAS',       preservedValue('MONEY_AGENDAS'));
emit('VPN_ENABLED',         preservedValue('VPN_ENABLED', 'true'));
emit('VPN_PROFILE_B64',     preservedValue('VPN_PROFILE_B64'));
emit('VPN_AUTH_USER',       preservedValue('VPN_AUTH_USER'));
emit('VPN_AUTH_PASS',       preservedValue('VPN_AUTH_PASS'));
emit('VPN_KEY_PASSPHRASE',  preservedValue('VPN_KEY_PASSPHRASE'));
// Po jaké nečinnosti zavřít cestu do cizí sítě. Spojení je ZDROJ, ne vlastnost
// procesu: drží se, jen když ho někdo potřebuje. Minuty, ne sekundy —
// `--connect-retry-max` v tunelu existuje proto, že opakované pokusy vypadají
// protistraně jako útok, a časté cykly připoj–odpoj mají tentýž tvar.
emit('VPN_IDLE_MS',         preservedValue('VPN_IDLE_MS', '300000'));
emit('SVC_MONEY_API_TOKEN', preservedValue('SVC_MONEY_API_TOKEN'));

// ── Sentry (symbolizace pádů) — operátorská pověření ────────────────────────
//
// Token vyrábí ČLOVĚK v Sentry, ne my — proto `preservedValue` bez fallbacku.
// Sem patří ze stejného důvodu jako Apple a Money výš: `emit()` znamená, že
// hodnota přežije wipe a klíč se objeví v `--print-keys`, takže ho reverzní
// sync bere do trezoru. Prázdno je legitimní stav (instance bez Sentry);
// nezdar se pozná na buildu, kde `build-ios.sh` odmítne vydat release bez dSYM.
emit('SENTRY_URL',        preservedValue('SENTRY_URL'));
emit('SENTRY_ORG',        preservedValue('SENTRY_ORG'));
emit('SENTRY_PROJECT',    preservedValue('SENTRY_PROJECT'));
emit('SENTRY_AUTH_TOKEN', preservedValue('SENTRY_AUTH_TOKEN'));

// ── Bootstrap uživatel mesh účtu — pověření, která MUSÍ přežít wipe ─────────
//
// ⛔ NAMĚŘENO 2026-08-20. Obě hodnoty vyrábí `aisha-bootstrap-user-init.sh`
// (32 znaků z openssl) a zapisuje je do `.env.coolify`. Jenže ten soubor se
// při cold-startu staví heredocem OD NULY, takže bez `emit()` tady zmizí při
// prvním přegenerování — a `--print-keys` je nezná, takže si je reverzní sync
// ani neodloží do trezoru.
//
// Bez nich `netbird-bootstrap.sh` přeskočí nárok na vlastnictví účtu a
// vlastníkem zůstane servisní účet mesh backendu. Ten je pro IdP neviditelný
// (Keycloak servisní účty do výpisu uživatelů nedává), takže se navenek
// projeví jako `user is pending approval` — stav, který vypadá jako čekání
// na člověka, ale schvalovat ho nemá kdo a čekání ho nezmění.
//
// HESLO: fallback ZÁMĚRNĚ není — vyrábí ho init skript, ne my. Kdybychom ho tu
// dosadili, přerazíme heslo, které už v realmu platí, a ROPC přestane chodit.
emit('AISHA_BOOTSTRAP_PASSWORD',      preservedValue('AISHA_BOOTSTRAP_PASSWORD'));
// ⛔ SECRET KLIENTA: obrácený směr toku (2026-09-05). Fallback tu naopak BÝT MUSÍ.
//
// Dřív hodnotu vydával Keycloak a `aisha-bootstrap-user-init.sh` si ji chodil
// vyzvednout — jenže na instanci za NAT na Keycloak zvenčí nedosáhneš: veřejná
// trasa vede přes edge, edge čeká na CORE_MESH_IP, ten na netbird discovery
// a discovery právě na tenhle secret. Kruh se zavíral a cold-start ho lámal
// SSH tunelem do hostitele — tedy tím, že STACK lezl na cizí stroj.
//
// Nově hodnotu předgenerujeme a realm si ji při importu PŘEVEZME (v
// keycloak/aisha-realm.json má klient `"secret": "${AISHA_BOOTSTRAP_CLIENT_SECRET}"`).
// Není to nový vzor: jedenáct klientů realmu ho už používá (netbird-backend,
// aisha-pki-issuer, všechny *-proxy); bootstrap dvojice byla poslední bez něj.
//
// `preservedValue` drží obě strany: existující hodnotu ZACHOVÁ (běžící realm se
// nepřerazí), a jen když žádná není, dosadí čerstvou. Původní obava „přerazíme,
// co v realmu platí" tím platí dál — jen ji řeší preservace, ne absence.
emit('AISHA_BOOTSTRAP_CLIENT_SECRET', preservedValue('AISHA_BOOTSTRAP_CLIENT_SECRET', secret(32)));

// Hláška v trezoru nahrazená čerstvým tajemstvím: realm (nebo jiný cílový systém)
// drží pořád STAROU hodnotu z importu. Tichý přechod by skončil nefunkčním
// přihlášením klienta — řekne se to proto jménem, s postupem.
if (hlaskyVTrezoru.size > 0 && !args.includes('--print-keys')) {
  console.warn(
    `[generate-secrets] ⛔ ${hlaskyVTrezoru.size} klíč(ů) neslo v trezoru hlášku místo hodnoty: ${[...hlaskyVTrezoru].sort().join(', ')}.\n` +
      '  Nové hodnoty jsou ve výstupu. U tajemství klientů Keycloaku (KC_ADMIN_CLIENT_SECRET, EXTRANET_OIDC_SECRET, …)\n' +
      '  je nutné zapsat TUTÉŽ hodnotu i do realmu (admin API: PUT /admin/realms/<realm>/clients/<id> se secret),\n' +
      '  jinak klient nepřihlásí. Import realmu dosazuje jen do prázdné DB.',
  );
}

// ── Output ──────────────────────────────────────────────────────────────────

// --print-keys: emit ONLY the managed-secret key NAMES (no values), one per line.
// This makes generate-secrets the single source of truth for "which keys are
// managed secrets" — consumed by coolify-pull-envs.mjs to scope the reverse-sync
// to durability-critical secrets and EXCLUDE derived config (GIT_SHA / IMAGE_* /
// *_DOMAIN come from derive-domains/build, are never emitted here, and must stay
// fresh — pulling a stale copy into the vault would deploy old images/domains).
if (args.includes('--print-keys')) {
  process.stdout.write([...new Set(emittedKeys)].sort().join('\n') + '\n');
  process.exit(0);
}

// Odmítá se AŽ TADY, po zpracování všech klíčů: obsluha dostane CELÝ seznam.
// A odmítá se DŘÍV, než cokoli dorazí na stdout — cold-start ho `eval`uje, takže
// částečný výstup by část klíčů přepsal i tak.
if (stavoveBezVstupu.size > 0) {
  const zdroje = [envCoolifyPath || '(--env-coolify nepředán)', envBackupPath || '(--env-backup nepředán)'];
  process.stderr.write(
    `⛔ [generate-secrets] ODMÍTÁM: stack EXISTUJE (--stack-exists), a přesto pro ${stavoveBezVstupu.size} ` +
      `stavových tajemství nemám vstup. Vyrobit je znovu znamená, že data zašifrovaná těmi starými ` +
      `přestanou jít přečíst — a nic přitom nespadne.\n` +
      `  Dotčené klíče: ${[...stavoveBezVstupu].sort().join(', ')}\n` +
      `  Hledala jsem v: ${zdroje.join(' · ')} a v prostředí.\n` +
      `  Obnov je z trezoru (.env-prod-backup / zálohy trezoru instance) a spusť znovu.\n` +
      `  PRÁZDNÝ soubor není náhrada: nula klíčů nad existujícím stackem je táž situace jako chybějící soubor.\n` +
      `  Opravdu nové klíče patří jen k --wipe (--strength-floor), kdy jsou svazky smazané.\n`,
  );
  process.exit(3);
}

process.stdout.write(lines.join('\n') + '\n');
