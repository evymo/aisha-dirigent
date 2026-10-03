-- ==============================================================================
-- Coolify routing doctrine — governed expert_rules (core layer)
-- ==============================================================================
-- Deployment doctrine belongs in the governance path (expert_rules →
-- compose_context ruleset layer + CLAUDE.md overlay via
-- generate-ide-instructions), NOT hand-written into CLAUDE.md, which is
-- generated. A rule without technical enforcement is just text, so each rule's
-- ai_instructions names the gate that enforces it.
--
-- WHY THIS RULE EXISTS (measured 2026-07-18):
-- Coolify rewrites `$` -> `$$` in container label VALUES, and only there. Docker
-- then reads `$$` as an escaped literal `$`, so `Host(`${VAR}`)` reaches Traefik
-- as a request for a host literally named "${VAR}". It matches nothing, forever,
-- with no error and no log line. Every other YAML site is untouched:
--   environment: 751 uses OK | command/healthcheck: 181 OK | networks: 4 OK
--   labels: 56 DEAD
-- 1036 uses, 980 work, 56 die, identical syntax. That asymmetry is the trap —
-- you learn "we write ${VAR}" from 980 working examples and apply it in a label.
--
-- Three conflicting instructions had accumulated: docs/deploy/TRAEFIK_LABELS.md
-- said "use a literal hostname"; coolify-traefik-label-substitution.gate.test.ts
-- said "use bare ${VAR}"; only a later section of that same gate stated the
-- correct rule, and enforced it on one compose file. Commit 3fd92028 followed the
-- bad advice and produced another dead label; 7ed24a86 designed a tri-host
-- Keycloak router on top of dead labels, so that design never took effect.
--
-- SOURCE ONBOARDING CONTRACT classification (docs/enterprise/
-- SOURCE_ONBOARDING_CONTRACT.md — mandatory 4-dim classification):
--   source_type       = internal            (own measured deployment behaviour)
--   data_sensitivity  = public              (engineering practice, no tenant data)
--   retention_class   = long_term           (deployment doctrine)
--   legal_basis       = legitimate_interest (operational governance)
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE. Skips gracefully when the partner
-- bootstrap has not run yet (author_partner_id is NOT NULL by schema).
-- Enforcement: src/tests/gates/coolify-traefik-label-substitution.gate.test.ts
--              src/tests/gates/traefik-host-coverage.gate.test.ts
-- ==============================================================================

DO $seed$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT id INTO v_partner_id FROM partner_profiles ORDER BY created_at LIMIT 1;
  IF v_partner_id IS NULL THEN
    RAISE NOTICE 'No partner_profiles found — skipping Coolify routing doctrine seed (re-run after partner bootstrap).';
    RETURN;
  END IF;

  -- 1. No hostname in a Traefik label — routing is declared in docker_compose_domains.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'coolify-no-hostname-in-traefik-label',
    'No hostname in a Traefik label',
    'Coolify escapes $ to $$ in label values, so a Traefik Host() rule can carry neither ${VAR} (never matches) nor a literal (bakes a deployment into the platform contract). Declare public routing in docker_compose_domains.',
    E'# No hostname in a Traefik label\n\nA Traefik label must never contain a hostname — not `${VAR}`, not a literal. Public routing is declared ONLY in Coolify `docker_compose_domains`, via `scripts/coolify-domain-doctor.mjs`.\n\n## Why `${VAR}` is dead\n\nCoolify rewrites `$` to `$$` when rendering a container''s label VALUES, and only there. Docker reads `$$` as an escaped literal `$`, so the variable never expands and Traefik searches for a host literally named `${VAR}`. It matches nothing, forever, with **no error and no log line**.\n\n## Why a literal is banned\n\nIt does match — and bakes a deployment hostname into the platform contract (the public TLD is a DEFAULT, not a constant), and activates an un-namespaced `priority=99999` router on a Traefik shared across forks, out-ranking Coolify''s own correct generated router.\n\n## Trust the SITE, not the pattern\n\nMeasured 2026-07-18: `environment:` 751 uses expand, `command:`/`healthcheck:` 181 expand, `networks:` 4 expand, `labels:` 56 die. 1036 uses, 980 work, 56 dead — identical syntax. You learn "we write `${VAR}`" from 980 working examples and apply it in a label.\n\n## What IS legal in a label\n\nHost-less matchers — they carry no `$` and no deployment identity, and Coolify''s generator cannot express them:\n\n```yaml\n- "traefik.http.routers.netbird-grpc.rule=PathPrefix(`/management.ManagementService`)"\n- "traefik.http.services.netbird-management.loadbalancer.server.scheme=h2c"\n```\n\n## Diagnosing\n\nA dead label produces no error, just no router: Traefik answers 404 with NO `server:` header, identical to a nonsense subdomain. Traefik''s API is not exposed — read the rendered labels with `docker inspect` instead.',
    'devops_pipeline'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Never write a hostname into a traefik.* label — neither Host(`${VAR}`) (Coolify escapes $ to $$; the router never matches) nor Host(`literal`) (bakes a deployment into the platform contract and activates an un-namespaced priority=99999 router on a shared proxy). Declare the route in Coolify docker_compose_domains via scripts/coolify-domain-doctor.mjs. Host-less PathPrefix/Path/Method matchers remain legal. NOTE the asymmetry: ${VAR} is correct and required in environment:/command:/networks:/volume name: — the escape applies to label VALUES only. Enforcement: coolify-traefik-label-substitution.gate.test.ts (label form), traefik-host-coverage.gate.test.ts (topology coverage). Do NOT "fix" a flagged label by switching ${VAR:-x} to bare ${VAR}; both are dead.',
    ARRAY['deployment','coolify','traefik','routing','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 2. Same substitution mechanism, stated as the general lesson: the SITE decides.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'compose-substitution-depends-on-site',
    'Compose substitution depends on the YAML site',
    'The same ${VAR} syntax has different fates depending on which YAML block it sits in. Verify the site before assuming a variable expands.',
    E'# Compose substitution depends on the YAML site\n\n`${VAR}` in a compose file is not one mechanism — its fate depends on WHERE it sits, because Coolify post-processes the rendered file:\n\n| site | fate |\n|---|---|\n| `environment:` | expands — correct and required |\n| `command:` / `healthcheck:` | expands — correct |\n| `networks:` / `aliases:` / volume `name:` | expands — correct |\n| `labels:` | **escaped to `$$` — dead** |\n\nNothing in the file marks the difference, and the repo is overwhelmingly consistent in FORM (1036 uses of `${VAR}`), which is precisely why the 56 dead ones survived: consistency taught the wrong lesson.\n\n## How to check, not guess\n\n```bash\ndocker compose -f <file> config          # what docker renders\ndocker inspect <container> --format \x27{{json .Config.Labels}}\x27   # what Coolify actually deployed\n```\n\nIf a rendered value still contains `${`, it did not expand. Two writers for one job (a compose label AND a Coolify-side registration both claiming to route a host) is the shape to look for — one of them is inert.',
    'devops_pipeline'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Before assuming ${VAR} expands in a compose file, check the YAML site. environment:/command:/healthcheck:/networks:/volume name: expand normally; labels: are $-escaped by Coolify and never expand. Verify with `docker compose config` (docker''s view) and `docker inspect` (what Coolify deployed) rather than reasoning from neighbouring examples — the repo uses ${VAR} in 1036 places and 56 of them are inert. When two mechanisms both claim to perform one job (compose label vs Coolify docker_compose_domains), determine which is actually load-bearing before building on either.',
    ARRAY['deployment','coolify','compose','substitution','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

END $seed$;
