// Výklad deklarace GPU uzlu: platná projde, STOP případy jsou vady, generátor env
// vyplní 8 slotů (i volné) a odvodí podíl GPU. Čistá funkce, bez sítě a Dockeru.
import { describe, expect, it } from 'vitest';
import { envZUzlu, identitaAdresare, nactiUzel, overUzel, podsitVolneho, slotyEnginu, vbDeklarace } from './accel-uzel.mjs';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KOREN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OTISK_A = 'a'.repeat(64);
const OTISK_B = 'b'.repeat(64);
function uzel(uprav = (u) => {}) {
  const u = {
    verze: 1,
    vlastnik: 'testuzel',
    volne_sloty_blok: '10.99.240.0/21',
    karta: { kapacita_mib: 97887, rezerva_mib: 9789 },
    firewall: { ssh: 'svet', spravci: ['192.0.2.10/32'], rezim: 'measure', potvrzeni_s: 300, interval_s: 60 },
    jadro: { podsit: '10.99.0.0/28', vstup_ip: '10.99.0.2' },
    enginy: {
      'embed-1': {
        druh: 'pooling', repo: 'BAAI/bge-m3', revize: 'c'.repeat(40),
        soubor_vah: 'pytorch_model.bin', format_vah: 'pytorch', sha256: 'd'.repeat(64),
        vram_mib: 2600, max_model_len: 8192, start_mez_s: 600, cache_prefixu: false,
        recept: 'pooling=cls;normalizace=l2;max_tokenu=8190;orez=chyba',
      },
    },
    modely: { 'bge-m3': { engine: 'embed-1', dim: 1024 } },
    najemci: {
      testfork: {
        slot: 1,
        sit: { podsit: '10.99.2.0/28', vstup_ip: '10.99.2.2', rozsah_klientu: '10.99.2.8/29' },
        klice: [{ otisk_sha256: OTISK_A }], vypnuto: false, trida_duvery: 'vlastni-hardware-operatora',
        modely: { 'bge-m3-embedding': { model: 'bge-m3', max_tokenu: 8190 } },
        kvoty: { rezim: 'varovani', okno_s: 60, gpu_ms_za_okno: 30000, soubeh: { dotaz: 4, davka: 2 }, davka_max_vstupu: 128 },
      },
    },
  };
  uprav(u);
  return u;
}
const druhyNajemce = (u) => {
  u.najemci.z = JSON.parse(JSON.stringify(u.najemci.testfork));
  Object.assign(u.najemci.z, { slot: 2, sit: { podsit: '10.99.3.0/28', vstup_ip: '10.99.3.2', rozsah_klientu: '10.99.3.8/29' }, klice: [{ otisk_sha256: OTISK_B }] });
};

describe('sloty enginů = katalog', () => {
  it('každý slot katalogu accel-embed-<n> má svůj compose (a nic víc) — deklarace jinam mířit nemůže', () => {
    const sloty = [...slotyEnginu()].sort();
    expect(sloty.length, 'katalog nemá žádný slot enginu — měřidlo by tvrdilo prázdno').toBeGreaterThan(0);
    for (const s of sloty) expect(existsSync(join(KOREN, `docker-compose.coolify-accel-${s}.yml`)), s).toBe(true);
  });
  it('engine bez slotu v katalogu a engine, který není pooling = vada', () => {
    expect(overUzel(uzel((u) => { u.enginy['embed-99'] = u.enginy['embed-1']; }))).toContainEqual(expect.stringMatching(/engine embed-99: upstream pro něj nemá slot/));
    expect(overUzel(uzel((u) => (u.enginy['embed-1'].druh = 'generate')))).toContainEqual(expect.stringMatching(/jen pooling/));
  });
});

describe('overUzel', () => {
  it('platná deklarace testfork → žádné vady', () => {
    expect(overUzel(uzel())).toEqual([]);
  });
  it('chybí rozsah_klientu (N1) = vada', () => {
    expect(overUzel(uzel((u) => delete u.najemci.testfork.sit.rozsah_klientu))).toContainEqual(expect.stringMatching(/rozsah_klientu/));
  });
  it('rozsah klientů nesmí zahrnout bránu .1 ani vstup_ip (N1, shodně s VB)', () => {
    expect(overUzel(uzel((u) => (u.najemci.testfork.sit.rozsah_klientu = '10.99.2.0/29')))).toContainEqual(expect.stringMatching(/zahrnuje bránu 10\.99\.2\.1/));
    expect(overUzel(uzel((u) => (u.najemci.testfork.sit.vstup_ip = '10.99.2.9')))).toContainEqual(expect.stringMatching(/zahrnuje vstup_ip/));
  });
  it('firewall jde přes jediný výklad (accel-deklarace.mjs): chybí, neznámý režim, blok internetu ve správě = vada', () => {
    const bez = overUzel(uzel((u) => delete u.firewall));
    expect(bez).toContainEqual(expect.stringMatching(/firewall: ACCEL_FW_MODE není deklarovaný/));
    expect(bez).toContainEqual(expect.stringMatching(/firewall: ACCEL_FW_SSH není deklarovaný/));
    expect(overUzel(uzel((u) => (u.firewall.rezim = 'zapnuto')))).toContainEqual(expect.stringMatching(/firewall: ACCEL_FW_MODE='zapnuto'/));
    expect(overUzel(uzel((u) => (u.firewall.spravci = ['0.0.0.0/0'])))).toContainEqual(expect.stringMatching(/blok internetu/));
    expect(overUzel(uzel((u) => (u.firewall.spravci = ['2001:db8::/48']))), 'správa po IPv6 smí').toEqual([]);
  });
  it('Σ VRAM + rezerva > kapacita = vada (VT3)', () => {
    expect(overUzel(uzel((u) => (u.enginy['embed-1'].vram_mib = 90000)))).toContainEqual(expect.stringMatching(/Σ VRAM/));
  });
  it('dva nájemci na jednom slotu = vada', () => {
    expect(overUzel(uzel((u) => { druhyNajemce(u); u.najemci.z.slot = 1; }))).toContainEqual(expect.stringMatching(/slot 1 má už jiný nájemce/));
  });
  it('překryv podsítí nájemců = vada', () => {
    expect(overUzel(uzel((u) => { druhyNajemce(u); u.najemci.z.sit = { ...u.najemci.testfork.sit }; }))).toContainEqual(expect.stringMatching(/překrývá se s najemci\.testfork/));
  });
  it('sdílený otisk klíče mezi nájemci = vada', () => {
    expect(overUzel(uzel((u) => { druhyNajemce(u); u.najemci.z.klice = [{ otisk_sha256: OTISK_A }]; }))).toContainEqual(expect.stringMatching(/otisk sdílí/));
  });
  it('alias míří na neznámý model = vada', () => {
    expect(overUzel(uzel((u) => (u.najemci.testfork.modely['bge-m3-embedding'].model = 'neni')))).toContainEqual(expect.stringMatching(/deklarace nezná/));
  });
  it('nájemce zasahuje do bloku volných slotů = vada', () => {
    expect(overUzel(uzel((u) => (u.najemci.testfork.sit.podsit = podsitVolneho(uzel(), 1))))).toContainEqual(expect.stringMatching(/blok(u)? volných/));
  });
  it('kvóta gpu_ms 0, nezarovnaná síť, prefix mimo 8–30 a jméno nájemce mimo pravidlo VB = vada (jinak by VB odmítl všechny)', () => {
    expect(overUzel(uzel((u) => (u.najemci.testfork.kvoty.gpu_ms_za_okno = 0)))).toContainEqual(expect.stringMatching(/gpu_ms_za_okno: kladné/));
    expect(overUzel(uzel((u) => (u.najemci.testfork.sit.podsit = '10.99.2.5/28')))).toContainEqual(expect.stringMatching(/sit\.podsit: zarovnaná/));
    expect(overUzel(uzel((u) => (u.jadro.podsit = '10.99.0.0/31')))).toContainEqual(expect.stringMatching(/jadro\.podsit: zarovnaná/));
    const jmeno = (j) => uzel((u) => { u.najemci[j] = u.najemci.testfork; delete u.najemci.testfork; });
    expect(overUzel(jmeno('3d-lab'))).toContainEqual(expect.stringMatching(/najemci\.3d-lab: jméno/));
    expect(overUzel(jmeno('a'.repeat(32)))).toContainEqual(expect.stringMatching(/jméno/));
    expect(overUzel(jmeno('a'.repeat(31))), 'kotva: 31 znaků smí').toEqual([]);
  });
  it('nájemce se nesmí jmenovat jako síť volného slotu (volny-<n>)', () => {
    const jmeno = (j) => uzel((u) => { u.najemci[j] = u.najemci.testfork; delete u.najemci.testfork; });
    expect(overUzel(jmeno('volny-3'))).toContainEqual(expect.stringMatching(/ne volny-<n>/));
    expect(overUzel(jmeno('volnyx')), 'kotva: jen přesný tvar volny-<číslo>').toEqual([]);
  });
  it('režim kvót je povinný a jen varovani|vynucovat (platforma ho nedosazuje)', () => {
    expect(overUzel(uzel((u) => delete u.najemci.testfork.kvoty.rezim))).toContainEqual(expect.stringMatching(/kvoty\.rezim: varovani\|vynucovat/));
    expect(overUzel(uzel((u) => (u.najemci.testfork.kvoty.rezim = 'mekke')))).toContainEqual(expect.stringMatching(/kvoty\.rezim/));
    expect(overUzel(uzel((u) => (u.najemci.testfork.kvoty.rezim = 'vynucovat')))).toEqual([]);
  });
  it('engine na nájemce (O-4): dva nájemci na jednom enginu = vada; sdílet smí jen diagnostika', () => {
    expect(overUzel(uzel(druhyNajemce))).toContainEqual(expect.stringMatching(/najemci\.z: engine 'embed-1' už slouží nájemci testfork/));
    expect(overUzel(uzel((u) => { druhyNajemce(u); u.najemci.z.diagnostika = true; })), 'diagnostika sdílet smí').toEqual([]);
  });
  it('hodnoty do env jen z bezpečných znaků; blok volných slotů z deklarace', () => {
    expect(overUzel(uzel((u) => (u.enginy['embed-1'].repo = 'BAAI/bge-m3$(id)')))).toContainEqual(expect.stringMatching(/repo: owner\/name/));
    expect(overUzel(uzel((u) => (u.enginy['embed-1'].soubor_vah = 'a;b')))).toContainEqual(expect.stringMatching(/soubor_vah/));
    expect(overUzel(uzel((u) => (u.volne_sloty_blok = '10.99.240.0/24')))).toContainEqual(expect.stringMatching(/volne_sloty_blok/));
    expect(overUzel(uzel((u) => (u.najemci.testfork.sit = { podsit: '10.99.241.0/28', vstup_ip: '10.99.241.2', rozsah_klientu: '10.99.241.8/29' })))).toContainEqual(expect.stringMatching(/bloku volných slotů 10\.99\.240\.0\/21/));
    expect(podsitVolneho(uzel(), 8)).toBe('10.99.247.0/28');
  });
  it('pole warmupu (docker_host, registry_proxy, projekt) v deklaraci = vada — nasazuje Coolify', () => {
    expect(overUzel(uzel((u) => (u.docker_host = 'ssh://uzel.test')))).toContainEqual(expect.stringMatching(/docker_host: pole zaniklo/));
    expect(overUzel(uzel((u) => (u.registry_proxy = '')))).toContainEqual(expect.stringMatching(/registry_proxy: pole zaniklo/));
    expect(overUzel(uzel((u) => (u.enginy['embed-1'].projekt = 'op-embed-1')))).toContainEqual(expect.stringMatching(/embed-1\.projekt: pole zaniklo/));
    expect(overUzel(uzel((u) => (u.najemci.testfork.projekt = 'testfork-model')))).toContainEqual(expect.stringMatching(/testfork\.projekt: pole zaniklo/));
  });
  it('engine na nájemce (O-4): týž adresář vah u dvou enginů jen s tutéž identitou', () => {
    const druhy = (u) => { u.enginy['embed-2'] = { ...u.enginy['embed-1'] }; };
    expect(overUzel(uzel(druhy))).toEqual([]);
    expect(overUzel(uzel((u) => { druhy(u); u.enginy['embed-2'].sha256 = 'e'.repeat(64); }))).toContainEqual(expect.stringMatching(/embed-2: adresář vah BAAI\/bge-m3@c{40} má u enginu embed-1 jinou identitu/));
  });
});

describe('nactiUzel', () => {
  it('nečitelný JSON = vada, ne výjimka', () => {
    const d = mkdtempSync(join(tmpdir(), 'uzel-'));
    writeFileSync(join(d, 'u.json'), '{neni json');
    expect(nactiUzel(join(d, 'u.json')).vady[0]).toMatch(/není platný JSON/);
  });
  it('platná → { uzel }', () => {
    const d = mkdtempSync(join(tmpdir(), 'uzel-'));
    writeFileSync(join(d, 'u.json'), JSON.stringify(uzel()));
    expect(nactiUzel(join(d, 'u.json')).uzel.vlastnik).toBe('testuzel');
  });
});

describe('envZUzlu', () => {
  const env = envZUzlu(uzel());
  it('firewall → ACCEL_FW_* (vlastník uzlu = vlastník, UDP meshe bez deklarace zavřený); REGISTRY_PROXY ne — ten má instance', () => {
    expect(env.get('ACCEL_FW_NODE_OWNER')).toBe('testuzel');
    expect(env.get('ACCEL_FW_MODE')).toBe('measure');
    expect(env.get('ACCEL_FW_SSH')).toBe('svet');
    expect(env.get('ACCEL_FW_ADMIN_CIDRS')).toBe('192.0.2.10/32');
    expect(env.get('ACCEL_FW_CONFIRM_S')).toBe('300');
    expect(env.get('ACCEL_FW_INTERVAL_S')).toBe('60');
    expect(env.get('ACCEL_FW_UDP_MESH_PORT')).toBe('');
    expect(env.has('REGISTRY_PROXY')).toBe(false);
  });
  it('vlastník, jádro a slot nájemce (jméno sítě skládá compose: <vlastník>-lane-<ACCEL_NAJEMCE_n>)', () => {
    expect(env.get('ACCEL_OWNER_PREFIX')).toBe('testuzel');
    expect(env.get('ACCEL_JADRO_PODSIT')).toBe('10.99.0.0/28');
    expect(env.get('ACCEL_JADRO_VSTUP_IP')).toBe('10.99.0.2');
    expect(env.has('ACCEL_JADRO_SIT'), 'celé jméno sítě by bylo druhým domovem jména').toBe(false);
    expect(env.get('ACCEL_NAJEMCE_1')).toBe('testfork');
    expect(env.get('ACCEL_NAJEMCE_1_PODSIT')).toBe('10.99.2.0/28');
    expect(env.get('ACCEL_NAJEMCE_1_ROZSAH')).toBe('10.99.2.8/29');
    expect(env.get('ACCEL_NAJEMCE_1_IP')).toBe('10.99.2.2');
  });
  it('volné sloty 2..8: volny-<n>, podsíť z bloku, rozsah = horní polovina, VB na .2', () => {
    expect(env.get('ACCEL_NAJEMCE_2')).toBe('volny-2');
    expect(env.get('ACCEL_NAJEMCE_2_PODSIT')).toBe(podsitVolneho(uzel(), 2));
    expect(env.get('ACCEL_NAJEMCE_2_ROZSAH')).toBe('10.99.241.8/29');
    expect(env.get('ACCEL_NAJEMCE_8')).toBe('volny-8');
    expect(env.get('ACCEL_NAJEMCE_2_IP')).toBe('10.99.241.2');
  });
  it('engine: podíl GPU dolů na 3 místa + identita vah', () => {
    expect(env.get('ACCEL_EMBED_1_REPO')).toBe('BAAI/bge-m3');
    expect(env.get('ACCEL_EMBED_1_FORMAT_VAH')).toBe('pytorch');
    expect(env.get('ACCEL_EMBED_1_MAX_MODEL_LEN')).toBe('8192');
    expect(env.get('ACCEL_EMBED_1_PODIL_GPU')).toBe('0.026');
  });
  it('deklarace pro VB jede v env jako ACCEL_DEKLARACE_B64 a je přesně vbDeklarace()', () => {
    expect(JSON.parse(Buffer.from(env.get('ACCEL_DEKLARACE_B64'), 'base64').toString())).toEqual(vbDeklarace(uzel()));
  });
  it('neověřená deklarace → výjimka', () => {
    expect(() => envZUzlu(uzel((u) => delete u.jadro))).toThrow(/neověřenou/);
  });
  it('adresáře vah pro accel-vahy: každý <repo>@<revize> jednou, i když ho čtou dva enginy', () => {
    const e2 = envZUzlu(uzel((u) => { u.enginy['embed-2'] = { ...u.enginy['embed-1'] }; }));
    expect(JSON.parse(Buffer.from(e2.get('ACCEL_VAHY_B64'), 'base64').toString())).toEqual([
      { repo: 'BAAI/bge-m3', revize: 'c'.repeat(40), soubor_vah: 'pytorch_model.bin', format_vah: 'pytorch', sha256: 'd'.repeat(64) },
    ]);
    expect(e2.get('ACCEL_EMBED_2_PODIL_GPU')).toBe('0.026');
  });
});

describe('vbDeklarace (tvar vstupu lane)', () => {
  const vb = vbDeklarace(uzel());
  it('engine: adresa = jméno kontejneru na jádře, identita z deklarace, zahřátí = max_model_len', () => {
    expect(vb.enginy['embed-1']).toMatchObject({ url: 'http://testuzel-accel-embed-1:8000', model: 'embed-1', zahrati_tokenu: 8192, identita: { format: 'pytorch', sha256: 'd'.repeat(64), revize: 'c'.repeat(40) } });
  });
  it('nájemce: rozsah klientů, otisky, alias → engine, max_tokenu obsahu, režim kvót', () => {
    expect(vb.najemci.testfork.sit).toEqual({ podsit: '10.99.2.0/28', vstup_ip: '10.99.2.2', rozsah_klientu: '10.99.2.8/29' });
    expect(vb.najemci.testfork.otisky).toEqual([OTISK_A]);
    expect(vb.najemci.testfork.modely['bge-m3-embedding']).toEqual({ engine: 'embed-1', max_tokenu: 8190 });
    expect(vb.najemci.testfork.kvoty.rezim).toBe('varovani');
  });
});

describe('chat: engine generate, LoRA adaptéry nájemců, rozdělené váhy', () => {
  const ADAPTER = { engine: 'chat-1', repo: 'org/lens', revize: 'f'.repeat(40), sha256: '1'.repeat(64) };
  const sChatem = (uprav = () => {}) => uzel((u) => {
    u.enginy['chat-1'] = {
      druh: 'generate', repo: 'org/chat', revize: 'a'.repeat(40), soubor_vah: '@vse', format_vah: 'safetensors',
      sha256: '2'.repeat(64), vram_mib: 40000, max_model_len: 8192, start_mez_s: 900, recept: 'chat=bf16', lora: { max_adapteru: 4, max_rank: 64 },
    };
    u.modely.chat = { engine: 'chat-1', max_tokenu: 1024 };
    u.najemci.testfork.adaptery = { lens: { ...ADAPTER } }; // kopie: případy mutují svou deklaraci
    u.najemci.testfork.modely.lens = { model: 'chat', adapter: 'lens' };
    u.najemci.testfork.modely.zaklad = { model: 'chat' };
    uprav(u);
  });
  it('kotva: chat s adaptérem a rozdělenými vahami je platná deklarace', () => {
    expect(overUzel(sChatem())).toEqual([]);
  });
  it('env chatového slotu: jen meze LoRA (adaptéry načítá vstup za běhu); adaptér jde do ACCEL_VAHY_B64', () => {
    const env = envZUzlu(sChatem());
    expect(env.has('ACCEL_CHAT_1_LORA_MODULY'), 'statický seznam adaptérů engine nemá').toBe(false);
    expect([env.get('ACCEL_CHAT_1_MAX_LORAS'), env.get('ACCEL_CHAT_1_MAX_LORA_RANK'), env.get('ACCEL_CHAT_1_SOUBOR_VAH')]).toEqual(['4', '64', '@vse']);
    const vahy = JSON.parse(Buffer.from(env.get('ACCEL_VAHY_B64'), 'base64').toString());
    expect(vahy).toContainEqual({ repo: 'org/lens', revize: 'f'.repeat(40), soubor_vah: '@vse', format_vah: 'safetensors', sha256: '1'.repeat(64) });
  });
  it('deklarace VB: engine nese adaptéry, alias s adaptérem ho jmenuje v prostoru nájemce, chat se zahřívá 1 tokenem', () => {
    const vb = vbDeklarace(sChatem());
    expect(vb.enginy['chat-1']).toMatchObject({ druh: 'generate', zahrati_tokenu: 1, adaptery: { 'testfork.lens': { sha256: '1'.repeat(64), revize: 'f'.repeat(40), adresar: `/vahy/org--lens@${'f'.repeat(40)}` } } });
    expect(vb.najemci.testfork.modely.lens).toEqual({ engine: 'chat-1', max_tokenu: 1024, adapter: 'testfork.lens' });
    expect(vb.najemci.testfork.modely.zaklad).toEqual({ engine: 'chat-1', max_tokenu: 1024 });
  });
  it('vady: chat bez stropu tokenů, LoRA u embedderu, slot chat s pooling, adaptér cizího enginu, alias s nedeklarovaným adaptérem, glob místo @vse', () => {
    expect(overUzel(sChatem((u) => delete u.modely.chat.max_tokenu))).toContainEqual(expect.stringMatching(/modely\.chat\.max_tokenu/));
    expect(overUzel(sChatem((u) => (u.enginy['embed-1'].lora = { max_adapteru: 1, max_rank: 8 })))).toContainEqual(expect.stringMatching(/embed-1\.lora: jen u enginu generate/));
    expect(overUzel(sChatem((u) => (u.enginy['chat-1'].druh = 'pooling')))).toContainEqual(expect.stringMatching(/slot chat-\* servíruje jen generate/));
    expect(overUzel(sChatem((u) => (u.najemci.testfork.adaptery.lens.engine = 'embed-1')))).toContainEqual(expect.stringMatching(/adaptery\.lens\.engine: 'embed-1' není chatový/));
    expect(overUzel(sChatem((u) => (u.najemci.testfork.modely.lens.adapter = 'jiny')))).toContainEqual(expect.stringMatching(/adapter: 'jiny' nájemce nedeklaruje/));
    expect(overUzel(sChatem((u) => (u.enginy['chat-1'].format_vah = 'pytorch'))), 'kotva: @vse měří celý adresář v jakémkoli formátu').toEqual([]);
    expect(overUzel(sChatem((u) => (u.enginy['chat-1'].soubor_vah = '*.safetensors')))).toContainEqual(expect.stringMatching(/soubor_vah/));
    expect(overUzel(sChatem((u) => (u.enginy['chat-1'].lora.max_rank = 48)))).toContainEqual(expect.stringMatching(/max_rank/));
  });
});

describe('identita adresáře revize (@vse) = týž výpočet jako Python v compose', () => {
  it('JS a Python (výpočet vytažený ze SKUTEČNÉHO compose) dají totéž; aisha-identita.json a .cache se nepočítají; změna configu identitu změní', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdirSync: md, readFileSync: rf } = await import('node:fs');
    const d = mkdtempSync(join(tmpdir(), 'identita-'));
    md(join(d, 'original'));
    md(join(d, '.cache'));
    writeFileSync(join(d, 'model-00001-of-00002.safetensors'), 'A');
    writeFileSync(join(d, 'model-00002-of-00002.safetensors'), 'B');
    writeFileSync(join(d, 'config.json'), '{"x":1}');
    writeFileSync(join(d, 'tokenizer_config.json'), '{"chat_template":"{{x}}"}');
    writeFileSync(join(d, 'original', 'params.json'), '{}');
    writeFileSync(join(d, '.cache', 'smeti'), 'z');
    writeFileSync(join(d, 'aisha-identita.json'), '{}');
    const compose = rf(join(KOREN, 'docker-compose.coolify-accel-chat-1.yml'), 'utf8');
    const telo = /        def sha\(p\):[\s\S]*?            return sha\(d \/ soubor\)\n/.exec(compose)?.[0];
    expect(telo, 'výpočet identity v compose chatu').toBeTruthy();
    const py = `import hashlib, sys, pathlib\n${telo.replace(/^ {8}/gm, '').replace(/\$\$/g, '$')}print(identita(pathlib.Path(sys.argv[1]), "@vse"))`;
    const zPythonu = execFileSync('python3', ['-c', py, d], { encoding: 'utf8' }).trim();
    expect(identitaAdresare(d)).toBe(zPythonu);
    const pred = identitaAdresare(d);
    writeFileSync(join(d, 'aisha-identita.json'), '{"jine":1}');
    writeFileSync(join(d, '.cache', 'smeti'), 'jine');
    expect(identitaAdresare(d), 'identita.json a .cache se nepočítají').toBe(pred);
    writeFileSync(join(d, 'tokenizer_config.json'), '{"chat_template":"{{podvrh}}"}');
    expect(identitaAdresare(d), 'změněná šablona chatu = jiná identita').not.toBe(pred);
  });
});
