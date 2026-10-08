/**
 * Fixtura deklarace uzlu pro testy: dva nájemci (zkušební Z a ALFA), každý se svým embedderem (O-4).
 * Klíče tu jsou jen proto, aby test mohl volat; deklarace nese jen jejich otisky.
 */
import { createHash } from 'node:crypto';

export const KLIC_Z = 'klic-zkusebniho-najemce-z';
export const KLIC_ALFA = 'klic-najemce-alfa';
export const KLIC_ALFA_NOVY = 'klic-najemce-alfa-po-rotaci';
export const otisk = (k: string) => createHash('sha256').update(k).digest('hex');

export const IP_Z = { vstup: '10.251.1.2', klient: '10.251.1.9' };
export const IP_ALFA = { vstup: '10.251.2.2', klient: '10.251.2.9' };

/** Volný tvar fixtury: testy do ní záměrně vkládají i neplatná pole (proto index signatury). */
export interface NajemceFix {
  sit?: { podsit: string; vstup_ip: string; rozsah_klientu: string };
  otisky: string[];
  vypnuto: boolean;
  trida_duvery: string;
  modely: Record<string, { engine: string; max_tokenu: number }>;
  kvoty?: { rezim: 'varovani' | 'vynucovat'; okno_s: number; gpu_ms_za_okno: number; soubeh: { dotaz: number; davka: number }; davka_max_vstupu: number };
  [k: string]: unknown;
}
export interface UzelFix {
  verze: number;
  enginy: Record<string, { url: string; zapnuto: boolean; [k: string]: unknown }>;
  najemci: Record<string, NajemceFix>;
  [k: string]: unknown;
}

export function uzel(upravy: (u: UzelFix) => void = () => {}): UzelFix {
  const u: UzelFix = {
    verze: 1,
    enginy: {
      'embed-1': {
        druh: 'pooling',
        url: 'http://127.0.0.1:1',
        zapnuto: true,
        start_mez_s: 600,
        identita: { format: 'safetensors', sha256: 'a'.repeat(64), revize: 'b'.repeat(40) },
        model: 'embed-1',
        zahrati_tokenu: 8192,
        recept: 'pooling=cls;normalizace=l2;max_tokenu=8192;orez=chyba',
      },
      'embed-2': {
        druh: 'pooling',
        url: 'http://127.0.0.1:1',
        zapnuto: true,
        start_mez_s: 600,
        identita: { format: 'safetensors', sha256: 'a'.repeat(64), revize: 'b'.repeat(40) },
        model: 'embed-2',
        zahrati_tokenu: 8192,
        recept: 'pooling=cls;normalizace=l2;max_tokenu=8192;orez=chyba',
      },
    },
    najemci: {
      z: {
        sit: { podsit: '10.251.1.0/28', vstup_ip: IP_Z.vstup, rozsah_klientu: '10.251.1.8/29' },
        otisky: [otisk(KLIC_Z)],
        vypnuto: false,
        trida_duvery: 'vlastni-hardware-operatora',
        modely: { 'embed-v1': { engine: 'embed-1', max_tokenu: 8192 } },
        kvoty: { rezim: 'vynucovat', okno_s: 60, gpu_ms_za_okno: 60_000, soubeh: { dotaz: 2, davka: 1 }, davka_max_vstupu: 32 },
      },
      alfa: {
        sit: { podsit: '10.251.2.0/28', vstup_ip: IP_ALFA.vstup, rozsah_klientu: '10.251.2.8/29' },
        otisky: [otisk(KLIC_ALFA)],
        vypnuto: false,
        trida_duvery: 'vlastni-hardware-operatora',
        modely: { 'embed-v1': { engine: 'embed-2', max_tokenu: 8192 } },
        kvoty: { rezim: 'vynucovat', okno_s: 60, gpu_ms_za_okno: 60_000, soubeh: { dotaz: 2, davka: 1 }, davka_max_vstupu: 32 },
      },
    },
  };
  upravy(u);
  return u;
}

/** Čerstvé měření členství: na sítích jen to, co tam patří (výchozí pro testy, které členství neměří). */
export const OTISK_DEKLARACE = 'd'.repeat(64);
export function clenstviOk(najemci: string[] = ['z', 'alfa'], ted = Date.now(), deklarace = OTISK_DEKLARACE) {
  return {
    verze: 1 as const,
    zmereno: new Date(ted).toISOString(),
    deklarace,
    jadro: { ok: true, cizi: [] as string[] },
    najemci: Object.fromEntries(najemci.map((id) => [id, { ok: true, cizi: [] as string[] }])),
    varovani: [] as string[],
  };
}
