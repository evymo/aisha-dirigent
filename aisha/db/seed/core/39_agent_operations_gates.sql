-- ==============================================================================
-- Agent Operations Gates — governed expert_rules (core layer)
-- ==============================================================================
-- Lifecycle gates for autonomous agents: what must be true before work starts,
-- while it runs, and before it is called done. AISHA carries them through her OWN
-- governance path — expert_rules → compose_context ruleset layer + CLAUDE.md
-- overlay (generate-ide-instructions) → knowledge_attribution — exactly like
-- 38_anthropic_operating_principles.sql.
--
-- A rule without technical enforcement is just text, so every rule's
-- ai_instructions names its enforcement point: a .claude/hooks advisory hook, a
-- repo-safety hook, or a gate test. Deleting the hook breaks the conformance gate,
-- not just the doctrine.
--
-- Advisory-only invariant: these hooks WARN. Hard blocking belongs to CI and
-- repo-safety hooks (block-baseline-edit.sh), never to the expert plane — the
-- expert plane has an opinion, not authority.
--
-- PROVENANCE: distilled from operating autonomous coding agents on live projects.
-- Every gate abstracts a real failure mode (unbounded retry loops, abandoned
-- commit backlogs, consent inferred from an adjacent task). The rules are stated
-- as general engineering practice: no third-party content, identifiers, domains,
-- business data or personal data is carried into this seed.
--
-- SOURCE ONBOARDING CONTRACT classification (docs/enterprise/
-- SOURCE_ONBOARDING_CONTRACT.md — mandatory 4-dim classification):
--   source_type       = internal            (our own operating doctrine)
--   data_sensitivity  = public              (general engineering practice)
--   retention_class   = long_term           (operating doctrine)
--   legal_basis       = legitimate_interest (operational governance)
-- The classification is mirrored in ai_context_tags on every rule so the
-- retrieval layer and attribution can filter on it.
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE (rules are platform doctrine — a
-- re-seed refreshes the directive text). Skips gracefully when the partner
-- bootstrap has not run yet (author_partner_id is NOT NULL by schema);
-- re-run the seed after onboarding to load the gates.
-- Conformance: src/tests/gates/agent-operations-gates-conformance.gate.test.ts
-- ==============================================================================

DO $$
DECLARE
  v_partner_id uuid;
BEGIN
  SELECT id INTO v_partner_id FROM partner_profiles ORDER BY created_at LIMIT 1;
  IF v_partner_id IS NULL THEN
    RAISE NOTICE 'No partner_profiles found — skipping agent operations gates seed (re-run after partner bootstrap).';
    RETURN;
  END IF;

  -- 1. Repo State Gate: work that writes starts from a known-clean state.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-repo-state-gate',
    'Repo State Gate',
    'Work that can write to the repository starts from a known-clean state — an entry check performed at commit time is not an entry check.',
    E'# Repo State Gate\n\nBefore any task that may write to the repository, verify BOTH the git state and the project state:\n\n1. Current branch matches the assignment.\n2. Working tree is clean — no foreign uncommitted changes, no conflicts, no interrupted merge/rebase.\n3. Fast-forward sync with remote. If `git pull --ff-only` fails, STOP — do not edit.\n4. No blocker that takes precedence over the new assignment.\n5. The assignment does not contradict the source of truth on the main branch.\n\n**On mismatch:** stop, describe the blocking condition, change nothing, commit nothing, request a decision. Never bypass with the assumption that it "probably does not matter".\n\n**Why:** work started over a dirty or half-finished tree mixes foreign changes with your own. Untangling that is manual and expensive.',
    'devops_pipeline'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Before a write-side git command (commit/push/merge/rebase/cherry-pick), the repo must be in a known-clean state: no interrupted merge/rebase/cherry-pick, no unmerged paths, not detached HEAD, not behind upstream. Enforcement: .claude/hooks/aisha-advise-repo-state.sh (PreToolUse Bash) warns on each of these; .husky/pre-push runs the full CI gate before the push lands. On mismatch STOP and request a decision — never proceed on the assumption it does not matter.',
    ARRAY['agent-operations','governance','git','repo-state','entry-gate','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 2. Context reuse: do not re-read what has not changed.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-context-reuse',
    'Context reuse over blind reread',
    'A blind reread of an unchanged large file burns context and credit for zero information gain — first find out what actually changed, or ask a targeted question.',
    E'# Context reuse over blind reread\n\nDo not routinely re-read large documents already read in this session. First establish what actually changed:\n\n```bash\ngit diff --name-only        # what changed at all\ngit log -- <file>           # did this file change?\ngrep -n "<symbol>" <file>   # targeted question instead of the whole file\n```\n\nRead with offset/limit when only a section is needed.\n\n**A full reread IS warranted when:** new thread or context switch, missing context, a detected file change, or genuine doubt about whether a rule is current.\n\n**Why:** re-ingesting an unchanged file costs context window and credit and returns nothing new. Also part of tool fit: a task that does not match this tool''s role should be handed over or split, not forced through.',
    'ai_prompt_engineering'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Do not re-read a large file already read in this session and unchanged since. Establish change first (git diff --name-only, git log -- <file>) or ask a targeted question (grep, Read with offset/limit). Full reread only on: new thread/context switch, missing context, detected change, doubt about currency of a rule. Enforcement: .claude/hooks/aisha-advise-context-reuse.sh (PreToolUse Read) fires when the same path is re-read with an unchanged mtime+size and the read is not already targeted; routerCoach in .aisha/dirigent.json tracks the resulting session cost.',
    ARRAY['agent-operations','governance','context-window','cost','tool-fit','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 3. Scope adjacency: consent never follows from a neighbouring task.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-scope-adjacency',
    'Adjacency is not consent',
    'A high-blast-radius action requires its own explicit approval — it can never be inferred from an adjacent or generally-worded task.',
    E'# Adjacency is not consent\n\nAn ambiguous natural-language instruction gets expanded into its widest reading. For a high-blast target that reading reaches users before a reviewer does.\n\n**Consent NEVER follows from context for:**\n\n- navigation / routing visible to users,\n- destructive DML or migrations over live data,\n- visibility changes (public/hidden, publish, feature flag),\n- rotating or changing secrets,\n- deploy / redeploy / service restart,\n- anything an end user sees before a reviewer does.\n\nCreating an entity, a mutation, or the existence of a URL does **not** by itself imply consent to expose or wire it up.\n\n**If the action seems correct and follows logically:** raise it as a SEPARATE proposal and stop for explicit confirmation. Never perform it as part of another approved change.',
    'project_management'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Never infer approval for a high-blast-radius action (navigation/routing, DML over live data, visibility/feature flags, secrets, deploy) from an adjacent or generally-worded task. Raise it as a separate proposal and stop for explicit confirmation. Enforcement: .claude/hooks/aisha-advise-scope-adjacency.sh (PreToolUse Edit|Write|MultiEdit) detects these targets by path and by DML content in migrations and warns that consent must be asked for separately, not derived.',
    ARRAY['agent-operations','governance','scope','approval','blast-radius','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 4. Bounded self-correction: the fix loop has a hard ceiling.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-bounded-self-correction',
    'Bounded self-correction loop',
    'Audit your own output and correct it — but inside a loop with a hard ceiling: max 3 passes, and an identical repeated error stops immediately.',
    E'# Bounded self-correction loop\n\nAfter producing output with verifiable criteria, audit it and correct — inside a bounded loop.\n\n```text\n1. Produce / modify output.\n2. Audit. State the result: AUDIT PASSED / AUDIT FAILED.\n3. PASSED → continue.\n4. FAILED → root-cause analysis → fix (inside scope only) → re-audit.\n```\n\n**Brakes — any one stops the loop immediately:**\n\n- **Attempt ceiling:** max 3 audit passes (= 2 correction attempts).\n- **Repeated-error stop:** if an IDENTICAL error recurs after a fix, stop at once. Do not spend the remaining attempts — an identical error means the causal model is wrong, and another attempt will not fix it, only cost more.\n- **Scope stop:** if the cause lies outside the approved scope, stop and report the blocker. Never fix silently across a scope boundary.\n\n**On a brake:** do NOT commit, do NOT deploy. Report the last failure, the root-cause analysis, and what you tried. The decision returns to a human.',
    'ai_prompt_engineering'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: The fix→re-verify loop is bounded: max 3 audit passes (2 correction attempts); an IDENTICAL repeated error stops immediately without spending remaining attempts; a cause outside the approved scope stops and reports a blocker. On any brake do not commit and do not deploy — report the last failure, the cause analysis and what was tried. Enforcement: .claude/hooks/aisha-advise-retry-loop.sh (PreToolUse Bash) hashes each non-read-only command per session and fires from the 3rd verbatim re-run, the observable signature of an unbounded loop.',
    ARRAY['agent-operations','governance','self-correction','retry','autonomy','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 5. Mandatory lens: cross-cutting duties fire unasked.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-mandatory-lens',
    'Mandatory cross-cutting lens',
    'A cross-cutting obligation fires even when the assignment never mentioned it — it must not be silently skipped.',
    E'# Mandatory cross-cutting lens\n\nAn agent optimises for the literal wording of the assignment. Whatever the assignment did not name drops out silently — and the missing translation or validation surfaces in production.\n\n**Mandatory lenses on this platform:**\n\n| Lens | Fires when | Reference |\n|---|---|---|\n| i18n | the task creates or changes user-visible text | i18n standards — all UI text via `t("key")` |\n| Currency / locale | the task touches an amount, format or language | dynamic config, never a hardcoded literal |\n| Security | the task touches input, authorization, logs, secrets | security standards |\n| Tests | the task adds a function, endpoint or hook | testing philosophy |\n\n**Required lens output:**\n\n```text\n<Lens> Gate: APPLIED / NOT APPLICABLE / BLOCKED\nAffected scope:\nCreated / updated / verified:\nOpen issues, or why it could not be safely completed:\n```\n\n`NOT APPLICABLE` only when the task demonstrably does not touch that area.\n\n**A lens does NOT widen the write scope of the task.** Without approved scope for that area, audit and report the state — do not silently write outside scope.',
    'coding_standard'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Cross-cutting obligations (i18n, currency/locale, security, tests) apply even when the assignment did not mention them; never silently skip one. Report each as APPLIED / NOT APPLICABLE / BLOCKED — NOT APPLICABLE only when the task demonstrably does not touch that area. A lens never widens the task write scope: without approved scope, audit and report rather than write. Enforcement: .claude/hooks/aisha-advise-i18n.sh (PreToolUse Edit|Write|MultiEdit) flags hardcoded user-visible text unasked; the gate suite in src/tests/gates/ enforces the same duties statically at CI time.',
    ARRAY['agent-operations','governance','i18n','security','cross-cutting','lens','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 6. Closure backlog brake: never walk away from a large unresolved backlog.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-closure-backlog-brake',
    'Post-task closure gate and backlog brake',
    'No task is done until the repository is settled — and once the backlog outgrows the task, STOP rather than bulk-commit blindly.',
    E'# Post-task closure gate and backlog brake\n\n**No task is done until the repository is settled.**\n\n```text\n1. Working tree is clean, OR every remaining file is explicitly classified:\n   commit / ignore / move / keep-with-stated-reason.\n   No anonymous unresolved pile is left behind.\n2. State versus remote (ahead / behind / in-sync) is determined and stated.\n3. No interrupted merge, rebase or conflict.\n```\n\n**Backlog brake:**\n\n```text\nIf the count of unresolved changes (uncommitted + untracked + unpushed) outgrows\nthe expected scope of the task — roughly past ~20 files, or containing files\nUNRELATED to the assignment — STOP and report before doing anything else.\n\nNo blind bulk commit. No push. The ~20 threshold is a catch, not dogma: the point\nis that a large backlog never slips past without a human decision.\n```\n\n**Required output:**\n\n```text\nClosure Gate: CLEAN / RESOLVED / STOP\nWorking tree:\nAhead/behind remote:\nRemaining files and their classification:\nRecommended action (push / pull / none):\nIf STOP: reason and what awaits a decision.\n```\n\n**Why:** a real failure mode — execution tools walking away from a task leaving hundreds of files in commit/push/pull limbo. The cleanup is manual and expensive.',
    'devops_pipeline'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: A task is not done until the working tree is clean or every remaining file is explicitly classified (commit/ignore/move/keep-with-reason), the ahead/behind state is stated, and no merge/rebase is interrupted. Backlog brake: once unresolved changes outgrow the task scope (~20 files, or files unrelated to the assignment) STOP and report — never a blind bulk commit, never a push. Enforcement: .claude/hooks/aisha-advise-closure-backlog.sh (Stop) counts uncommitted+untracked+unpushed and raises a STOP advisory past the threshold.',
    ARRAY['agent-operations','governance','closure','git','backlog','exit-gate','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 7. Impact consistency: new knowledge has exactly one relation to old.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-impact-consistency',
    'Impact consistency: supersedes, scoped, or conflict',
    'New information stands in exactly one of three relations to what exists — and a conflict must never be filed as done.',
    E'# Impact consistency: supersedes, scoped, or conflict\n\n## New information is not a new file\n\nBefore creating a new document:\n\n```text\n1. Search for an existing document on the same topic / area / problem.\n2. If a living document, registry or policy exists for it → add there, timestamped.\n3. Only if none exists → propose a new file and justify it.\n```\n\nA new file is NOT justified merely because another note appeared on the same topic, the existing file is long, or writing it aside is more convenient.\n\n**No duplicate transcription:** the same finding is not copied in full into several files. Detail lives in one place; the rest reference it.\n\n## The three-way verdict\n\n```text\nSupersedes         → rewrite the older / mark it historical / link forward.\nScoped coexistence → both hold, in different scopes; state explicitly which applies when.\nConflict           → contradiction with no clear precedence → do NOT close as done;\n                     return to decision mode.\n```\n\n## Living document vs snapshot vs baseline\n\n```text\nliving document = continuously updated source of truth → edited in place\nsnapshot        = closed evidence of a state on a date → NEVER rewritten retroactively\nbaseline        = prior state kept for later comparison → NEVER rewritten retroactively\n```\n\nA baseline is never edited to pretend the past state was different. Platform analogue: a generated artifact is fixed at its source and regenerated, never in place — the DB baseline is generated from `aisha/db/sql/` and is never edited directly.\n\n**Why:** without the verdict two truths coexist and nobody knows which holds. A contradiction filed as "done" is worse than one admitted.',
    'documentation_standard'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Before creating a new document, check for an existing living document on the same topic and add there instead; never copy the same finding verbatim into several files. Then state the impact verdict — exactly one of Supersedes (rewrite/mark the older), Scoped coexistence (state which applies when), or Conflict (do NOT close as done; return to decision mode). Snapshots and baselines are never rewritten retroactively; generated artifacts are fixed at source and regenerated. Enforcement: .claude/hooks/aisha-advise-impact-consistency.sh (PreToolUse Write) fires when a new .md is created beside topically-near siblings; .claude/hooks/block-baseline-edit.sh hard-blocks direct edits to the generated DB baseline.',
    ARRAY['agent-operations','governance','documentation','knowledge','baseline','source-of-truth','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 8. UNCLEAR is a first-class state: never guess, escalate.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-unclear-escalation',
    'UNCLEAR is a first-class state',
    'A decision gate returns three states, not two — an agent that cannot decide escalates instead of guessing.',
    E'# UNCLEAR is a first-class state\n\n```text\nNO      – does not apply; continue.\nYES     – applies; run its procedure.\nUNCLEAR – I cannot decide → ESCALATE to a human.\n```\n\nNeither `YES` nor `UNCLEAR` may remain a standalone note without action. One of these must follow: a concrete step, a prompt for the next tool, a plan, or an EXPLICIT blocker with a reason. If the action is deferred, say why.\n\n**Also:** deliver a final output, not a draft with a promise to polish later. If two variants are genuinely equivalent, or the choice depends on a decision outside your remit, state the difference and request the decision. **Uncertainty must not be masked by stylistic confidence.**\n\n**Why:** a two-state gate forces the agent to guess when it does not know — and it guesses toward "continue". UNCLEAR gives permission to admit uncertainty rather than hide it.',
    'ai_prompt_engineering'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Decision gates return three states: NO (continue), YES (run the procedure), UNCLEAR (cannot decide → escalate to a human). Never guess toward "continue". YES and UNCLEAR must be followed by a concrete step, a plan, or an explicit blocker with a reason — never left as a standalone note. Deliver a final output, not a draft with a promise; never mask uncertainty with stylistic confidence. Enforcement: .claude/hooks/aisha-advise-open-state.sh (Stop) fires at closure when work was done, requiring disclosure of what is verified, what is open, and what could not be decided.',
    ARRAY['agent-operations','governance','escalation','uncertainty','autonomy','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 9. Stop ends actions, not the duty to disclose.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-stop-is-not-closure',
    'Stop ends actions, not disclosure',
    'An instruction to stop ends operations — it does not end the duty to disclose that something remains open.',
    E'# Stop ends actions, not disclosure\n\nWhen "do nothing" / "stop" / "leave it" is given, it ends ACTIONS. It does **not** mean:\n\n```text\n- cancelling the duty to state that an open point remains,\n- pretending a conclusion is closed when nothing was decided,\n- replacing a required check with a general summary.\n```\n\n**Why:** the most dangerous state is an open problem everyone believes is closed. Silence after "stop" reads as "done".\n\nAt closure, say plainly:\n\n```text\n- what is verified (and by what evidence — not "it should work"),\n- what remains open,\n- what you could not decide, and who decides it.\n```',
    'project_management'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: An instruction to stop ends actions, not the duty to disclose open state. Never present an undecided conclusion as closed, and never replace a required check with a general summary because writing it up is inconvenient. At closure state what is verified (with evidence, not "it should work"), what remains open, and what could not be decided and by whom. Enforcement: .claude/hooks/aisha-advise-open-state.sh (Stop) fires when the tree is dirty at closure and requires the disclosure triple.',
    ARRAY['agent-operations','governance','closure','disclosure','honesty','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

  -- 10. No placeholders in runnable commands.
  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category,
    author_partner_id, visibility,
    ai_instructions, ai_context_tags, status, is_verified, version, published_at
  ) VALUES (
    'agent-ops-no-placeholder-commands',
    'No placeholders in runnable commands',
    'A command is either directly runnable or it is not phrased as a command — a placeholder run verbatim either fails or hits the wrong target.',
    E'# No placeholders in runnable commands\n\n```bash\n# FORBIDDEN — it gets run verbatim, or it wastes the reader''s time\npsql -h <DB_HOST> -U <USER> -d <DB>\ncurl -H "Authorization: Bearer YOUR_API_KEY" https://api.example.com\n\n# CORRECT — determine the real value first, or do not phrase it as a command\n```\n\nIf the value is unknown:\n\n```text\n- verify it first (grep the config, `git config`, query the API),\n- or request it,\n- a command handed over is either directly runnable,\n- or it is not phrased as a command.\n```\n\nIf you need to show the shape of a command, label it as an example, not as a step to execute.\n\n**Why:** a placeholder executed literally either fails outright or — worse — hits the wrong target.',
    'coding_standard'::expert_rule_category,
    v_partner_id, 'public',
    E'RULE: Never hand over a runnable command containing placeholder tokens (<DB_HOST>, {{TOKEN}}, YOUR_API_KEY, <your-token>). If a value is unknown, verify it first or request it; a command is either directly runnable or is not phrased as a command. Show shapes only when explicitly labelled as an example. Enforcement: .claude/hooks/aisha-advise-placeholder-cmd.sh (PreToolUse Bash) detects angle, template, sample-value and doc-style placeholders in the command before it runs.',
    ARRAY['agent-operations','governance','commands','handover','fail-loud','source_type:internal','data_sensitivity:public','retention_class:long_term','legal_basis:legitimate_interest'],
    'published', true, 1, now()
  ) ON CONFLICT (slug) DO UPDATE SET
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    body_markdown = EXCLUDED.body_markdown,
    status = 'published',
    updated_at = now();

END $$;
