import type { FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
import { uploadPreflightRoute } from './routes/upload-preflight.js';
import { downloadRoute } from './routes/download.js';
import { publicProxyRoute } from './routes/public-proxy.js';
import { objectDeleteRoute } from './routes/object-delete.js';
import { uploadCompleteRoute } from './routes/upload-complete.js';
import { scanObjectRoute } from './routes/scan-object.js';
import { nahraniRoute } from './routes/nahrani.js';
import { zarizeniRoute, stavZarizeni } from './routes/zarizeni.js';
import { klicApk, klicAppky } from './lib/zarizeni.js';


import { createReadStream } from 'node:fs';
import { doplnBalik } from './lib/doplneni-baliku.js';
import { vytvorStahovani } from './lib/registr-zdroj.js';
import { minioUloziste } from './lib/minio-uloziste.js';
import { putObjectStream, zajistiBucket } from './minio.js';
// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before any
// other module performs network I/O. Exporter routes to Langfuse OTLP.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'storage-auth' });
const app = Fastify({
  logger: safeLoggerOptions({
    level: config.logLevel,
    ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
  }),
  trustProxy: true,
});

await applySecurity(app, {
  service: 'storage-auth',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 100, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'storage-auth' });

// Health check
// Schopnosti instance jako čísla, ne domněnky (2026-09-24): kontrola po nasazení
// se ptá SEM, místo aby hádala z proměnných prostředí. Hodnoty jsou booleany —
// žádné tajemství neuniká.
app.get('/health', async () => ({
  status: 'ok',
  service: 'storage-auth',
  capabilities: {
    uploadViaApi: Boolean(config.storagePublicUrl && config.uploadTokenSecret),
    imageTransforms: Boolean(config.imgproxyKey && config.imgproxySalt),
    avScan: config.avScanEnabled,
  },
}));

// ── Storage routes ──
await app.register(uploadPreflightRoute);
await app.register(downloadRoute);
await app.register(publicProxyRoute);
await app.register(objectDeleteRoute);
// Spouštěč AV skenu: klient ohlásí dokončený PUT, objekt se oskenuje a promuje.
await app.register(uploadCompleteRoute);
// Internal-only AV scan→promote route (service-role guarded). The production
// caller of scanAndPromote; driven by the event-worker's storage_events consumer.
await app.register(scanObjectRoute);
// Nahrání přes API (preflight vydá token, tělo teče sem a odtud do MinIA).
await app.register(nahraniRoute);
// Volitelná schopnost „zařízení“ (hlídač tabletů). Vypnutá = odpovídá, že je vypnutá.
await app.register(zarizeniRoute);

if (!config.storagePublicUrl || !config.uploadTokenSecret) {
  app.log.warn('STORAGE_PUBLIC_URL nebo STORAGE_UPLOAD_TOKEN_SECRET chybí — preflight vydá presigned URL MinIA, '
    + 'na kterou klient mimo mesh nedosáhne (fotky z terénu neodejdou).');
}
// ⭐ ZADÁNÍ MAJITELE 2026-09-22: binárka je ARTEFAKT — patří do úložiště, ne do
// repa ani do obrazu. ⭐ 2026-09-24: „je třeba, aby se spustil build, který
// balíček nahraje do storage automaticky, aby uživatel nemusel". Deklarace proto
// nese i `zdroj` (registr balíčků) a úložiště se srovná SAMO: chybí-li balíček,
// nebo leží-li tam jiný, stáhne se ze zdroje, ověří otiskem a teprve pak uloží
// (lib/doplneni-baliku.ts). Bez zdroje zůstává jen ruční nahrání a služba řekne
// PRAVDU o rozdílu.
//
// ⛔ PROČ PŘI STARTU A ZNOVU V INTERVALU. „Správce balíček nenahrál" a „tablet si
// ho nestáhl" jsou dvě poruchy, které se hledají jinde. Bez téhle kontroly se ta
// první projeví teprve tím, že tablet mlčí (NAMĚŘENO 2026-09-21: `/zarizeni/
// hlidac.apk` vracelo 404 a přišlo se na to až při onboardingu). Interval dohání
// zdroj, který byl při startu nedostupný — a deklaraci, která se změní bez
// restartu (zdroj deklarace z databáze, lib/zdroj-deklarace.ts).
//
// ⛔ NEBLOKUJE START: chybějící balíček je vada distribuce, ne důvod nepustit
// řidiče k práci.
const APK_TYP = 'application/vnd.android.package-archive';
const uloziste = minioUloziste(config.zarizeniBucket);
const stahni = vytvorStahovani({
  puvod: config.zarizeniZdrojPuvod,
  token: config.zarizeniZdrojToken,
  // Appka má desítky MB a registr může být pomalý; strop drží jen visící spojení.
  limitMs: 15 * 60_000,
});
async function ulozOvereny(klic: string, soubor: string, bajtu: number, sha256: string): Promise<void> {
  await zajistiBucket(config.zarizeniBucket);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- soubor je per-call tmpdir z doplneni-baliku (mkdtemp + literál)
  await putObjectStream(config.zarizeniBucket, klic, createReadStream(soubor), bajtu, { 'Content-Type': APK_TYP, sha256 });
}

let srovnavaSe = false;
async function srovnejUloziste(): Promise<void> {
  // Dva běhy nad týmž klíčem by stahovaly dvakrát a zapisovaly přes sebe.
  if (srovnavaSe) return;
  srovnavaSe = true;
  try {
    let zarizeni;
    try {
      zarizeni = await stavZarizeni();
    } catch (e) {
      // Nedostupný zdroj deklarace: nic se nesrovnává (STARÁ pravda by byla horší),
      // zkusí se v dalším intervalu. Nahlas, ať se to nepozná až u tabletu.
      app.log.error({ err: (e as Error)?.message ?? String(e) }, 'deklarace zařízení nedostupná — srovnání úložiště odloženo');
      return;
    }
    if (!zarizeni.zapnuto) {
      if (zarizeni.chyba) app.log.error({ chyba: zarizeni.chyba }, 'deklarace zařízení je vadná — schopnost zařízení je vypnutá');
      return;
    }
    const h = zarizeni.hlidac;
    const balicky = [
      { co: 'Kiosk Admin', klic: klicApk(h), ocekavanySha256: h.apkSha256 ?? '', zdroj: h.apkZdroj },
      ...(h.appky ?? []).map((a) => ({ co: a.balicek, klic: klicAppky(a.balicek), ocekavanySha256: a.sha256, zdroj: a.zdroj })),
    ];
    for (const b of balicky) {
      try {
        const v = await doplnBalik(b, { uloziste, stahni, uloz: ulozOvereny, maxBajtu: config.maxApkMb * 1024 * 1024 });
        const kde = { co: b.co, klic: b.klic };
        switch (v.stav) {
          case 'drzi':
            app.log.info(kde, 'úložiště drží deklarovaný balíček');
            break;
          case 'doplneno':
            app.log.info({ ...kde, bajtu: v.bajtu }, 'balíček doplněn ze zdroje a ověřen otiskem');
            break;
          case 'bez_zdroje':
            app.log.error({ ...kde, porucha: v.porucha }, v.porucha === 'chybi'
              ? 'deklarovaný balíček V ÚLOŽIŠTI NENÍ a deklarace nemá zdroj — nahrajte ho v administraci'
              : 'v úložišti leží JINÝ balíček, než instance deklaruje, a deklarace nemá zdroj');
            break;
          case 'zdroj_nesedi':
            app.log.error({ ...kde, deklarovano: v.deklarovano, stazeno: v.stazeno }, 'zdroj poslal JINÝ balíček, než deklarace slibuje — úložiště beze změny');
            break;
          case 'zdroj_selhal':
            app.log.error({ ...kde, duvod: v.duvod }, 'doplnění ze zdroje selhalo — úložiště beze změny, zkusí se znovu');
            break;
          default:
            break;
        }
      } catch (e) {
        app.log.error({ co: b.co, err: e }, 'srovnání balíčku s deklarací selhalo');
      }
    }
  } finally {
    srovnavaSe = false;
  }
}
void srovnejUloziste();
setInterval(() => void srovnejUloziste(), 60 * 60_000).unref();

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Storage Auth listening on :${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
