/**
 * @module capability-catalog
 * Pure scanning + rendering logic for the AISHA capability catalog ("adresář").
 *
 * Single source of truth: the git working tree. This module reads the repo and
 * derives a deterministic inventory of what AISHA can use — services, packages,
 * plugins, domain templates, agent commands/skills, MCP tools, n8n workflows,
 * DB catalog tables and npm script groups — so the catalog can be regenerated
 * from git instead of hand-maintained.
 *
 * Design notes:
 *   - No network, no writes. Every scanner is `(rootDir) => entry[]` and is
 *     individually exported so it can be unit-tested against a fixture repo.
 *   - Output is deterministic (everything sorted, no timestamps) so callers can
 *     diff a fresh scan against the committed catalog to detect drift (CI gate).
 *   - Each scanner is defensive: a single malformed file degrades to a skipped
 *     entry, never a crashed generation.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { porovnej } from "./razeni.mjs";

export const SCHEMA_VERSION = 1;

/**
 * Ordered category metadata. `order` drives both JSON key order and the MD
 * section order; `title` is the human heading in the rendered adresář.
 */
export const CATEGORIES = [
  { id: "services", title: "Služby (microservices)", blurb: "Samostatně nasaditelné backend služby (services/*)." },
  { id: "packages", title: "Sdílené balíčky", blurb: "Interní npm workspace balíčky (packages/*) sdílené napříč službami." },
  { id: "plugins", title: "Pluginy", blurb: "Pluginy asimilované AISHA dle plugin-manifest schématu." },
  { id: "domainTemplates", title: "Šablony domén", blurb: "Předpřipravené šablony webů/domén (domains/templates/*)." },
  { id: "agentCommands", title: "Agent commandy", blurb: "Slash-commandy pro Claude/IDE (.claude/commands/*)." },
  { id: "agentSkills", title: "Agent skilly", blurb: "Skilly pro Claude/IDE (.claude/skills/*)." },
  { id: "mcpTools", title: "MCP nástroje", blurb: "Nástroje vystavené MCP knowledge serverem (svc-mcp-knowledge)." },
  { id: "n8nWorkflows", title: "n8n workflows", blurb: "Orchestrace a self-learning workflows (n8n/workflows/*)." },
  { id: "dbCatalogs", title: "DB katalogy a registry", blurb: "Tabulky typu katalog/registry (aisha/db/sql/tables/*)." },
  { id: "npmScripts", title: "npm skript skupiny", blurb: "Skupiny npm skriptů z kořenového package.json — jak věci spouštět." },
];

// ---------------------------------------------------------------------------
// Filesystem helpers (defensive — never throw on a single bad file)
// ---------------------------------------------------------------------------

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const raw = readText(filePath);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listDirs(dirPath) {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function listFiles(dirPath, predicate) {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isFile() && predicate(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function firstParagraph(markdown) {
  if (!markdown) return "";
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue; // heading
    if (trimmed.startsWith(">")) continue; // blockquote / auto-gen note
    if (trimmed.startsWith("<!--")) continue; // html comment
    if (trimmed.startsWith("---")) continue; // hr / front-matter fence
    return trimmed.replace(/\s+/g, " ");
  }
  return "";
}

function firstHeading(markdown) {
  if (!markdown) return "";
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

/** Parse a leading `--- ... ---` YAML-ish front-matter block into flat keys. */
function parseFrontMatter(markdown) {
  if (!markdown) return {};
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function truncate(text, max = 240) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// ---------------------------------------------------------------------------
// Scanners — each returns a sorted array of entries
// ---------------------------------------------------------------------------

export function scanServices(rootDir) {
  const base = path.join(rootDir, "services");
  return listDirs(base).map((name) => {
    const pkg = readJson(path.join(base, name, "package.json")) || {};
    const dockerfile = `Dockerfile.${name}`;
    const hasDockerfile = existsSync(path.join(rootDir, dockerfile));
    const readme = readText(path.join(base, name, "README.md"));
    return {
      id: pkg.name || name,
      name,
      description: truncate(pkg.description || firstParagraph(readme) || ""),
      version: pkg.version || null,
      location: `services/${name}`,
      dockerfile: hasDockerfile ? dockerfile : null,
      usage: `microservice — viz docker-compose.*.yml${hasDockerfile ? ` (${dockerfile})` : ""}`,
    };
  });
}

export function scanPackages(rootDir) {
  const base = path.join(rootDir, "packages");
  return listDirs(base).map((name) => {
    const pkg = readJson(path.join(base, name, "package.json")) || {};
    return {
      id: pkg.name || name,
      name,
      description: truncate(pkg.description || ""),
      version: pkg.version || null,
      location: `packages/${name}`,
      usage: pkg.name ? `import z "${pkg.name}"` : `workspace balíček`,
    };
  });
}

export function scanPlugins(rootDir) {
  const base = path.join(rootDir, "plugins");
  const out = [];
  for (const name of listDirs(base)) {
    const manifest = readJson(path.join(base, name, "manifest.json"));
    if (!manifest) continue;
    out.push({
      id: manifest.id || name,
      name: manifest.name || manifest.id || name,
      description: truncate(manifest.description || ""),
      version: manifest.version || null,
      kind: manifest.kind || null,
      trustTier: manifest.trust_tier || null,
      capabilityCount: Array.isArray(manifest.capabilities) ? manifest.capabilities.length : 0,
      location: `plugins/${name}/manifest.json`,
      usage: `plugin id: ${manifest.id || name}`,
    });
  }
  return out.sort((a, b) => porovnej(a.id, b.id));
}

export function scanDomainTemplates(rootDir) {
  const base = path.join(rootDir, "domains", "templates");
  const out = [];
  for (const name of listDirs(base)) {
    const manifest = readJson(path.join(base, name, "manifest.json")) || {};
    out.push({
      id: name,
      name: manifest.name || name,
      description: truncate(manifest.description || ""),
      location: `domains/templates/${name}`,
      usage: `šablona domény: ${name}`,
    });
  }
  return out;
}

function scanCommandDir(rootDir, relDir) {
  return listFiles(path.join(rootDir, relDir), (f) => f.endsWith(".md")).map((file) => {
    const md = readText(path.join(rootDir, relDir, file)) || "";
    const slug = file.replace(/\.md$/, "");
    return {
      id: slug,
      name: firstHeading(md) || slug,
      description: truncate(firstParagraph(md)),
      autoGenerated: md.includes("Auto-generated from AISHA Expert Overlay ruleset."),
      location: `${relDir}/${file}`,
      usage: `/${slug}`,
    };
  });
}

export function scanAgentCommands(rootDir) {
  return scanCommandDir(rootDir, ".claude/commands");
}

export function scanAgentSkills(rootDir) {
  const base = path.join(rootDir, ".claude", "skills");
  const out = [];
  for (const name of listDirs(base)) {
    const md = readText(path.join(base, name, "SKILL.md"));
    if (md == null) continue;
    const fm = parseFrontMatter(md);
    out.push({
      id: fm.name || name,
      name: fm.name || name,
      description: truncate(fm.description || firstParagraph(md)),
      location: `.claude/skills/${name}/SKILL.md`,
      usage: `skill: ${fm.name || name}`,
    });
  }
  return out;
}

export function scanMcpTools(rootDir) {
  const src = readText(path.join(rootDir, "services/svc-mcp-knowledge/src/routes/mcp.ts"));
  if (!src) return [];
  const out = [];
  const re = /\btool\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({
      id: m[1],
      name: m[1],
      description: truncate(m[2].replace(/\\'/g, "'")),
      location: "services/svc-mcp-knowledge/src/routes/mcp.ts",
      usage: `MCP tool: ${m[1]}`,
    });
  }
  return out.sort((a, b) => porovnej(a.id, b.id));
}

export function scanN8nWorkflows(rootDir) {
  const base = path.join(rootDir, "n8n", "workflows");
  return listFiles(base, (f) => f.endsWith(".json")).map((file) => {
    const wf = readJson(path.join(base, file)) || {};
    const slug = file.replace(/\.json$/, "");
    return {
      id: slug,
      name: wf.name || slug,
      description: truncate(wf.name && wf.name !== slug ? wf.name : ""),
      nodeCount: Array.isArray(wf.nodes) ? wf.nodes.length : null,
      location: `n8n/workflows/${file}`,
      usage: `n8n workflow: ${slug}`,
    };
  });
}

export function scanDbCatalogs(rootDir) {
  const base = path.join(rootDir, "aisha", "db", "sql", "tables");
  const files = listFiles(base, (f) => f.endsWith(".sql") && /(catalog|registry)/i.test(f));
  return files.map((file) => {
    const table = file.replace(/\.sql$/, "");
    return {
      id: table,
      name: table,
      description: /registry/i.test(table) ? "registry tabulka" : "katalog tabulka",
      location: `aisha/db/sql/tables/${file}`,
      usage: `tabulka: ${table}`,
    };
  });
}

export function scanNpmScripts(rootDir) {
  const pkg = readJson(path.join(rootDir, "package.json")) || {};
  const scripts = pkg.scripts || {};
  const groups = new Map();
  for (const name of Object.keys(scripts)) {
    const group = name.includes(":") ? name.slice(0, name.indexOf(":")) : "root";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(name);
  }
  return [...groups.entries()]
    .map(([group, names]) => ({
      id: group,
      name: group === "root" ? "(top-level)" : `${group}:*`,
      description: `${names.length} skript(ů)`,
      count: names.length,
      scripts: names.sort(),
      usage: `npm run ${names.sort()[0]}`,
    }))
    .sort((a, b) => porovnej(a.id, b.id));
}

const SCANNERS = {
  services: scanServices,
  packages: scanPackages,
  plugins: scanPlugins,
  domainTemplates: scanDomainTemplates,
  agentCommands: scanAgentCommands,
  agentSkills: scanAgentSkills,
  mcpTools: scanMcpTools,
  n8nWorkflows: scanN8nWorkflows,
  dbCatalogs: scanDbCatalogs,
  npmScripts: scanNpmScripts,
};

/**
 * Scan the whole repo into a deterministic catalog core (no timestamps).
 * @param {string} rootDir absolute repo root
 * @returns {{ schemaVersion: number, summary: Record<string, number>, categories: Record<string, object[]> }}
 */
export function scanCapabilities(rootDir) {
  const categories = {};
  const summary = {};
  let total = 0;
  for (const { id } of CATEGORIES) {
    const entries = SCANNERS[id](rootDir);
    categories[id] = entries;
    summary[id] = entries.length;
    total += entries.length;
  }
  summary.total = total;
  return { schemaVersion: SCHEMA_VERSION, summary, categories };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Deterministic JSON string. `generatedAt` is the only volatile field. */
export function renderJson(core, { generatedAt }) {
  return `${JSON.stringify({ generatedAt, ...core }, null, 2)}\n`;
}

function mdEscape(text) {
  return String(text || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderCategoryTable(id, entries) {
  if (entries.length === 0) return "_Žádné položky._\n";
  if (id === "npmScripts") {
    const rows = entries
      .map((e) => `| \`${mdEscape(e.name)}\` | ${e.count} | ${mdEscape(e.scripts.slice(0, 6).join(", "))}${e.scripts.length > 6 ? " …" : ""} |`)
      .join("\n");
    return `| Skupina | Počet | Skripty (ukázka) |\n|---|---|---|\n${rows}\n`;
  }
  if (id === "plugins") {
    const rows = entries
      .map((e) => `| ${mdEscape(e.name)} | \`${mdEscape(e.id)}\` | ${mdEscape(e.description)} | ${mdEscape(e.kind || "")} / ${mdEscape(e.trustTier || "")} | \`${mdEscape(e.location)}\` |`)
      .join("\n");
    return `| Plugin | id | Co to je | Kind / Trust | Kde |\n|---|---|---|---|---|\n${rows}\n`;
  }
  const rows = entries
    .map((e) => `| ${mdEscape(e.name)} | ${mdEscape(e.description)} | \`${mdEscape(e.usage || "")}\` | \`${mdEscape(e.location)}\` |`)
    .join("\n");
  return `| Položka | Co to je | Jak použít | Kde |\n|---|---|---|---|\n${rows}\n`;
}

/**
 * Render the human-readable adresář. Includes the AISHA auto-gen marker so
 * `safeWriteSync` treats the file as regenerable, plus a preserved user-section.
 */
export function renderMarkdown(core, { generatedAt, regenCommand = "npm run gen:catalog" }) {
  const { summary, categories } = core;
  const summaryRows = CATEGORIES.map((c) => `| ${c.title} | ${summary[c.id]} |`).join("\n");

  const sections = CATEGORIES.map((c) => {
    const entries = categories[c.id];
    return `### ${c.title}\n\n${c.blurb}\n\n${renderCategoryTable(c.id, entries)}`;
  }).join("\n");

  return `# AISHA — Adresář schopností (Capability Catalog)

> Auto-generated from AISHA Expert Overlay ruleset.
> **Neupravuj ručně** — zdrojem pravdy je git working tree. Přegeneruj přes \`${regenCommand}\`.
> Generated: ${generatedAt}

Strojově čitelná podoba: [\`capabilities.json\`](./capabilities.json).
Tento adresář vzniká skenováním repozitáře — co AISHA a vývojáři mají k dispozici, co to dělá a jak to použít.

## Přehled

| Kategorie | Počet |
|---|---|
${summaryRows}
| **Celkem** | **${summary.total}** |

## Kategorie

${sections}
<!-- aisha:user-section:start -->

## Poznámky (ručně, přežijí regeneraci)

_Sem patří kontext, který nelze odvodit z gitu — priority, deprecace, odkazy na ADR apod._

<!-- aisha:user-section:end -->
`;
}

/** Compare two catalog cores ignoring volatile fields (used by --check). */
export function coresEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
