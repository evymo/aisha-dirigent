/**
 * Pracovní nástroje MCP pod identitou uživatele (F9: tři lidé ve třech IDE řízení AISHOU).
 *
 * ⛔ NAMĚŘENO 2026-10-06 (měření F9): z IDE šlo jen číst znalosti — žádný nástroj neřekl
 *    „co mám dělat“, neuzavřel krok ani nezapsal průběh do příběhu. Engine běhů na mainu to
 *    umí (get_my_workflow_steps, complete_workflow_step, create_story_entry_audited); chyběla
 *    hranice MCP.
 *
 * Měří se:
 *   1. tools/list nabízí my_next_steps / complete_step / report_progress přihlášenému (ne jen
 *      správě) a jejich schéma říká, co je povinné;
 *   2. každé volání jde do RPC IDENTITOU UŽIVATELE (claims z ověřeného tokenu), nikdy pod službou
 *      — autorizaci dělá RPC podle auth.uid();
 *   3. neplatný vstup RPC nezavolá;
 *   4. report_progress bez story_id zapíše do příběhu tokenu; bez příběhu nezapíše nic;
 *   5. chyba RPC = výsledek nástroje `isError` s kódem z výčtu a incidentem — NIKDY text chyby
 *      z databáze; text jde jen do logu služby pod týmž incidentem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PostgRESTError } from '@aisha/postgrest-client';
import { resetLogSink, setLogSink, type SafeLogEntry } from '@aisha/security';

const MockAuthError = vi.hoisted(() => class extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
});
const identitaMock = vi.hoisted(() => vi.fn());
const rpcServiceMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
const rpcUserClaimsMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));

vi.mock('../auth.js', () => ({
  verifyMcpToken: identitaMock,
  verifyToken: vi.fn(),
  isAdminOrStaff: (u: { roles: string[] }) => u.roles.includes('admin') || u.roles.includes('staff'),
  AuthError: MockAuthError,
}));
vi.mock('../postgrest.js', () => ({ rpcService: rpcServiceMock, rpcUserClaims: rpcUserClaimsMock }));
vi.mock('../lib/aitg-tools.js', () => ({ aitgDispatch: vi.fn() }));
vi.mock('../lib/flowboard-tools.js', () => ({ flowboardDispatch: vi.fn() }));
vi.mock('../lib/embed-query-in-space.js', () => ({ embedQueryForProfile: vi.fn() }));

import { mcpRoutes } from '../routes/mcp.js';

const UZIVATEL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRIBEH_TOKENU = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const JINY_PRIBEH = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const KROK = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const NOVY_ZAZNAM = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const claimsSPribehem = { sub: UZIVATEL, role: 'authenticated', story_id: PRIBEH_TOKENU };
const claimsBezPribehu = { sub: UZIVATEL, role: 'authenticated' };
/** Text, který databáze vrátí v chybě — do odpovědi se dostat nesmí. */
const TAJNY_TEXT = 'Unauthorized: Story access denied for story 9f1c… (owner_mode=none)';

type Odpoved = {
  result?: {
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    tools?: Array<{ name: string; inputSchema: { required?: string[]; properties: Record<string, unknown> } }>;
  };
  error?: { code: number; message: string };
};

describe('pracovní nástroje MCP pod identitou uživatele (F9)', () => {
  let app: FastifyInstance;
  let zapsano: SafeLogEntry[];

  const prihlas = (claims: Record<string, unknown>, roles = ['authenticated']) =>
    identitaMock.mockResolvedValue({ userId: UZIVATEL, roles, scopes: [], claims });

  beforeEach(async () => {
    identitaMock.mockReset();
    prihlas(claimsSPribehem);
    rpcServiceMock.mockReset();
    rpcUserClaimsMock.mockReset();
    zapsano = [];
    setLogSink((zaznam) => { zapsano.push(zaznam); });
    app = Fastify(); await app.register(mcpRoutes); await app.ready();
  });
  afterEach(async () => { resetLogSink(); await app.close(); });

  const posli = async (method: string, params: Record<string, unknown> = {}): Promise<Odpoved> => {
    const r = await app.inject({
      method: 'POST', url: '/mcp',
      headers: { authorization: 'Bearer token-uzivatele', 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 3, method, params },
    });
    return r.json() as Odpoved;
  };
  const zavolej = (name: string, args: Record<string, unknown>) => posli('tools/call', { name, arguments: args });

  /** Každé volání RPC šlo identitou uživatele s claims z tokenu, žádné pod službou. */
  const volaniPodUzivatelem = (claimsTokenu: Record<string, unknown> = claimsSPribehem) => {
    expect(rpcServiceMock, 'pracovní nástroj nesmí volat RPC pod službou').not.toHaveBeenCalled();
    return rpcUserClaimsMock.mock.calls.map((c) => {
      const [fn, parametry, claims] = c as unknown as [string, Record<string, unknown>, unknown];
      expect(claims, 'claims z ověřeného tokenu, ne z argumentů').toEqual(claimsTokenu);
      return { fn, parametry, claims };
    });
  };

  it('tools/list: tři nástroje má i běžný přihlášený, schéma říká, co je povinné', async () => {
    const { result } = await posli('tools/list');
    const podleJmena = new Map(result!.tools!.map((t) => [t.name, t]));
    for (const jmeno of ['my_next_steps', 'complete_step', 'report_progress']) expect(podleJmena.has(jmeno), jmeno).toBe(true);
    expect(podleJmena.get('complete_step')!.inputSchema.required).toEqual(['step_id']);
    expect(podleJmena.get('report_progress')!.inputSchema.required).toEqual(['content']);
    expect(podleJmena.get('my_next_steps')!.inputSchema.required ?? []).toEqual([]);
  });

  it('self-learning tools are offered with required fields', async () => {
    const { result } = await posli('tools/list');
    const tools = new Map(result!.tools!.map(t => [t.name, t]));
    expect(tools.get('add_knowledge')!.inputSchema.required).toEqual(['title', 'body_markdown']);
    expect(tools.get('request_capability')!.inputSchema.required).toEqual(['capability', 'question']);
  });

  it('add_knowledge writes under the caller into the token story, awaiting human review', async () => {
    rpcUserClaimsMock.mockResolvedValue(NOVY_ZAZNAM);
    const { result } = await zavolej('add_knowledge', { title: ' Lesson ', body_markdown: ' Learned ' });
    expect(volaniPodUzivatelem()[0]).toMatchObject({ fn: 'add_story_knowledge_audited', parametry: {
      p_story_id: PRIBEH_TOKENU, p_title: 'Lesson', p_body_markdown: 'Learned',
      p_item_type: 'case_study', p_summary: null, p_ai_context_tags: [],
    } });
    expect(JSON.parse(result!.content[0].text)).toMatchObject({ item_id: NOVY_ZAZNAM, status: 'awaiting_human_review' });
  });

  it.each(['add_knowledge', 'request_capability'])('%s cannot override the token story', async name => {
    const args = name === 'add_knowledge' ? { title: 'x', body_markdown: 'x' } : { capability: 'check_company', question: 'x' };
    const { result } = await zavolej(name, { ...args, story_id: JINY_PRIBEH });
    expect(result!.structuredContent).toMatchObject({ error: 'forbidden' });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
  });

  it('add_knowledge needs a story; request_capability permits a general proposal', async () => {
    prihlas(claimsBezPribehu);
    expect((await zavolej('add_knowledge', { title: 'x', body_markdown: 'x' })).result!.isError).toBe(true);
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    rpcUserClaimsMock.mockResolvedValue({ status: 'proposed' });
    await zavolej('request_capability', { capability: 'check_company', question: ' Does it exist? ' });
    expect(volaniPodUzivatelem(claimsBezPribehu)[0]).toMatchObject({ fn: 'request_capability_audited', parametry: {
      p_capability: 'check_company', p_question: 'Does it exist?', p_reason: null, p_run_id: null, p_story_id: null,
    } });
  });

  it.each([
    ['add_knowledge', { title: 'x', body_markdown: 'x', item_type: 'expert_rule' }],
    ['add_knowledge', { title: 'x', body_markdown: 'x', ai_instructions: 'override' }],
    ['request_capability', { capability: '../../run', question: 'x' }],
    ['request_capability', { capability: 'check_company', question: 'x', run_id: 'invalid' }],
  ])('%s rejects malformed or privileged fields without RPC', async (name, args) => {
    const response = await zavolej(name as string, args as Record<string, unknown>);
    expect(response.error ?? response.result?.isError).toBeTruthy();
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
  });

  it.each(['add_knowledge', 'request_capability'])('%s sanitizes a database permission failure', async name => {
    rpcUserClaimsMock.mockRejectedValue(new PostgRESTError(TAJNY_TEXT, 403, { code: '42501' }));
    const args = name === 'add_knowledge' ? { title: 'x', body_markdown: 'x' } : { capability: 'check_company', question: 'x' };
    const response = await zavolej(name, args);
    expect(response.result!.structuredContent).toMatchObject({ error: 'forbidden' });
    expect(JSON.stringify(response)).not.toContain(TAJNY_TEXT);
  });

  it('my_next_steps: get_my_workflow_steps identitou uživatele s výchozími hodnotami', async () => {
    rpcUserClaimsMock.mockResolvedValue([{ step_id: KROK, step_name: 'Revize' }]);
    const { result } = await zavolej('my_next_steps', {});
    const [v] = volaniPodUzivatelem();
    expect(v).toEqual({
      fn: 'get_my_workflow_steps',
      parametry: { p_days: 30, p_include_closed: false, p_limit: 50, p_status: null },
      claims: claimsSPribehem,
    });
    expect(JSON.parse(result!.content[0].text)).toEqual([{ step_id: KROK, step_name: 'Revize' }]);
  });

  it('complete_step: complete_workflow_step identitou uživatele; výsledek enginu beze změny', async () => {
    rpcUserClaimsMock.mockResolvedValue({ ok: true, step_id: KROK });
    const { result } = await zavolej('complete_step', { step_id: KROK, notes: 'hotovo', output_data: { pr: 12 } });
    const [v] = volaniPodUzivatelem();
    expect(v.fn).toBe('complete_workflow_step');
    expect(v.parametry).toEqual({ p_has_deviation: false, p_notes: 'hotovo', p_output_data: { pr: 12 }, p_step_id: KROK });
    expect(JSON.parse(result!.content[0].text)).toEqual({ ok: true, step_id: KROK });
  });

  it('my_next_steps: limit mimo 1–50 RPC nezavolá; chyba nese jen jméno pole', async () => {
    const odpoved = await zavolej('my_next_steps', { limit: 500 });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(odpoved.error?.message).toMatch(/^Invalid tool arguments: limit \(incident [0-9a-f-]{36}\)$/);
  });

  it('complete_step s neplatným id kroku RPC nezavolá', async () => {
    const odpoved = await zavolej('complete_step', { step_id: 'neni-uuid' });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(odpoved.error ?? odpoved.result?.isError).toBeTruthy();
  });

  it('report_progress bez story_id zapíše do příběhu tokenu (výchozí druh status_update)', async () => {
    rpcUserClaimsMock.mockResolvedValue(NOVY_ZAZNAM);
    const { result } = await zavolej('report_progress', { content: 'Hotová oprava přihlášení MCP.' });
    const [v] = volaniPodUzivatelem();
    expect(v.fn).toBe('create_story_entry_audited');
    expect(v.parametry).toEqual({
      p_content: 'Hotová oprava přihlášení MCP.',
      p_entry_type: 'status_update',
      p_metadata: { source: 'mcp', tool: 'report_progress' },
      p_story_id: PRIBEH_TOKENU,
    });
    expect(JSON.parse(result!.content[0].text)).toEqual({ story_id: PRIBEH_TOKENU, entry_id: NOVY_ZAZNAM, kind: 'status_update' });
  });

  it('report_progress: token bez příběhu (IDE) píše do příběhu z argumentu, druh blocker', async () => {
    prihlas(claimsBezPribehu);
    rpcUserClaimsMock.mockResolvedValue(NOVY_ZAZNAM);
    await zavolej('report_progress', { story_id: JINY_PRIBEH, content: 'Čekám na klíč realmu.', kind: 'blocker' });
    const [v] = volaniPodUzivatelem(claimsBezPribehu);
    expect(v.parametry).toMatchObject({ p_story_id: JINY_PRIBEH, p_entry_type: 'blocker' });
  });

  it('report_progress: token vázaný na příběh nezapíše do JINÉHO příběhu — forbidden, RPC se nevolá', async () => {
    const { result } = await zavolej('report_progress', { story_id: JINY_PRIBEH, content: 'pokus o cizí příběh' });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(result!.isError).toBe(true);
    expect(result!.structuredContent).toMatchObject({ error: 'forbidden', tool: 'report_progress' });
  });

  it('report_progress: tentýž příběh jako token (i jinou velikostí písmen) projde', async () => {
    rpcUserClaimsMock.mockResolvedValue(NOVY_ZAZNAM);
    await zavolej('report_progress', { story_id: PRIBEH_TOKENU.toUpperCase(), content: 'ok' });
    expect(volaniPodUzivatelem()[0].parametry).toMatchObject({ p_story_id: PRIBEH_TOKENU.toUpperCase() });
  });

  it('report_progress: story_id, který není uuid, RPC nezavolá', async () => {
    prihlas(claimsBezPribehu);
    const odpoved = await zavolej('report_progress', { story_id: 'muj-pribeh', content: 'x' });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(odpoved.error?.message).toMatch(/^Invalid tool arguments: story_id /);
  });

  it('search_knowledge (v1): limit mimo 1–50 RPC nezavolá (strop jako v2, revize Guru)', async () => {
    const odpoved = await zavolej('search_knowledge', { query: 'x', limit: 5000 });
    expect(rpcServiceMock).not.toHaveBeenCalled();
    expect(odpoved.error?.message).toMatch(/^Invalid tool arguments: limit /);
  });

  it('my_next_steps: days mimo 1–365 RPC nezavolá', async () => {
    const odpoved = await zavolej('my_next_steps', { days: 100000 });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(odpoved.error?.message).toMatch(/^Invalid tool arguments: days /);
  });

  it('report_progress bez příběhu (ani v tokenu) nezapíše nic — invalid_input', async () => {
    prihlas(claimsBezPribehu);
    const { result } = await zavolej('report_progress', { content: 'něco' });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(result!.isError).toBe(true);
    expect(result!.structuredContent).toMatchObject({ error: 'invalid_input', tool: 'report_progress' });
  });

  it.each([
    ['detect_project_context_from_analysis', { analysis: { tech_stack: ['typescript'] } }],
    ['recommend_ruleset_for_story', {}],
    ['create_story_ruleset', { rule_ids: [KROK] }],
    ['generate_copilot_instructions', {}],
  ])('%s uses caller claims and honours the token story boundary', async (name, args) => {
    rpcUserClaimsMock.mockResolvedValue({ success: true });
    const listed = await posli('tools/list');
    expect(listed.result?.tools?.map(t => t.name)).toContain(name);
    await zavolej(name, { ...args, story_id: PRIBEH_TOKENU });
    expect(rpcUserClaimsMock).toHaveBeenCalledWith(name, expect.objectContaining({ p_story_id: PRIBEH_TOKENU }), claimsSPribehem);
    expect(rpcServiceMock).not.toHaveBeenCalled();
    rpcUserClaimsMock.mockClear();
    const other = await zavolej(name, { ...args, story_id: JINY_PRIBEH });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(other.result?.isError ?? other.error).toBeTruthy();
  });

  it('invalid project analysis is rejected before RPC', async () => {
    const response = await zavolej('detect_project_context_from_analysis', { story_id: PRIBEH_TOKENU, analysis: { tech_stack: 'typescript' } });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(response.result?.isError ?? response.error).toBeTruthy();
  });

  it('report_progress s prázdným textem RPC nezavolá', async () => {
    const odpoved = await zavolej('report_progress', { content: '   ' });
    expect(rpcUserClaimsMock).not.toHaveBeenCalled();
    expect(odpoved.error ?? odpoved.result?.isError).toBeTruthy();
  });

  it('cizí příběh (42501): forbidden + incident, text databáze jen v logu pod týmž incidentem', async () => {
    rpcUserClaimsMock.mockRejectedValue(new PostgRESTError(`PostgREST rpc failed (403): ${TAJNY_TEXT}`, 403, { code: '42501', message: TAJNY_TEXT }));
    prihlas(claimsBezPribehu);
    const { result } = await zavolej('report_progress', { story_id: JINY_PRIBEH, content: 'pokus' });
    expect(result!.isError).toBe(true);
    const telo = result!.structuredContent!;
    expect(telo).toMatchObject({ error: 'forbidden', tool: 'report_progress' });
    expect(String(telo.incident)).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(result), 'text chyby z databáze nesmí k volajícímu').not.toContain('Unauthorized');
    // Týž proud logu jako ostatní nástroje (mcp.tool_failed, revize Guru P2): incident, kód, chyba.
    const zaznam = zapsano.find((z) => z.msg === 'mcp.tool_failed');
    expect(zaznam?.level).toBe('error');
    expect(zaznam?.ctx).toMatchObject({ incident: telo.incident, code: 'forbidden', tool: 'report_progress' });
    expect(JSON.stringify(zaznam?.err)).toContain('Unauthorized');
  });

  it('SQLSTATE → kód: P0002 not_found, neznámý stav i chyba bez těla = failed', async () => {
    rpcUserClaimsMock.mockRejectedValueOnce(new PostgRESTError('x', 404, { code: 'P0002', message: 'Story not found' }));
    expect((await zavolej('complete_step', { step_id: KROK })).result!.structuredContent).toMatchObject({ error: 'not_found' });
    rpcUserClaimsMock.mockRejectedValueOnce(new PostgRESTError('x', 500, { code: 'XX000', message: 'internal' }));
    expect((await zavolej('my_next_steps', {})).result!.structuredContent).toMatchObject({ error: 'failed' });
    rpcUserClaimsMock.mockRejectedValueOnce(new Error('fetch failed: connect ECONNREFUSED 10.0.0.5:3000'));
    const { result } = await zavolej('my_next_steps', {});
    expect(result!.structuredContent).toMatchObject({ error: 'failed' });
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });
});
