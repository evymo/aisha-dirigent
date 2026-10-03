/**
 * Per-IDE template engine — Phase 13 WP 13.2.
 *
 * Renders the workspace envelope into IDE-specific instruction file content
 * via the Eta template engine. Templates live in `services/svc-ide-context/
 * templates/{ide}/instructions.eta` and are bundled with the service image.
 *
 * Operator override: set `AISHA_TEMPLATES_DIR=/path/to/templates` to load
 * custom templates from a Coolify-mounted directory. The loader falls back
 * to the bundled defaults for any IDE whose override file is missing or
 * fails to compile.
 *
 * Every rendered file carries `<!-- AISHA-MANAGED-START -->` /
 * `<!-- AISHA-MANAGED-END -->` delimiters so the aisha-ide-bridge client
 * (WP 13.3) can safely merge with user-owned sections (per
 * `feedback_agent_on_user_machine_safety.md`).
 *
 * NO PII in rendered output — envelope is already PII-safe (Zod schema
 * enforces). Templates MUST NOT introduce user-supplied free text fields.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import type { WorkspaceContextEnvelope } from "./envelope.js";

export type SupportedIde = "claude-code" | "cursor" | "copilot" | "jetbrains";

export const SUPPORTED_IDES: ReadonlyArray<SupportedIde> = [
  "claude-code",
  "cursor",
  "copilot",
  "jetbrains",
] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default bundled templates: relative to this file → ../../templates */
const BUNDLED_TEMPLATES_DIR = path.resolve(__dirname, "..", "..", "templates");

/**
 * Operator override directory (optional). When set, the loader prefers
 * `<override>/{ide}/instructions.eta` over the bundled default. Falls back
 * silently per IDE if the override is missing.
 */
function operatorTemplatesDir(): string | null {
  const v = process.env.AISHA_TEMPLATES_DIR;
  if (!v || v.length === 0) return null;
  return path.resolve(v);
}

/** Eta engine — autoEscape disabled because our envelope is already
    Zod-validated PII-safe + templates emit Markdown/JSON, not HTML. */
const eta = new Eta({
  views: BUNDLED_TEMPLATES_DIR,
  cache: true,
  autoEscape: false,
});

/** Resolve template file path with operator-override fallback.
    Paths are derived from operator-trusted `AISHA_TEMPLATES_DIR` env +
    SupportedIde literal union — no user input flows here. */
function resolveTemplatePath(ide: SupportedIde): string {
  const fileName = path.join(ide, "instructions.eta");
  const override = operatorTemplatesDir();
  if (override) {
    const overridePath = path.join(override, fileName);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-controlled env, IDE name is TS literal union, no traversal vector
    if (fs.existsSync(overridePath)) return overridePath;
  }
  return path.join(BUNDLED_TEMPLATES_DIR, fileName);
}

/** Cache compiled template body per IDE to avoid re-reading the file on
    every render. The Eta instance also caches; this is belt-and-braces. */
const templateBodyCache = new Map<SupportedIde, string>();

function loadTemplateBody(ide: SupportedIde): string {
  const cached = templateBodyCache.get(ide);
  if (cached !== undefined) return cached;
  const resolved = resolveTemplatePath(ide);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolved by resolveTemplatePath which only accepts SupportedIde literals
  const body = fs.readFileSync(resolved, "utf8");
  templateBodyCache.set(ide, body);
  return body;
}

/** Public hook for tests / hot-reload signals — clears the file cache. */
export function clearTemplateCache(): void {
  templateBodyCache.clear();
}

const IDE_CONTENT_TYPES: Record<SupportedIde, string> = {
  "claude-code": "text/markdown; charset=utf-8",
  cursor: "text/plain; charset=utf-8",
  copilot: "text/markdown; charset=utf-8",
  jetbrains: "application/json; charset=utf-8",
};

export function renderInstructions(
  ide: SupportedIde,
  envelope: WorkspaceContextEnvelope,
): { contentType: string; body: string } {
  const templateBody = loadTemplateBody(ide);
  const rendered = eta.renderString(templateBody, envelope);
  return {
    contentType: IDE_CONTENT_TYPES[ide],
    body: rendered,
  };
}
