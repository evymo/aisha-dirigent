import { describe, expect, it } from 'vitest';
import { isPgReachable } from './test-env-probe';
import { jako, prihlaseny, BEZ_SUB, ANON } from './sonda-identity';
import { learningFixture } from './self-learning-fixture';
const reachable = isPgReachable();
const skip = !reachable && !process.env.AISHA_DB_URL;
const f = learningFixture();
const call = (type = 'case_study', tags = "'{}'") => `public.add_story_knowledge_audited('${f.story}','Lesson','Learned','${type}',NULL,${tags})`;

describe.skipIf(skip)('MCP knowledge writes require access and human review', () => {
  it('the owner writes private flagged documentation; a clean scanner cannot clear it', () => {
    const out = jako(prihlaseny(f.owner), `
      SELECT ${call()} AS item_id \\gset
      RESET ROLE;
      SELECT visibility || ':' || quarantine_status || ':' || (quarantine_metadata->>'ceka_na_cloveka') FROM knowledge_items WHERE id=:'item_id';
      SET LOCAL ROLE service_role;
      SELECT public.fn_record_safety_scan_audited(:'item_id','{}','clean',0,'clear');
      RESET ROLE;
      SELECT quarantine_status FROM knowledge_items WHERE id=:'item_id';
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.admin}"}',true);
      SELECT public.fn_reinstate_knowledge_item_audited(:'item_id','human checked');
      RESET ROLE;
      SELECT quarantine_status FROM knowledge_items WHERE id=:'item_id'
    `, { pred: f.sql, rollback: true });
    expect(out).toContain('private:flagged:true');
    expect(out.split('\n')).toContain('flagged');
    expect(out.split('\n')).toContain('reinstated');
  });
  it.each([['viewer', f.viewer], ['stranger', f.stranger]])('%s cannot add documentation', (_, user) => {
    expect(() => jako(prihlaseny(user), `SELECT ${call()}`, { pred: f.sql, rollback: true })).toThrow(/Unauthorized/);
  });
  it.each([BEZ_SUB, ANON])('a missing subject or anonymous caller cannot write', identity => {
    expect(() => jako(identity, `SELECT ${call()}`, { pred: f.sql, rollback: true })).toThrow(/Not authenticated|permission denied/);
  });
  it.each([['expert_rule', "'{}'"], ['case_study', "ARRAY[repeat('x',101)]"], ['case_study', 'ARRAY[NULL]::text[]']])('rejects privileged types or invalid tags', (type, tags) => {
    expect(() => jako(prihlaseny(f.owner), `SELECT ${call(type, tags)}`, { pred: f.sql, rollback: true })).toThrow(/item_type|context tags/);
  });
});
