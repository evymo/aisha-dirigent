/**
 * Měřidla duplicit seedu a práce s probe DB pro runtime testy seedu.
 *
 * Probe DB vzniká vedle testovací DB na témže clusteru (CREATE DATABASE) a po testu
 * zmizí — test tak neměří ani nemění sdílenou DB celé sady `test:db`. Tentýž postup
 * používá brána upgradu znalostí (znalosti-upgrade-z-predchoziho-mainu); při sloučení
 * se oba harnessy spojí sem.
 *
 * Všechno je ASYNCHRONNÍ: migrate.mjs a seed trvají desítky sekund. Synchronní
 * execFileSync by smyčku workeru vitestu blokoval; worker potvrzuje průběh přes RPC
 * s limitem 60 s a soubor by skončil „Timeout calling onTaskUpdate", i když všechna
 * tvrzení prošla.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER } from "./test-env-probe";

const spust = promisify(execFile);

export const ROOT = resolve(__dirname, "../../..");
export const ENV = { ...process.env, PGPASSWORD: PG_PASSWORD };
export const SEED_HEAD = join(ROOT, "aisha/db/seed.compiled.sql");
const BUF = 256 * 1024 * 1024;

const zaklad = (db: string) => ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", db, "-v", "ON_ERROR_STOP=1"];

export const probeUrl = (db: string) =>
  `postgresql://${PG_USER}:${encodeURIComponent(PG_PASSWORD)}@${PG_HOST}:${PG_PORT}/${db}`;

/** Jeden dotaz, výsledek jako text (-tA, oddělovač |). */
export async function sql(db: string, dotaz: string): Promise<string> {
  const { stdout } = await spust("psql", [...zaklad(db), "-tA", "-F", "|", "-c", dotaz], { env: ENV, maxBuffer: BUF });
  return stdout.trim();
}

/** Soubor SQL; vrací stderr (NOTICE/WARNING). Selhání = výjimka s koncem stderr. */
export async function soubor(db: string, cesta: string): Promise<string> {
  try {
    const { stderr } = await spust("psql", [...zaklad(db), "-q", "-f", cesta], { env: ENV, maxBuffer: BUF });
    return stderr;
  } catch (e) {
    const err = e as { stderr?: string; code?: number };
    throw new Error(`psql -f ${cesta} → ${err.code}: ${(err.stderr ?? "").split("\n").slice(-12).join("\n")}`);
  }
}

/** Text SQL přes dočasný soubor (víceřádkové bloky DO $$ … $$). */
export async function skript(db: string, text: string): Promise<string> {
  const cesta = join(mkdtempSync(join(tmpdir(), "seed-dupl-")), "skript.sql");
  writeFileSync(cesta, text);
  return soubor(db, cesta);
}

/** Probe DB: CREATE DATABASE + role a schémata substrátu (infra/postgres). */
export async function zalozProbe(db: string, koren = ROOT): Promise<void> {
  await sql(PG_DATABASE, `CREATE DATABASE ${db}`);
  await soubor(db, join(koren, "infra/postgres/000_init_roles_schemas.sql"));
}

export async function zrusProbe(db: string): Promise<void> {
  await sql(PG_DATABASE, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
}

/**
 * Skutečný runner nasazení (baseline / heals.sql) daného stromu nad probe DB.
 * `koren` bývá cizí strom (předchozí main v dočasném worktree) — prostředí proto VŽDY bez git
 * lokace volajícího: co runner cizího stromu v podprocesu spustí, odtud vidět není, a zděděný
 * GIT_DIR/GIT_WORK_TREE z hooku by jakýkoli git v něm nasměroval na tenhle strom (brána
 * git-v-testech-bez-prostredi). Dřív to hlídal jen jeden volající; teď to platí pro každého.
 */
export async function migrate(db: string, koren = ROOT, env: NodeJS.ProcessEnv = ENV): Promise<void> {
  try {
    await spust("node", [join(koren, "scripts/db/migrate.mjs")], {
      cwd: koren,
      env: envWithoutGitLocation({ ...env, AISHA_DB_URL: probeUrl(db) }),
      maxBuffer: BUF,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    throw new Error(`migrate.mjs (${koren}) → ${err.code}: ${(err.stderr || err.stdout || "").split("\n").slice(-12).join("\n")}`);
  }
}

/** Blok heals.sql mezi značkami `-- >>> <jméno>` a `-- <<< <jméno>`. */
export function blokHeals(jmeno: string): string {
  const heals = readFileSync(join(ROOT, "aisha/db/heals.sql"), "utf8");
  const m = heals.match(new RegExp(`-- >>> ${jmeno}\\n([\\s\\S]*?)-- <<< ${jmeno}`));
  if (!m) throw new Error(`blok ${jmeno} v aisha/db/heals.sql nenalezen`);
  return m[1];
}

// ── Měřidla ──────────────────────────────────────────────────────────────────────

/** Počty knowledge_items podle zdroje: klíč `source_type|item_type|category`. */
export async function zdrojeZnalosti(db: string): Promise<Record<string, number>> {
  const radky = await sql(
    db,
    `SELECT source_type || '|' || item_type || '|' || coalesce(category, '-'), count(*)
       FROM public.knowledge_items GROUP BY 1 ORDER BY 1`,
  );
  return Object.fromEntries(
    radky
      .split("\n")
      .filter(Boolean)
      .map((r) => {
        const i = r.lastIndexOf("|");
        return [r.slice(0, i), Number(r.slice(i + 1))];
      }),
  );
}

/**
 * Duplicitní znalosti: víc řádků se STEJNÝM obsahem a stejným zařazením (zdroj, typ,
 * kategorie, příběh, jazyk, titulek, tělo) — přesně tvar, jaký nechával seed bez klíče.
 * Slug ani id se do klíče nepočítají: kopie z doby před stabilním klíčem slug neměly.
 */
export async function duplicityZnalosti(db: string): Promise<string[]> {
  const radky = await sql(
    db,
    `SELECT source_type || '|' || item_type || '|' || coalesce(category, '-') || '|' || coalesce(story_id::text, '-')
            || '|' || locale || '|' || title || ' ×' || count(*)
       FROM public.knowledge_items
      GROUP BY source_type, item_type, category, story_id, locale, title, md5(body_markdown)
     HAVING count(*) > 1
      ORDER BY 1`,
  );
  return radky.split("\n").filter(Boolean);
}

/** Duplicitní kurátorské vzory hodnocení (bez vazby na zprávu chatu). */
export async function duplicityVzoru(db: string): Promise<string[]> {
  const radky = await sql(
    db,
    `SELECT left(user_message, 60) || ' ×' || count(*)
       FROM public.ai_golden_examples
      WHERE message_id IS NULL AND conversation_id IS NULL
      GROUP BY user_message, md5(assistant_message)
     HAVING count(*) > 1
      ORDER BY 1`,
  );
  return radky.split("\n").filter(Boolean);
}

/** Zrcadla expert_rules → knowledge_items: má být právě jedno na pravidlo. */
export async function zrcadla(db: string): Promise<{ pravidla: number; zrcadla: number; viceNezJedno: number; bezZrcadla: number }> {
  const r = await sql(
    db,
    `SELECT (SELECT count(*) FROM public.expert_rules),
            (SELECT count(*) FROM public.knowledge_items WHERE source_type = 'guild_db' AND item_type = 'expert_rule'),
            (SELECT count(*) FROM (SELECT source_id FROM public.knowledge_items
                                    WHERE source_type = 'guild_db' AND item_type = 'expert_rule'
                                    GROUP BY source_id HAVING count(*) > 1) x),
            (SELECT count(*) FROM public.expert_rules er WHERE NOT EXISTS (
                SELECT 1 FROM public.knowledge_items k
                 WHERE k.source_type = 'guild_db' AND k.item_type = 'expert_rule' AND k.source_id = er.id))`,
  );
  const [pravidla, zrc, vice, bez] = r.split("|").map(Number);
  return { pravidla, zrcadla: zrc, viceNezJedno: vice, bezZrcadla: bez };
}

/**
 * Počty řádků VŠECH tabulek (mimo systémová schémata) — měřidlo třídy: tabulka, která
 * roste s každým seedem, je zdroj duplicit, ať je to kterákoli.
 */
export async function poctyTabulek(db: string): Promise<Record<string, number>> {
  const radky = await sql(
    db,
    `SELECT table_schema || '.' || table_name,
            (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
       FROM information_schema.tables
      WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1`,
  );
  return Object.fromEntries(
    radky
      .split("\n")
      .filter(Boolean)
      .map((r) => {
        const [t, n] = r.split("|");
        return [t, Number(n)];
      }),
  );
}

/** Počet kurátorských vzorů hodnocení. */
export async function pocetVzoru(db: string): Promise<number> {
  return Number(await sql(db, `SELECT count(*) FROM public.ai_golden_examples WHERE message_id IS NULL AND conversation_id IS NULL`));
}
