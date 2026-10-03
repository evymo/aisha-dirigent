import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Instance overlay mechanism (parita s domains/templates + AISHA_SEED_DOMAIN):
 * AISHA_INSTANCE_DIR points at an overlay dir providing app.config.json, i18n.json
 * and public/ assets. The shell itself stays 100% implementation-agnostic.
 * Candidate for extraction to a shared plugin.
 */
const PLATFORM_DIR = path.resolve(here, '../../instances/_default');
const instanceDir = path.resolve(here, process.env.AISHA_INSTANCE_DIR ?? PLATFORM_DIR);

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

type Slovnik = Record<string, Record<string, string>>;

/**
 * FLOOR SE VRSTVÍ: platformní báze + overlay, overlay vyhrává.
 *
 * ⛔ NAMĚŘENO 2026-09-06: tohle byla VOLBA, ne sloučení — `AISHA_INSTANCE_DIR`
 * ukázal na `_overlay` a `instances/_default/i18n.json` se nepoužil VŮBEC.
 * Doplnil jsem 32 platformních klíčů `app.mc.*` do `_default` jako pojistku pro
 * selhané načtení z DB; do RIQ, který overlay má, se nedostal ani jeden. Pojistka
 * tedy u instancí s overlayem nekryla platformní klíče vůbec a `t()` by při
 * nedostupné DB vykreslil SYROVÝ KLÍČ.
 *
 * ⭐ Vrstvení je tu správná odpověď místo kopírování klíčů do každého overlaye:
 * generický klíč má JEDEN domov, overlay říká jen to, co je jinak. Obojí je
 * v obrazu (`COPY . .` doveze `_default`, overlay se přidá vedle), takže to nic
 * nestojí.
 */
function vrstvenyFloor(zaklad: Slovnik, overlay: Slovnik): Slovnik {
  const out: Slovnik = {};
  for (const zdroj of [zaklad, overlay]) {
    for (const [jazyk, slova] of Object.entries(zdroj)) {
      // `_note` a spol. nejsou jazyk — nesou prózu pro člověka.
      if (jazyk.startsWith('_') || typeof slova !== 'object' || slova === null) continue;
      out[jazyk] = { ...(out[jazyk] ?? {}), ...slova };
    }
  }
  return out;
}

const instanceConfig = readJson(path.join(instanceDir, 'app.config.json'));
const platformI18n = readJson(path.join(PLATFORM_DIR, 'i18n.json')) as Slovnik;
const overlayI18n = readJson(path.join(instanceDir, 'i18n.json')) as Slovnik;
const instanceI18n = vrstvenyFloor(platformI18n, overlayI18n);

const MIME: Record<string, string> = {
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
};

function instanceAssets(): Plugin {
  const pub = path.join(instanceDir, 'public');
  return {
    name: 'aisha-instance-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const f = path.join(pub, urlPath);
        if (urlPath !== '/' && fs.existsSync(f) && fs.statSync(f).isFile()) {
          res.setHeader('content-type', MIME[path.extname(f)] ?? 'application/octet-stream');
          fs.createReadStream(f).pipe(res);
          return;
        }
        next();
      });
    },
    generateBundle() {
      if (!fs.existsSync(pub)) return;
      const walk = (dir: string, base = ''): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          const rel = base ? `${base}/${e.name}` : e.name;
          if (e.isDirectory()) walk(p, rel);
          else this.emitFile({ type: 'asset', fileName: rel, source: fs.readFileSync(p) });
        }
      };
      walk(pub);
    }
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@aisha/capture-ui": path.resolve(__dirname, "../../packages/capture-ui/src/index.ts")
    }
  },
  plugins: [react(), instanceAssets()],
  define: {
    __AISHA_INSTANCE__: JSON.stringify({ config: instanceConfig, i18n: instanceI18n })
  },
  build: { outDir: 'dist', sourcemap: false },
  // Testy importují App.js (celé SDK v jsdom) UVNITŘ testu — studený import pod zátěží
  // runneru trvá ~4–5 s, výchozích 5 s nemělo rezervu (PR #1125 běh 4130, riq 1696:
  // pokaždé jiný soubor na 5008–5050 ms). Stejný strop jako storage-auth / svc-ai-chat.
  test: { environment: 'node', testTimeout: 20_000 }
} as never);
