/**
 * Výstup claude_cli_task přes broker-proxy — výčet jen z konfigurace (bez vestavěných
 * hostitelů dodavatele), jen https, a ochrana SSRF: jen veřejné adresy.
 */
import { describe, expect, it } from 'vitest';
import { cilConnect, cilZUrl, claudeEgressTargets, defaultResolveTarget, overVystupBehu } from '../egress-policy.js';

const model = (url: string) => ({ promenna: 'ANTHROPIC_BASE_URL', url });

describe('claudeEgressTargets', () => {
  it('bez adresy modelu výjimka se jménem proměnné (žádná vestavěná adresa dodavatele)', () => {
    expect(() => claudeEgressTargets({ model: model(''), volitelne: [] })).toThrow(/adresa modelu není deklarovaná \(ANTHROPIC_BASE_URL\)/);
    expect(() =>
      claudeEgressTargets({ model: { promenna: 'AGENT_LOCAL_LLM_URL', url: '  ' }, volitelne: [] }),
    ).toThrow(/adresa modelu není deklarovaná \(AGENT_LOCAL_LLM_URL\)/);
  });

  it('cíle = přesně hostitelé z konfigurace, s výchozím portem 443', () => {
    const cile = claudeEgressTargets({
      model: model('https://Model.Example.test/v1'),
      volitelne: [
        { promenna: 'AGENT_GATEWAY_URL', url: 'https://relay.example.test:8443/api' },
        { promenna: 'AGENT_GIT_REMOTE', url: 'https://forge.example.test/org/repo.git' },
        { promenna: 'NPM_REGISTRY_URL', url: 'https://npm.example.test/' },
      ],
    });
    expect(cile).toEqual([
      { host: 'model.example.test', port: 443 },
      { host: 'relay.example.test', port: 8443 },
      { host: 'forge.example.test', port: 443 },
      { host: 'npm.example.test', port: 443 },
    ]);
  });

  it('nenastavené volitelné adresy do výčtu nejdou; duplicity se slijí', () => {
    const cile = claudeEgressTargets({
      model: model('https://gw.example.test/v1'),
      volitelne: [
        { promenna: 'AGENT_GATEWAY_URL', url: 'https://gw.example.test/relay' },
        { promenna: 'AGENT_GIT_REMOTE', url: '' },
        { promenna: 'NPM_REGISTRY_URL', url: '' },
      ],
    });
    expect(cile).toEqual([{ host: 'gw.example.test', port: 443 }]);
  });

  it('http, ssh forge nebo nečitelná URL = výjimka (proxy tuneluje jen TLS přes CONNECT)', () => {
    expect(() => claudeEgressTargets({ model: model('http://m.example.test:8000'), volitelne: [] })).toThrow(/ANTHROPIC_BASE_URL.*https/);
    expect(() =>
      claudeEgressTargets({ model: model('https://m.example.test'), volitelne: [{ promenna: 'AGENT_GIT_REMOTE', url: 'git@forge.example.test:org/repo.git' }] }),
    ).toThrow(/AGENT_GIT_REMOTE/);
    expect(() => cilZUrl({ promenna: 'X', url: 'ssh://forge.example.test/repo' })).toThrow(/https/);
  });

  it('hodnota proměnné (může nést token) se do chyby nepíše', () => {
    try {
      cilZUrl({ promenna: 'AGENT_GIT_REMOTE', url: 'http://user:TAJNY-TOKEN@forge.example.test/repo' });
      expect.unreachable('čekala se výjimka');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('TAJNY-TOKEN');
    }
  });
});

describe('cilConnect', () => {
  it.each([
    ['api.example.test:443', { host: 'api.example.test', port: 443 }],
    ['API.Example.test:8443', { host: 'api.example.test', port: 8443 }],
    ['[2001:db8::1]:443', { host: '[2001:db8::1]', port: 443 }],
    ['api.example.test', null],
    ['api.example.test:0', null],
    ['api.example.test:99999', null],
    ['user@api.example.test:443', null],
    ['api.example.test:443/x', null],
  ])('%j → %j', (vstup, cekam) => {
    expect(cilConnect(vstup)).toEqual(cekam);
  });
});

describe('defaultResolveTarget — ochrana SSRF z @aisha/security (jen veřejné adresy)', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['localhost', 'loopback jménem'],
    ['10.1.2.3', 'RFC1918'],
    ['172.16.0.5', 'RFC1918'],
    ['192.168.1.1', 'RFC1918'],
    ['100.64.0.7', 'mesh / CGNAT'],
    ['169.254.169.254', 'metadata'],
    ['0.0.0.0', 'nespecifikovaná'],
  ])('%s (%s) → odmítnuto', async (host) => {
    await expect(defaultResolveTarget({ host, port: 443 })).rejects.toThrow(/blocked/i);
  });

  it('veřejná adresa projde a vrátí se IP, na kterou se proxy spojí (kotva)', async () => {
    await expect(defaultResolveTarget({ host: '203.0.113.21', port: 443 })).resolves.toBe('203.0.113.21');
  });
});

describe('overVystupBehu — výčet a ochrana SSRF proxy jsou JEDNO rozhodnutí (už při přípravě běhu)', () => {
  it('cíl, který ochrana SSRF odmítne (mesh / soukromá adresa), shodí přípravu s NÁZVEM proměnné', async () => {
    await expect(
      overVystupBehu({
        model: { promenna: 'ANTHROPIC_BASE_URL', url: 'https://203.0.113.21/' },
        volitelne: [{ promenna: 'AGENT_GATEWAY_URL', url: 'https://100.64.0.7/' }],
      }),
    ).rejects.toThrow(/AGENT_GATEWAY_URL vede na 100\.64\.0\.7:443.*nepustí/);
    await expect(
      overVystupBehu({ model: { promenna: 'AGENT_LOCAL_LLM_URL', url: 'https://10.1.2.3:8443/' }, volitelne: [] }),
    ).rejects.toThrow(/AGENT_LOCAL_LLM_URL/);
  });

  it('veřejné cíle projdou (kotva); nenastavené volitelné se neměří', async () => {
    const zmerene: string[] = [];
    await overVystupBehu(
      {
        model: { promenna: 'ANTHROPIC_BASE_URL', url: 'https://ask.example.test' },
        volitelne: [{ promenna: 'AGENT_GIT_REMOTE', url: '' }, { promenna: 'NPM_REGISTRY_URL', url: 'https://npm.example.test' }],
      },
      async (c) => { zmerene.push(`${c.host}:${c.port}`); return '203.0.113.21'; },
    );
    expect(zmerene).toEqual(['ask.example.test:443', 'npm.example.test:443']);
    await expect(
      overVystupBehu({ model: { promenna: 'ANTHROPIC_BASE_URL', url: 'https://203.0.113.21/' }, volitelne: [] }),
    ).resolves.toBeUndefined();
  });
});
