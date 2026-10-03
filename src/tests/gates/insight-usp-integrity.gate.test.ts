/**
 * Insight USP Integrity Gate
 *
 * Chrání před regresí integrace Alquist Insight (Ragnarok + Maestro):
 *  - Maestro/Ragnarok services aktivní v compose, žádný `_API_KEY: "disabled"` regression.
 *  - CONTEXT_ENABLED=true v Maestro env (jinak je dialog management dead = ztráta USP).
 *  - Code wiring: provider adapter, MCP routes, hooky, Story KB UI komponenta.
 *  - Brain layer integrita: migrace pro Tao/Psyche/Hippocampus/Occipitum/governance,
 *    `compose_context.sql` referuje 4 vrstvy, n8n workflows existují.
 *  - svc-ai-chat /story-consult orchestrace volá brain RPCs (compose_context,
 *    Hippocampus, governance) — frontend NESMÍ obejít přes přímé Maestro volání.
 *  - Frontend hook `useMaestro` NEEXISTUJE (jen `useStoryConsult` přes svc-ai-chat).
 *
 * Žádný workaround, žádná regrese — Insight integrace je vrstva NAD AISHA brainem,
 * ne vedle něj.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { naSiti, reHost } from "./lib/vnitrni-adresa";
import { zdrojBezKomentaru } from "../lib/bez-komentaru";

const ROOT = process.cwd();

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

// insight submodule (github) is absent on the self-hosted runner (checked out
// without submodules); skip the vendoring-Pipfile check there. Runs fully in any
// checkout that has the submodule (local dev / full clones).
const HAVE_INSIGHT = exists('packages/insight/.git') || exists('packages/insight/maestro/Pipfile');

/** Přípony, u nichž `//` mimo řetězec OPRAVDU uvozuje komentář. */
const ZDROJ_JS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * ⛔ U JS/TS SE ČTE KÓD, NE PRÓZA (naměřeno 2026-09-02).
 *
 * Tvrzení níž mají tvar „zapojení existuje" (`toMatch`), takže zmínka
 * hledaného názvu v komentáři je pustí — falešná ZELENÁ, tedy horší směr
 * než falešný nález.
 *
 * Doloženo: `expect(maestro).toMatch(/mesh\.aisha\.internal/)` procházelo,
 * ačkoli ten řetězec v `providers/maestro.ts` stojí JEN v komentáři — a to
 * v komentáři, který vysvětluje, že se ten natvrdo psaný literál 2026-08-12
 * z allowlistu ZÁMĚRNĚ odstranil. Brána tedy potvrzovala přítomnost něčeho,
 * co bylo vědomě smazáno. Tvrzení je opravené níž.
 *
 * Zabělení platí JEN pro JS/TS. `readFile` sem tahá i compose YAML,
 * Dockerfily a shellové skripty — tam `//` komentář neuvozuje a běžně stojí
 * uprostřed nezauvozovkované adresy (`url: http://neco`), takže by zabělení
 * ukously zbytek řádku a rozbilo asserce o nasazení.
 */
function readFile(relPath: string): string {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return '';
  const obsah = fs.readFileSync(full, 'utf-8');
  return ZDROJ_JS.test(relPath) ? zdrojBezKomentaru(obsah) : obsah;
}

describe('Insight USP Integrity Gate', () => {
  // ===========================================================================
  // 1) Deploy & vendoring asserce
  // ===========================================================================

  describe('Deploy & vendoring', () => {
    it('compose includes ragnarok, maestro, and aisha-kronos-shim services', () => {
      const compose = readFile('docker-compose.coolify-integration.yml');
      expect(compose).toMatch(/^\s+ragnarok:/m);
      expect(compose).toMatch(/^\s+maestro:/m);
      expect(compose, 'aisha-kronos-shim soft adapter pro Maestro→AISHA RPC').toMatch(/^\s+aisha-kronos-shim:/m);
    });

    it('no MAESTRO_API_KEY: "disabled" or RAGNAROK_API_KEY: "disabled" regression', () => {
      const candidates = [
        'docker-compose.coolify-integration.yml',
        '.env.coolify',
        'docker-compose.local.yml',
      ];
      for (const file of candidates) {
        if (!exists(file)) continue;
        const content = readFile(file);
        expect(content, `${file} must not disable MAESTRO_API_KEY`).not.toMatch(
          /MAESTRO_API_KEY[:\s=]+["']?disabled["']?/i,
        );
        expect(content, `${file} must not disable RAGNAROK_API_KEY`).not.toMatch(
          /RAGNAROK_API_KEY[:\s=]+["']?disabled["']?/i,
        );
      }
    });

    it('Maestro CONTEXT_ENABLED is true (multi-turn dialog state on)', () => {
      const compose = readFile('docker-compose.coolify-integration.yml');
      // Slice maestro service block by line scan (regex multiline + lookahead je
      // křehké přes různé YAML formáty linterů).
      const lines = compose.split('\n');
      const maestroStart = lines.findIndex((line) => /^ {2}maestro:\s*$/.test(line));
      expect(maestroStart, 'maestro service definition found').toBeGreaterThanOrEqual(0);
      let maestroEnd = lines.length;
      for (let i = maestroStart + 1; i < lines.length; i++) {
        if (/^ {2}[a-z][a-z-]*:\s*$/.test(lines[i]) || /^volumes:|^networks:/.test(lines[i])) {
          maestroEnd = i;
          break;
        }
      }
      const maestroBlock = lines.slice(maestroStart, maestroEnd).join('\n');
      expect(maestroBlock, 'maestro service block has content').toMatch(/CONTEXT_ENABLED:\s*["']?true["']?/i);
    });

    it.skipIf(!HAVE_INSIGHT)('vendoring zachován — packages/insight Pipfiles existují', () => {
      expect(exists('packages/insight/maestro/Pipfile'), 'maestro Pipfile').toBe(true);
      expect(exists('packages/insight/ragnarok/Pipfile'), 'ragnarok Pipfile').toBe(true);
      expect(exists('packages/insight/common/pyproject.toml'), 'common pyproject').toBe(true);
    });

    it('Dockerfiles v rootu', () => {
      expect(exists('Dockerfile.ragnarok'), 'Dockerfile.ragnarok').toBe(true);
      expect(exists('Dockerfile.maestro'), 'Dockerfile.maestro').toBe(true);
      expect(
        exists('Dockerfile.svc-aisha-kronos-shim'),
        'Dockerfile.svc-aisha-kronos-shim — Kronos-compatible adapter Maestro→AISHA RPC',
      ).toBe(true);
    });

    it('Kronos shim service (soft adapter) je TS service v services/svc-aisha-kronos-shim/', () => {
      expect(exists('services/svc-aisha-kronos-shim/package.json')).toBe(true);
      expect(exists('services/svc-aisha-kronos-shim/src/server.ts')).toBe(true);
      const server = readFile('services/svc-aisha-kronos-shim/src/server.ts');
      expect(server, 'shim registruje route handlers pro Kronos-compatible API').toMatch(
        /projectsRoutes|sessionsRoutes|nlpRoutes/,
      );
    });

    it('Maestro KRONOS_URL ukazuje na aisha-kronos-shim, ne upstream Kronos', () => {
      const compose = readFile('docker-compose.coolify-integration.yml');
      // Maestro service block musí mít KRONOS_URL na shim
      expect(compose).toMatch(
        new RegExp(`KRONOS_URL:\\s*["']?http://${reHost("aisha-kronos-shim", 9625)}`),
      );
      // Žádný "not-integrated" placeholder pro KRONOS_URL — je to teď live shim
      expect(compose, 'Maestro KRONOS_URL nesmí být placeholder po shim integraci').not.toMatch(
        /KRONOS_URL:\s*["']?http:\/\/not-integrated:9625/,
      );
    });

    it('compose env vars používají DEFAULT_PROVIDER_* konvenci (per Ragnarok upstream LLMFactory)', () => {
      // Multi-provider toggle musí jet přes Ragnarok upstream env vars, ne zlý
      // OPENAI_TYPE-only toggle (který Pydantic enum odmítne pro vLLM).
      const composes = ['docker-compose.local.yml', 'docker-compose.coolify-integration.yml'];
      for (const file of composes) {
        const content = readFile(file);
        expect(content, `${file} musí mít DEFAULT_PROVIDER_LLM env`).toMatch(
          /DEFAULT_PROVIDER_LLM:\s*\$\{INSIGHT_LLM_PROVIDER/,
        );
        expect(content, `${file} musí mít DEFAULT_BASE_URL_LLM pro vLLM podporu`).toMatch(
          /DEFAULT_BASE_URL_LLM:\s*\$\{INSIGHT_LLM_BASE_URL/,
        );
        expect(content, `${file} musí mít DEFAULT_PROVIDER_EMB`).toMatch(
          /DEFAULT_PROVIDER_EMB:\s*\$\{INSIGHT_EMB_PROVIDER/,
        );
      }
    });

    it('insight-mode.sh helper existuje pro snadný backend switch', () => {
      expect(exists('scripts/insight-mode.sh')).toBe(true);
      const content = readFile('scripts/insight-mode.sh');
      // Všechny 4 modes musí být case branches
      for (const mode of ['openai', 'vllm', 'hybrid', 'offline']) {
        expect(content, `mode '${mode}' musí být case branch`).toMatch(
          new RegExp(`^\\s+${mode}\\)`, 'm'),
        );
      }
    });

    it('test-insight-multiturn.sh existuje (USP coherence automated test)', () => {
      // Univerzální automatický test multi-turn coherence — bez něj nemůžeme
      // verifikovat USP (Maestro session-aware dialog state) v CI.
      expect(exists('scripts/test-insight-multiturn.sh')).toBe(true);
      const content = readFile('scripts/test-insight-multiturn.sh');
      // Musí pokrývat: upload → indexing wait → session create → turn-1 → turn-2 coherence
      expect(content, 'volá Maestro session create endpoint').toMatch(/\/sessions\//);
      expect(content, 'volá Maestro query/rag s session_id propagací').toMatch(
        /\/query\/rag\?session_id=/,
      );
      expect(content, 'parsuje NDJSON streaming chunks (chunk_index)').toMatch(/chunk_index/);
      expect(content, 'definuje turn-2 coherence pattern asserce').toMatch(
        /TURN2_COHERENCE_PATTERN/,
      );
      // Smoke skript musí test multi-turn delegovat (žádný paralelní pipeline)
      const smoke = readFile('scripts/smoke-insight.sh');
      expect(smoke, 'smoke-insight.sh deleguje multi-turn na test-insight-multiturn.sh').toMatch(
        /test-insight-multiturn\.sh/,
      );
    });

    it('test-brain-wiring.sh existuje (brain layer synergy automated test)', () => {
      // Validuje 7-vrstvou synergii AISHA brain layer přes živé RPC volání.
      // Bez něj nemáme regrese-ochranu pro Tao/Psyche/compose_context/Ruleset/KB/RBAC.
      expect(exists('scripts/test-brain-wiring.sh')).toBe(true);
      const content = readFile('scripts/test-brain-wiring.sh');
      expect(content, 'volá fn_get_tao_principles').toMatch(/fn_get_tao_principles/);
      expect(content, 'volá fn_get_psyche_traits').toMatch(/fn_get_psyche_traits/);
      expect(content, 'volá compose_context (4-layer assembly)').toMatch(/compose_context/);
      expect(content, 'ověří ruleset layer').toMatch(/ruleset/i);
      expect(content, 'ověří RBAC denial s ERRCODE 42501').toMatch(/42501/);
      expect(content, 'ověří per-story isolation (žádný cross-leak)').toMatch(
        /isolation|cross-leak|leak/i,
      );
      // Smoke skript musí brain wiring delegovat
      const smoke = readFile('scripts/smoke-insight.sh');
      expect(smoke, 'smoke-insight.sh deleguje brain wiring na test-brain-wiring.sh').toMatch(
        /test-brain-wiring\.sh/,
      );
    });

    it('storyloop-insight-kb.spec.ts existuje (frontend Insight UI e2e)', () => {
      // Frontend e2e komplement k backend testům: ověřuje, že StoryDetail
      // mountuje StoryKnowledgeContext (ruleset layer) + StoryKnowledgeUpload
      // (single ingest entry) + RBAC pro member.
      expect(exists('e2e/storyloop-insight-kb.spec.ts')).toBe(true);
      const content = readFile('e2e/storyloop-insight-kb.spec.ts');
      expect(content, 'admin storage state').toMatch(/admin\.json/);
      expect(content, 'RBAC member denial').toMatch(/member\.json/);
      expect(content, 'verify Story Knowledge Base / Knowledge Context section').toMatch(
        /Story Knowledge Base|Knowledge Context/,
      );
      expect(
        content,
        'NEPOUŽÍVAT useMaestro v frontend (regrese — orchestrace přes svc-ai-chat)',
      ).not.toMatch(/useMaestro/);
    });

    it('test-hybrid-retrieval.sh existuje (compose_context + Ragnarok merge live)', () => {
      // Validuje hybrid retrieval cestu: pgvector (řízení informací — governance,
      // RBAC, audit) + Ragnarok (vyhodnocovací část — full-text, multi-language)
      // s explicit profile flag (ragnarok_hybrid=true v repo_plus_rules,
      // planning_heavy, evidence_strict).
      expect(exists('scripts/test-hybrid-retrieval.sh')).toBe(true);
      const content = readFile('scripts/test-hybrid-retrieval.sh');
      expect(content, 'volá compose_context (pgvector layer)').toMatch(/compose_context/);
      expect(content, 'volá Ragnarok /nlp/rag/').toMatch(/nlp\/rag/);
      expect(content, 'kontroluje ragnarok_hybrid flag v context_profiles').toMatch(
        /ragnarok_hybrid/,
      );
      expect(content, 'verifikuje mergeWithIntegrity wiring').toMatch(/mergeWithIntegrity/);
      expect(content, 'env-loader pattern (tier-aware)').toMatch(/_env-loader\.sh/);
    });

    it('_env-loader.sh existuje pro tier-aware testing (local/staging/production)', () => {
      // Bez env-loaderu skripty hardcodují URL — konflikty mezi local containers
      // a production mesh. Loader normalizes tier-specific URLs (localhost host
      // ports for local; mesh for staging/prod) + sdílí tokeny správně.
      expect(exists('scripts/_env-loader.sh')).toBe(true);
      const content = readFile('scripts/_env-loader.sh');
      expect(content, 'definuje 3 tiers').toMatch(/local|staging|production/);
      expect(content, 'auto-detect přes docker container probe').toMatch(
        /aisha-local-ragnarok/,
      );
      expect(content, 'tier override URLs po env-file load').toMatch(
        /AISHA_TIER.*=.*local/,
      );
    });

    it('fn_build_ragnarok_document migration existuje (n8n WF_KB_RAGNAROK_SYNC dependency)', () => {
      // Bez této RPC workflow Build Ragnarok Document node failuje a celá
      // AISHA-native KB pipeline (knowledge_items/expert_rules → trigger →
      // n8n → Ragnarok upload) je broken na druhém kroku.
      const fs = readFile('aisha/db/migrations/00000000000000_baseline.sql');
      expect(fs, 'CREATE FUNCTION fn_build_ragnarok_document').toMatch(
        /CREATE OR REPLACE FUNCTION public\.fn_build_ragnarok_document/,
      );
      expect(fs, 'returns jsonb s filename').toMatch(/'filename'/);
      expect(fs, 'returns jsonb s file_content').toMatch(/'file_content'/);
      expect(fs, 'service_role only').toMatch(/get_jwt_role.*service_role/);
      expect(fs, 'supports both expert_rules a knowledge_items').toMatch(
        /expert_rules.*knowledge_items|knowledge_items.*expert_rules/s,
      );
    });

    it('story_rulesets schema podporuje multi-author (no UNIQUE on story_id)', () => {
      // Multi-author rulesets — kombinace user + partner + AISHA + admin
      // entries per story_id. Schema musí allow multiple rows pro same story
      // (story_contexts.ruleset_id ukáže active; ostatní v audit/curation queue).
      const baseline = readFile('aisha/db/migrations/00000000000000_baseline.sql');
      // Najít story_rulesets CREATE TABLE block
      const tableMatch = baseline.match(
        /CREATE TABLE[^;]*public\.story_rulesets[\s\S]*?(?=CREATE\s|ALTER\s|$)/i,
      );
      expect(tableMatch, 'story_rulesets CREATE TABLE block found').not.toBeNull();
      // V CREATE block: žádný UNIQUE (?,?) story_id — to by zablokovalo multi-author
      // Allowed: PRIMARY KEY (id), FOREIGN KEY (story_id), INDEX
      const block = tableMatch?.[0] ?? '';
      expect(
        block,
        'story_rulesets nesmí mít UNIQUE constraint na story_id (blokovalo by multi-author)',
      ).not.toMatch(/UNIQUE\s*\(\s*story_id\s*\)/i);
      // created_by column musí existovat pro author tracking
      expect(block, 'created_by column pro author tracking').toMatch(/created_by/i);
    });
  });

  // ===========================================================================
  // 2) Code wiring asserce
  // ===========================================================================

  describe('Code wiring', () => {
    it('MCP routes ragnarok.ts a maestro.ts existují a registrují endpoints', () => {
      const ragnarok = readFile('services/svc-mcp-knowledge/src/routes/ragnarok.ts');
      const maestro = readFile('services/svc-mcp-knowledge/src/routes/maestro.ts');
      expect(ragnarok).toMatch(/app\.(post|get)/);
      expect(maestro).toMatch(/app\.(post|get)/);
    });

    it('Maestro provider adapter v svc-ai-chat existuje a je registrován v llmRouter + backendRegistry', () => {
      // Maestro is a first-class provider (providers/maestro.ts) registered via the
      // BackendRegistry. The legacy llm-router.ts callMaestro path was removed once the
      // single router consolidation was finished (its behavior lives here now).
      expect(exists('packages/llm-dispatch/src/providers/maestro.ts')).toBe(true);
      const router = readFile('services/svc-ai-chat/src/lib/llmRouter.ts');
      const registry = readFile('packages/llm-dispatch/src/backendRegistry.ts');
      expect(router).toMatch(/maestro/i);
      expect(registry).toMatch(/createMaestroBackend/);
    });

    it('story-consult.ts wireuje brain layer (compose_context, governance, Hippocampus)', () => {
      const storyConsult = readFile('services/svc-ai-chat/src/routes/story-consult.ts');
      expect(storyConsult, 'imports enrichWithAishaContext (compose_context wrapper)').toMatch(
        /enrichWithAishaContext/,
      );
      expect(storyConsult, 'imports createHippocampus (per-user evolution)').toMatch(
        /createHippocampus/,
      );
      expect(storyConsult, 'detects escalation signals (governance)').toMatch(
        /detectEscalationSignals/,
      );
      expect(storyConsult, 'uses unifiedChat with maestro-* model resolution').toMatch(
        /maestro-/,
      );
    });

    it('Frontend hooky existují, useMaestro NESMÍ existovat (frontend nesmí obejít orchestraci)', () => {
      expect(exists('src/hooks/useRagnarok.ts'), 'useRagnarok.ts').toBe(true);
      expect(exists('src/hooks/useStoryKnowledge.ts'), 'useStoryKnowledge.ts').toBe(true);
      expect(exists('src/hooks/useAiModels.ts'), 'useAiModels.ts').toBe(true);
      expect(
        exists('src/hooks/useMaestro.ts'),
        'useMaestro.ts NESMÍ existovat — Maestro volaný JEN přes svc-ai-chat /story-consult',
      ).toBe(false);
    });

    it('Story UI: StoryKnowledgeUpload komponenta + integrace v StoryDetail', () => {
      expect(exists('src/components/storyloop/StoryKnowledgeUpload.tsx')).toBe(true);
      const detail = readFile('src/components/storyloop/StoryDetail.tsx');
      expect(detail).toMatch(/StoryKnowledgeUpload/);
    });

    it('Zod schemata pro Insight (Ragnarok + Model registry)', () => {
      expect(exists('src/schemas/insightSchemas.ts')).toBe(true);
      const schemas = readFile('src/schemas/insightSchemas.ts');
      expect(schemas).toMatch(/RagnarokSearchRequestSchema/);
      expect(schemas).toMatch(/AiModelRegistryEntrySchema/);
    });
  });

  // ===========================================================================
  // 3) Brain layer integrita — Tao + Psyche + Hippocampus + Occipitum + governance
  // ===========================================================================

  describe('Brain layer integrita (kritické pro USP)', () => {
    it('brain modules jsou zapečené v baseline SoT (ne smazány, ne v trash/)', () => {
      // Brain-module migrace byly pohlceny do baseline (chronologický koncový stav).
      // Místo existence souboru migrace ověřujeme, že efekt KAŽDÉHO modulu přetrvává
      // v baseline SoT — smazaný/„trashed" modul tu pořád spadne.
      const baseline = readFile('aisha/db/migrations/00000000000000_baseline.sql');
      const brainModules: Record<string, RegExp> = {
        tao_core_values: /fn_get_tao_principles/,
        psyche_personality_module: /fn_get_psyche_traits/,
        hippocampus_personality: /personality_signals/,
        hippocampus_evolution_engine: /fn_maybe_evolve_personality/,
        occipitum_design_profiles: /design_profiles/,
        governance_context: /governance_context/,
        ragnarok_hybrid: /ragnarok/,
      };
      for (const [mod, sig] of Object.entries(brainModules)) {
        expect(
          sig.test(baseline),
          `brain module ${mod} musí být zapečený v baseline SoT (ne smazán/trashed)`,
        ).toBe(true);
      }
    });

    it('compose_context.sql vrací 4 brain vrstvy', () => {
      const composeFn = readFile('aisha/db/sql/functions/compose_context.sql');
      expect(composeFn, 'governance_context layer (Tao)').toMatch(/governance_context/);
      expect(composeFn, 'psyche_context layer (DNA)').toMatch(/psyche_context/);
      expect(composeFn, 'kb_retrieval layer (Ragnarok hybrid)').toMatch(/kb_retrieval/);
      expect(composeFn, 'project_context layer').toMatch(/project_context/);
      expect(composeFn, 'fn_get_tao_principles RPC').toMatch(/fn_get_tao_principles/);
      expect(composeFn, 'fn_get_psyche_traits RPC').toMatch(/fn_get_psyche_traits/);
    });

    it('orchestrationBridge volá compose_context a integruje Ragnarok hybrid', () => {
      const bridge = readFile('services/svc-ai-chat/src/lib/orchestrationBridge.ts');
      expect(bridge).toMatch(/compose_context/);
      expect(bridge).toMatch(/RAGNAROK_URL/);
      expect(bridge).toMatch(/mergeWithIntegrity/);
    });

    it('hippocampus.ts má resolvePersonality + captureSignal + maybe_evolve', () => {
      const hipp = readFile('services/svc-ai-chat/src/lib/hippocampus.ts');
      expect(hipp).toMatch(/fn_search_personality_context/);
      expect(hipp).toMatch(/fn_capture_personality_signal/);
      expect(hipp).toMatch(/fn_maybe_evolve_personality/);
      expect(hipp).toMatch(/buildPersonalityPrompt/);
    });

    it('governedOrchestration má resolveGovernanceDecision + Tao constraints + stop conditions', () => {
      const gov = readFile('services/svc-ai-chat/src/lib/governedOrchestration.ts');
      expect(gov).toMatch(/resolveGovernanceDecision/);
      expect(gov).toMatch(/deriveTaoConstraints/);
      expect(gov).toMatch(/stopConditions/);
      expect(gov).toMatch(/max_loops/);
      expect(gov).toMatch(/compliance_gate/);
    });

    it('decisionProvenance ukládá governance metadata + personality_traits_used', () => {
      const provenance = readFile('services/svc-ai-chat/src/lib/decisionProvenance.ts');
      expect(provenance).toMatch(/DECISION_SOURCE_HIERARCHY/);
      const bridge = readFile('services/svc-ai-chat/src/lib/orchestrationBridge.ts');
      expect(bridge, 'AishaContentMetadata má personality_traits_used').toMatch(
        /personality_traits_used/,
      );
    });

    it('insight + brain layer n8n workflows existují', () => {
      const required = [
        'WF_RAGNAROK_AGENT.json',
        'WF_KB_RAGNAROK_SYNC.json',
        'WF_KNOWLEDGE_AGENT.json',
        'WF_MODEL_ROUTER.json',
        'WF_MODEL_ADVISORY.json',
        'WF_OCCIPITUM_DESIGN.json',
      ];
      for (const wf of required) {
        expect(
          exists(`n8n/workflows/${wf}`),
          `workflow ${wf} musí existovat v n8n/workflows/`,
        ).toBe(true);
      }
    });

    it('migrace 20260428112918_insight_maestro_provider.sql absorbována do baseline + archivována', () => {
      expect(
        exists('aisha/db/migrations/00000000000000_baseline.sql'),
      ).toBe(true);
      const registry = readFile('aisha/db/migration-registry.json');
      // Baseline-only release: migration absorbed into 00000000000000_baseline.sql + archived; active registry is baseline-only.
      expect(registry).toMatch(/Baseline-only state/i);
    });
  });

  // ===========================================================================
  // 4) Sandbox & autonomie asserce (orchestrationBridge + execution mode)
  // ===========================================================================

  describe('Sandbox & autonomie', () => {
    it('proactiveEngine existuje (autonomous mode entry point)', () => {
      expect(exists('services/svc-ai-chat/src/lib/proactiveEngine.ts')).toBe(true);
    });

    it('Maestro provider má SSRF protection (assertSafeMaestroUrl)', () => {
      const maestro = readFile('packages/llm-dispatch/src/providers/maestro.ts');
      expect(maestro).toMatch(/assertSafeMaestroUrl/);
      // ⛔ ALLOWLIST SE ODVOZUJE Z ENV, NENÍ PSANÝ NATVRDO (od 2026-08-12).
      //
      // Dřív tu stálo `.toMatch(/mesh\.aisha\.internal/)`. Po odstranění
      // literálů z providera to procházelo už jen díky komentáři, který ten
      // odstraněný fallback cituje — zelená bez opory v kódu.
      //
      // Ptáme se proto na to, co allowlist dnes dělá: skládá se ze zón
      // nasazení a chybějící proměnná ho NEROZŠIŘUJE (fail-closed).
      expect(maestro, 'allowlist se skládá ze zón nasazení').toMatch(/MAESTRO_ALLOWED_SUFFIXES/);
      expect(maestro, 'zóny pocházejí z env, ne z literálu').toMatch(/process\.env\.MESH_TLD/);
      expect(maestro, 'volitelný dodatečný seznam').toMatch(/MAESTRO_HOST_ALLOWLIST/);
      expect(maestro, 'lokální původ je povolen').toMatch(/localhost/);
      expect(maestro, 'literál zóny se do allowlistu NEDOSAZUJE').not.toMatch(/["'`]mesh\.aisha\.internal["'`]/);
    });

    it('MCP /maestro/chat je service-role-only (no JWT user access — frontend musí jít přes svc-ai-chat)', () => {
      const route = readFile('services/svc-mcp-knowledge/src/routes/maestro.ts');
      expect(route).toMatch(/verifyServiceRole/);
      expect(route, 'documents that frontend must use svc-ai-chat').toMatch(
        /svc-ai-chat|story-consult/,
      );
    });
  });
});
