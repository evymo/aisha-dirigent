import { describe, expect, it } from 'vitest';
import { isPgReachable } from './test-env-probe';
import { jako, prihlaseny, BEZ_SUB } from './sonda-identity';
import { learningFixture } from './self-learning-fixture';
const skip = !isPgReachable() && !process.env.AISHA_DB_URL;
const f = learningFixture();
const request = (slug: string, story = 'NULL') => `public.request_capability_audited('${slug}','Question',NULL,NULL,${story})`;

describe.skipIf(skip)('capability proposal, human approval and replay', () => {
  it('creates pending high-risk proposals, deduplicates, enforces per-user quota', () => {
    const out = jako(prihlaseny(f.owner), `
      SELECT ${request(f.prefix)}->>'status';
      SELECT ${request(f.prefix)}->>'status';
      SELECT ${request(f.prefix + '_two')}->>'status';
      SELECT ${request(f.prefix + '_three')}->>'status';
      SELECT ${request(f.prefix + '_four')}->>'status';
      SELECT ${request(f.prefix + '_five')}->>'status';
      SELECT ${request(f.prefix + '_six')}->>'status';
      RESET ROLE;
      SELECT status || ':' || risk_level FROM improvement_proposals WHERE anomaly_key='capability:${f.prefix}'
    `, { pred: f.sql, rollback: true });
    expect(out.split('\n')).toEqual(['proposed', 'already_requested', 'proposed', 'proposed', 'proposed', 'proposed', 'rate_limited', 'pending_review:high']);
  });
  it('a duplicate from another caller does not expose its proposal id', () => {
    const out = jako(prihlaseny(f.owner), `
      SELECT ${request(f.prefix)};
      SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.stranger}"}',true);
      SELECT ${request(f.prefix)}
    `, { pred: f.sql, rollback: true });
    const duplicate = JSON.parse(out.split('\n').at(-1)!);
    expect(duplicate).toEqual({ status: 'already_requested', capability: f.prefix });
  });
  it('denies missing subject, foreign story, viewer write and non-admin bridges', () => {
    expect(() => jako(BEZ_SUB, `SELECT ${request(f.prefix)}`, { pred: f.sql, rollback: true })).toThrow(/Not authenticated/);
    for (const user of [f.stranger, f.viewer]) expect(() => jako(prihlaseny(user), `SELECT ${request(f.prefix, "'" + f.story + "'")}`, { pred: f.sql, rollback: true })).toThrow(/story access denied/);
    for (const bridge of ['fn_spawn_capability_run_admin', 'fn_capability_replay_admin']) {
      expect(() => jako(prihlaseny(f.owner), `SELECT public.${bridge}('${f.story}')`, { pred: f.sql, rollback: true })).toThrow(/admin\/staff required/);
    }
  });
  it('even an allow admission creates a held run; requester and spawner cannot approve; replay waits for successful run and active tool', () => {
    // Admission is isolated in this transaction to exercise the otherwise-unreachable allow branch.
    const pred = f.sql + `
      INSERT INTO public.user_roles (user_id,role) VALUES ('${f.owner}','admin');
      CREATE OR REPLACE FUNCTION public.fn_admit_clow(p_clow jsonb, p_context jsonb DEFAULT '{}'::jsonb)
      RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"decision":"allow","reason_code":"test"}'::jsonb $$;
    `;
    const out = jako(prihlaseny(f.owner), `
      SELECT ${request(f.prefix)}->>'proposal_id' AS proposal \\gset
      RESET ROLE;
      UPDATE improvement_proposals SET status='approved' WHERE id=:'proposal';
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.admin}"}',true);
      SELECT public.fn_spawn_capability_run_admin(:'proposal')->>'agent_run_id' AS run \\gset
      RESET ROLE;
      SELECT approval_required AND approved_at IS NULL FROM agent_runs WHERE id=:'run';
      SET LOCAL ROLE authenticated;
      SELECT set_config('test.learning_run',:'run',true);
      SELECT set_config('test.learning_proposal',:'proposal',true);
      DO $$ BEGIN
        BEGIN PERFORM public.approve_claude_run(current_setting('test.learning_run')::uuid); RAISE EXCEPTION 'SELF APPROVAL PASSED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Segregation of duties:%' THEN RAISE; END IF; END;
      END $$;
      SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.owner}"}',true);
      DO $$ BEGIN
        BEGIN PERFORM public.approve_claude_run(current_setting('test.learning_run')::uuid); RAISE EXCEPTION 'REQUESTER APPROVAL PASSED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Segregation of duties:%' THEN RAISE; END IF; END;
      END $$;
      SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.approver}"}',true);
      SELECT public.approve_claude_run(:'run');
      DO $$ BEGIN
        BEGIN PERFORM public.fn_capability_replay_admin(current_setting('test.learning_proposal')::uuid); RAISE EXCEPTION 'PREMATURE REPLAY PASSED';
        EXCEPTION WHEN no_data_found THEN NULL; END;
      END $$;
      RESET ROLE;
      UPDATE agent_runs SET status='succeeded', exit_code=0 WHERE id=:'run';
      SET LOCAL ROLE authenticated;
      DO $$ BEGIN
        BEGIN PERFORM public.fn_capability_replay_admin(current_setting('test.learning_proposal')::uuid); RAISE EXCEPTION 'UNREGISTERED REPLAY PASSED';
        EXCEPTION WHEN no_data_found THEN NULL; END;
      END $$;
      RESET ROLE;
      INSERT INTO agent_tools (name,description,handler_type,handler_ref) VALUES ('${f.prefix}','Test tool','rpc','${f.prefix}');
      SET LOCAL ROLE authenticated;
      SELECT public.fn_capability_replay_admin(:'proposal')->>'question';
      RESET ROLE;
      SELECT status FROM improvement_proposals WHERE id=:'proposal'
    `, { pred: pred, rollback: true });
    expect(out.split('\n')).toContain('t');
    expect(out.split('\n')).toContain('Question');
    expect(out.split('\n')).toContain('applied');
  });
});
