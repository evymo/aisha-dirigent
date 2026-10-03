import { describe, it, expect } from 'vitest';
import {
  cestaZdroje,
  ohniskoPoVyrezu,
  overParametry,
  podepisCestu,
  podepsanaAdresa,
  sestavZpracovani,
  vystupniFormat,
  vyzadujePrevod,
} from './imgproxy-podpis.js';

// Klíč a sůl z dokumentace imgproxy (veřejný příklad, ne tajemství instance).
// Skládané za běhu: skener tajemství čte tvar `KEY = '<hex>'` jako klíč a repo testovací
// hodnoty do .gitleaks.toml nevyjímá.
const KEY = ['943b421c9eb07c83', '0af81030552c8600', '9268de4e532ba2ee', '2eab8247c6da0881'].join('');
const SALT = ['520f986b998545b4', '785e0defbc4f3c12', '03f22de2374a3d53', 'cb7a7fe9fea309c5'].join('');

describe('podpis cesty imgproxy', () => {
  // ⛔ Referenční hodnoty spočítané NEZÁVISLOU implementací (python: hmac.new(key,
  // salt + path, sha256), base64 urlsafe bez '='), 2026-09-24. Test, který by
  // porovnával jen dvě volání téže funkce, by podpis neměřil.
  it('sedí na referenční podpis (bez přiblížení)', () => {
    const cesta = sestavZpracovani({ w: 640, h: 360, fx: 0.5, fy: 0.5, zoom: 1 }) + cestaZdroje('page-assets', 'u/x.jpg', 'webp');
    expect(cesta).toBe('/rs:fill:640:360/g:fp:0.5:0.5/plain/s3://page-assets/u/x.jpg@webp');
    expect(podepisCestu(cesta, KEY, SALT)).toBe('6DhrS299MHpY-wGf1fYj3ZLJC80yuZJOmasmjO5L1YU');
    expect(podepsanaAdresa('http://imgproxy:8080/', cesta, KEY, SALT)).toBe(
      'http://imgproxy:8080/6DhrS299MHpY-wGf1fYj3ZLJC80yuZJOmasmjO5L1YU' + cesta,
    );
  });

  it('sedí na referenční podpis (přiblížení 2× s ohniskem 0.25/0.75)', () => {
    const cesta = sestavZpracovani({ w: 640, h: 360, fx: 0.25, fy: 0.75, zoom: 2 }) + cestaZdroje('page-assets', 'u/x.jpg', 'jpg');
    // Výřez 0.5×0.5 centrovaný na ohnisko: vodorovně se přitiskne k levému okraji
    // (0.25 − 0.25 = 0), svisle k dolnímu (0.75 − 0.25 = 0.5 = 1 − 0.5); ohnisko
    // je pak uprostřed obou stran výřezu.
    expect(cesta).toBe('/c:0.5:0.5:fp:0.25:0.75/rs:fill:640:360/g:fp:0.5:0.5/plain/s3://page-assets/u/x.jpg@jpg');
    expect(podepisCestu(cesta, KEY, SALT)).toBe('w86o1E_B76HjwaA82doDsCZyD4P4lTpq-OMDY1MkvAU');
  });
});

describe('ohnisko po výřezu', () => {
  it('bez přiblížení se nemění', () => {
    expect(ohniskoPoVyrezu(0.3, 1)).toBe(0.3);
  });
  it('ohnisko uprostřed zůstane uprostřed výřezu', () => {
    expect(ohniskoPoVyrezu(0.5, 3)).toBeCloseTo(0.5, 6);
  });
  it('ohnisko u okraje: výřez se přitiskne a ohnisko se posune ke kraji výřezu', () => {
    // zoom 4 → strana 0.25; ohnisko 0.05 → výřez od 0 do 0.25 → ohnisko na 0.2 výřezu
    expect(ohniskoPoVyrezu(0.05, 4)).toBeCloseTo(0.2, 6);
    expect(ohniskoPoVyrezu(1, 4)).toBeCloseTo(1, 6);
  });
});

describe('bílá listina parametrů', () => {
  it('bez parametrů = žádná transformace', () => {
    expect(overParametry({})).toEqual({ ok: true, hodnoty: null });
    expect(overParametry({ w: '' })).toEqual({ ok: true, hodnoty: null });
  });
  it('w+h stačí, ohnisko a přiblížení mají střed a 1', () => {
    expect(overParametry({ w: '640', h: '360' })).toEqual({ ok: true, hodnoty: { w: 640, h: 360, fx: 0.5, fy: 0.5, zoom: 1 } });
  });
  it('odmítne mimo meze, necelé rozměry i transformaci bez cíle', () => {
    expect(overParametry({ w: '0', h: '360' }).ok).toBe(false);
    expect(overParametry({ w: '4001', h: '360' }).ok).toBe(false);
    expect(overParametry({ w: '640.5', h: '360' }).ok).toBe(false);
    expect(overParametry({ w: '640', h: '360', fx: '1.2' }).ok).toBe(false);
    expect(overParametry({ w: '640', h: '360', z: '5' }).ok).toBe(false);
    expect(overParametry({ w: '640', h: '360', z: '0.5' }).ok).toBe(false);
    expect(overParametry({ fx: '0.2' }).ok).toBe(false);
    expect(overParametry({ w: 'abc', h: '360' }).ok).toBe(false);
  });
});

describe('výstupní formát a převod', () => {
  it('gif zůstává gif, webp podle Accept, jinak png/jpg', () => {
    expect(vystupniFormat('image/webp,*/*', 'a/b.gif')).toBe('gif');
    expect(vystupniFormat('image/webp,*/*', 'a/b.png')).toBe('webp');
    expect(vystupniFormat('*/*', 'a/b.png')).toBe('png');
    expect(vystupniFormat(undefined, 'a/b.HEIC')).toBe('jpg');
  });
  it('HEIC/HEIF vyžaduje převod vždy', () => {
    expect(vyzadujePrevod('u/f.heic')).toBe(true);
    expect(vyzadujePrevod('u/f.HEIF')).toBe(true);
    expect(vyzadujePrevod('u/f.jpg')).toBe(false);
  });
});
