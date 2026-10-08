import { describe, expect, it } from 'vitest';
import { isPgReachable } from './test-env-probe';
import { jako, prihlaseny, BEZ_SUB, ANON } from './sonda-identity';
import { learningFixture } from './self-learning-fixture';
import { randomUUID } from 'node:crypto';
const reachable = isPgReachable();
const skip = !reachable && !process.env.AISHA_DB_URL;
const f = learningFixture();
const create = `public.create_project_story_audited('New work project','Summary',ARRAY['Ship'],ARRAY['Keep data'])`;

describe.skipIf(skip)('Caller-owned work project onboarding', () => {
  it('an ordinary user creates a private project atomically and sees it through RLS', () => {
    const out = jako(prihlaseny(f.owner), `
      SELECT ${create} AS project_id \\gset
      SELECT origin || ':' || (user_id = auth.uid()) || ':' || (partner_id IS NULL AND study_id IS NULL) FROM partner_stories WHERE id=:'project_id';
      SELECT role FROM story_participants WHERE story_id=:'project_id' AND user_id=auth.uid();
      SELECT public.can_manage_project_story(:'project_id');
      SELECT project_preview->>'summary' FROM partner_stories WHERE id=:'project_id';
      RESET ROLE;
      SELECT count(*) FROM audit_journal WHERE user_id='${f.owner}' AND new_data->>'story_id'=:'project_id';
    `, { pred: f.sql, rollback: true });
    expect(out).toContain('project:true:true');
    expect(out.split('\n')).toContain('owner');
    expect(out.split('\n')).toContain('t');
    expect(out).toContain('Summary');
    expect(out.split('\n')).toContain('1');
  });

  it('a first-time Keycloak subject is provisioned through the existing JIT hook', () => {
    const newcomer = randomUUID();
    const out = jako(prihlaseny(newcomer), `SELECT ${create} AS project_id \\gset
      SELECT user_id = auth.uid() FROM partner_stories WHERE id=:'project_id';
      RESET ROLE; SELECT count(*) FROM aisha_auth.users WHERE id='${newcomer}';
    `, { rollback: true });
    expect(out.split('\n')).toEqual(['t', '1']);
  });

  it('ownership never permits management of an existing non-project story', () => {
    const out = jako(prihlaseny(f.owner), `SELECT public.can_manage_project_story('${f.story}')`, { pred: f.sql, rollback: true });
    expect(out).toBe('f');
  });

  it('another user cannot read or modify the created project', () => {
    const out = jako(prihlaseny(f.owner), `
      SELECT ${create} AS project_id \\gset
      SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.stranger}"}',true) \\gset
      SELECT count(*) FROM partner_stories WHERE id=:'project_id';
      SELECT public.can_manage_project_story(:'project_id');
    `, { pred: f.sql, rollback: true });
    expect(out.split('\n')).toEqual(['0', 'f']);
  });

  it.each([BEZ_SUB, ANON])('anonymous or subjectless callers cannot create a project', identity => {
    expect(() => jako(identity, `SELECT ${create}`, { pred: f.sql, rollback: true })).toThrow(/Not authenticated|permission denied/);
  });

  it.each(["''", "NULL", "repeat('x',201)"])('invalid title %s cannot create a project', title => {
    expect(() => jako(prihlaseny(f.owner), `SELECT public.create_project_story_audited(${title})`, { pred: f.sql, rollback: true })).toThrow(/Invalid project input/);
  });

  it('invalid array entries cannot create a project', () => {
    expect(() => jako(prihlaseny(f.owner), `SELECT public.create_project_story_audited('Title','',ARRAY[NULL]::text[])`, { pred: f.sql, rollback: true })).toThrow(/Invalid project input/);
  });

  it('the project owner can update context and preview and pin rules, strangers cannot', () => {
    const out = jako(prihlaseny(f.owner), `
      SELECT ${create} AS project_id \\gset
      SELECT public.detect_project_context_from_analysis(:'project_id','{"tech_stack":["typescript"],"domain":["software"]}')->>'success';
      SELECT public.recommend_ruleset_for_story(:'project_id')->>'success';
      SELECT public.update_story_project_preview(:'project_id','{"summary":"Updated","goals":[],"constraints":[],"success_criteria":[]}')->>'success';
      SELECT public.create_story_ruleset(:'project_id',ARRAY['${f.approver}']::uuid[])->>'ruleset_id' IS NOT NULL;
      SELECT public.generate_copilot_instructions(:'project_id') LIKE '%New work project%';
    `, { pred: `${f.sql}
      SELECT public.ensure_stack_default_story();
      INSERT INTO public.supported_languages (code,name_native) VALUES ('global','Global') ON CONFLICT (code) DO NOTHING;
      INSERT INTO public.expert_rules (id,slug,title,body_markdown,status,author_partner_id,ai_context_tags)
      VALUES ('${f.approver}','${f.prefix}_rule','Project rule','Keep contracts','published','${f.admin}',ARRAY['typescript']);
    `, rollback: true });
    expect(out.split('\n')).toEqual(['true','true','true','t','t']);
    expect(() => jako(prihlaseny(f.stranger), `SELECT public.detect_project_context_from_analysis('${f.story}','{"tech_stack":["typescript"]}')`, { pred: f.sql, rollback: true })).toThrow(/Unauthorized/);
  });
});
