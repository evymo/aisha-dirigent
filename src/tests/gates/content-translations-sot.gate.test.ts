/**
 * Content Translations SoT Gate
 *
 * DB content translations are runtime/CMS `translations` rows, separate from
 * static frontend i18n segments/locales. They are generated from file SoT and
 * kept in the same seed layer as the content they describe:
 *
 *   platform:       src/i18n/content/{locale}/{namespace}.json
 *   demo:           src/i18n/content/demo/{locale}/{namespace}.json
 *   implementation: src/i18n/content/implementations/{name}/{locale}/{namespace}.json
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  readContentTree,
  treeToRows,
  buildNamespaceSql,
  parseSeedSql,
  discoverContentLayers,
} from "../../../scripts/i18n/lib/content-translations.mjs";

const ROOT = process.cwd();
const CONTENT_DIR = join(ROOT, "src/i18n/content");
const SEED_ROOT_DIR = join(ROOT, "aisha/db/seed");

interface ContentLayer {
  kind: string;
  name: string;
  contentDir: string;
  outDir: string;
  filename(namespace: string): string;
  sourceLabel: string;
}

interface TranslationRow {
  key: string;
  locale: string;
  namespace: string;
  value: string;
}

function expectedForLayer(layer: ContentLayer): {
  rows: TranslationRow[];
  expected: Record<string, string>;
} {
  const tree = readContentTree(layer.contentDir);
  const rows = treeToRows(tree) as TranslationRow[];
  const byNs: Record<string, TranslationRow[]> = {};
  for (const row of rows) (byNs[row.namespace] ??= []).push(row);

  const expected: Record<string, string> = {};
  for (const namespace of Object.keys(byNs).sort()) {
    expected[layer.filename(namespace)] = buildNamespaceSql(
      namespace,
      byNs[namespace],
      layer.sourceLabel,
    );
  }
  return { rows, expected };
}

describe("Content translations SoT gate", () => {
  const layers = discoverContentLayers(CONTENT_DIR, SEED_ROOT_DIR) as ContentLayer[];
  const plans = layers.map((layer) => ({ layer, ...expectedForLayer(layer) }));
  const allRows = plans.flatMap((plan) => plan.rows);

  it("content SoT tree is non-empty (extraction ran)", () => {
    expect(plans.length).toBeGreaterThan(0);
    expect(allRows.length).toBeGreaterThan(1000);
  });

  it("each layer seed SQL equals the generator output from src/i18n/content/", () => {
    const drift: string[] = [];
    for (const { layer, expected } of plans) {
      for (const [file, expectedSql] of Object.entries(expected)) {
        const actualPath = join(layer.outDir, file);
        if (!existsSync(actualPath)) {
          drift.push(`missing ${layer.kind}:${layer.name}/${file}`);
          continue;
        }
        const actual = readFileSync(actualPath, "utf8");
        if (actual !== expectedSql) drift.push(`drift ${layer.kind}:${layer.name}/${file}`);
      }
    }
    expect(
      drift,
      `Content-translation seed out of sync. Run \`npm run i18n:content:build\`:\n${drift.join("\n")}`,
    ).toEqual([]);
  });

  it("no legacy translation dump survives outside the content SoT", () => {
    const stale: string[] = [];
    for (const { layer, expected } of plans) {
      if (!existsSync(layer.outDir)) continue;
      const owned = new Set(Object.keys(expected));
      for (const file of readdirSync(layer.outDir).filter((x) => x.endsWith(".sql"))) {
        if (owned.has(file)) continue;
        if (parseSeedSql(join(layer.outDir, file)).length > 0) {
          stale.push(`${layer.kind}:${layer.name}/${file}`);
        }
      }
    }
    expect(
      stale,
      `Legacy translation dump(s) not migrated into src/i18n/content/: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
