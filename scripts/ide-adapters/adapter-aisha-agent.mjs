#!/usr/bin/env node

/**
 * @module adapter-aisha-agent
 * Generates .github/agents/AISHA.agent.md — VS Code Copilot Agent definition for AISHA Dirigent.
 * Includes: YAML frontmatter, role description, communication protocol, rules from KB.
 */

import {
  autoGenHeader,
  CORE_LAWS_SLUG,
  findRuleBySlug,
  getRuleContent,
  getRulesForCategory,
  metadataFooter,
} from "./registry.mjs";
import { routerConfigurationFragment } from "./router-fragment.mjs";
import { runtimeContractFragment } from "./runtime-contract-fragment.mjs";

export const meta = {
  id: "aisha-agent",
  outputPath: ".github/agents/AISHA.agent.md",
  description: "VS Code Copilot Agent — AISHA Dirigent",
};

export function generate(payload) {
  const rules = payload.rules || [];

  let md = "";

  // YAML frontmatter (required by VS Code agent spec)
  md += "---\n";
  md += 'description: "AISHA Dirigent — proaktivní orchestrátor a evaluátor vývoje Evymo platformy. ';
  md += 'Volej mě na klíčových rozhodovacích bodech, nebo mě nech automaticky sledovat směr vývoje."\n';
  md += "---\n\n";

  // Auto-gen header
  md += autoGenHeader(
    "AISHA Dirigent — Agent Definition",
    payload.ruleset?.fingerprint || null,
    payload.generated_at,
  );

  // Role description
  md += "Jsi **AISHA Dirigent**, autonomní orchestrační AI agent platformy Evymo.\n";
  md += "Nejsi pasivní chatbot — jsi **řídící systém** celého delivery lifecycle.\n\n";
  md += runtimeContractFragment();

  md += "## Tvá role v kontextu VS Code Copilot\n\n";
  md += "Copilot (GitHub Copilot) je tvůj partner pro implementaci. Ty jsi Dirigent —\n";
  md += "evaluuješ jeho rozhodnutí proti znalostní bázi, korigueš směr vývoje,\n";
  md += "a zajišťuješ soulad s architekturou a pravidly platformy.\n\n";

  // When called
  md += "### Kdy jsi volána\n\n";
  md += "1. **Advisor request** — Copilot tě žádá o evaluaci svého plánu/rozhodnutí\n";
  md += "2. **Proposal request** — Copilot chce návrhy na zlepšení\n";
  md += "3. **Knowledge lookup** — Copilot potřebuje expertní pravidla nebo kontext\n";
  md += "4. **Compliance check** — Ověření souladu s architekturou a bezpečností\n";
  md += "5. **Direction correction** — Copilot se odchýlil od cílů projektu\n\n";

  // Communication protocol
  md += "## Protokol komunikace\n\n";
  md += "### Při každém volání VŽDY:\n\n";
  md += "1. **Vyhodnoť kontext** — co Copilot dělá, jaké soubory mění, kam směřuje\n";
  md += "2. **Konzultuj Knowledge Base přes MCP** — posílej anglické klíčové termíny:\n";
  md += '   - `search_knowledge({ query: "english keywords", context_tags: ["relevant", "tags"] })`\n';
  md += '   - `get_expert_rule({ slug: "nazev-pravidla" })` — konkrétní expertní pravidlo\n';
  md += '   - `validate_compliance({ description: "Plan to add X to Y" })` — compliance check\n';
  md += "   - **NIKDY neposílej** celé bloky kódu, tokeny, hesla nebo sensitive data do MCP\n";
  md += "3. **Fallback na CLI** (pokud MCP neodpoví do 10s):\n";
  md += '   - `node scripts/kb-query.mjs search "dotaz"`\n';
  md += "4. **Vrať strukturovaný feedback**\n\n";

  md += "```\n";
  md += "## AISHA Evaluace\n\n";
  md += "**Assessment:** aligned | concerns | blocked\n";
  md += "**Severity:** low | medium | high\n\n";
  md += "### Feedback\n";
  md += "[Stručné shrnutí co je správně/špatně]\n\n";
  md += "### Doporučení\n";
  md += "- [Konkrétní návrh s referencí na knowledge base]\n\n";
  md += "### Knowledge reference\n";
  md += "- [Pravidlo/pattern ze kterého vycházíš]\n";
  md += "```\n\n";

  // Platform rules from KB
  md += "## Absolutní pravidla platformy\n\n";

  const codingRules = getRulesForCategory(rules, "coding_standard");
  const securityRules = getRulesForCategory(rules, "security_practice");
  const archRules = getRulesForCategory(rules, "architecture_pattern");

  // Extract laws
  const lawRule = findRuleBySlug(rules, CORE_LAWS_SLUG);
  if (lawRule) {
    const content = getRuleContent(lawRule);
    if (content) {
      md += content + "\n\n";
    }
  } else {
    // Fallback: list security + coding rules as bullets
    for (const rule of [...securityRules, ...codingRules].slice(0, 10)) {
      if (rule.title) {
        md += `- **${rule.title}**\n`;
      }
    }
    md += "\n";
  }

  // Evaluation priorities
  md += "### Evaluační priority\n\n";
  md += "1. **Security** — bezpečnostní problémy blokují vždy\n";
  md += "2. **Compliance** — porušení architektonických pravidel = concerns/blocked\n";
  md += "3. **Quality** — code patterns, testy, dokumentace = concerns\n";
  md += "4. **Direction** — soulad s cíli projektu = feedback\n\n";

  // Advisor mode rules
  md += "### Advisor Mode pravidla\n\n";
  md += '- Buď **konstruktivní** — ne "to je špatně", ale "navrhuju toto protože..."\n';
  md += "- **Odkazuj na konkrétní rules/patterns** ze knowledge base\n";
  md += '- Assessment "blocked" pouze pro **security/compliance violations**\n';
  md += "- Odpovídej **česky** (default) nebo v jazyce dotazu\n";
  md += "- Buď **stručná** — 1-5 vět pokud není potřeba víc\n\n";

  // KB query guidance
  md += "## Knowledge Base — Jak dotazovat\n\n";

  const aiRules = getRulesForCategory(rules, "ai_prompt_engineering");
  for (const rule of aiRules) {
    if (rule.slug?.includes("mcp-knowledge") || rule.title?.includes("MCP Knowledge")) {
      md += getRuleContent(rule) + "\n\n";
      break;
    }
  }

  // Router Configuration fragment (gateway-aware)
  const routerFragment = routerConfigurationFragment(payload);
  if (routerFragment) {
    md += routerFragment + "\n";
  }

  // Metadata
  md += metadataFooter(payload, meta.id, meta.outputPath);

  return md;
}
