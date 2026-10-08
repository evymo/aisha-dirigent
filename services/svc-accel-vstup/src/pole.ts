/**
 * Tvar požadavku nájemce: uzavřený seznam povolených polí po endpointu.
 *
 * Pravidlo 0.5 jádra: pole, která vlastní PLATFORMA (sůl cache, identita nájemce,
 * prostor jmen adaptéru, recept, priorita), pošle-li je klient = ODMÍTNOUT kódem
 * POLE_PLATFORMY s jménem pole (nikdy hodnotou). Zahodit a pokračovat by útok
 * ztišilo (MJ26). Pole, které neznáme vůbec, je POZADAVEK_NEPLATNY — „Reject
 * unexpected input shapes rather than trying to coerce them“.
 *
 * Hlavičky: cokoli `x-aisha-*` kromě třídy patří platformě (identita, prostor
 * jmen…) = POLE_PLATFORMY. Obecné transportní hlavičky (`forwarded`,
 * `x-forwarded-*`) jsou jediná pojmenovaná výjimka: VB z nich nic neodvozuje.
 * Třída `x-aisha-trida` je povinná, výchozí hodnota se nedosazuje (R3).
 */
import { HLAVICKY, TRIDY, type Duvod, type Trida } from '@aisha/accel-protokol';

/** Pole těla, která vlastní platforma (fáze 1 i 2). */
export const POLE_PLATFORMY_TELA = Object.freeze([
  'cache_salt',
  'priority',
  'lora_request',
  'normalize',
  'dimensions',
  'truncate_prompt_tokens',
  'add_special_tokens',
  'user_najemce',
]);

const POVOLENA_POLE: Record<string, readonly string[]> = {
  '/v1/embeddings': ['model', 'input', 'encoding_format'],
  // Chat: jen text, jedna odpověď. Nástroje, logprobs a obrázky nejsou (nové pole = vědomé rozšíření).
  '/v1/chat/completions': ['model', 'messages', 'max_tokens', 'temperature', 'top_p', 'stop', 'stream', 'seed', 'presence_penalty', 'frequency_penalty', 'n'],
};

/** Role zpráv chatu (jen text). */
const ROLE_CHATU = Object.freeze(['system', 'user', 'assistant']);

export type VysledekTvaru = { ok: true; trida: Trida; alias: string; vstupy: string[] } | { ok: false; duvod: Duvod; error: string; pole?: string };

export function overHlavicky(headers: Record<string, string | string[] | undefined>): { trida: Trida } | { duvod: Duvod; error: string; pole?: string } {
  for (const jmeno of Object.keys(headers)) {
    const h = jmeno.toLowerCase();
    if (h.startsWith('x-aisha-') && h !== HLAVICKY.TRIDA) return { duvod: 'POLE_PLATFORMY', error: 'hlavička patří platformě, ne klientovi', pole: h };
  }
  const trida = headers[HLAVICKY.TRIDA];
  if (typeof trida !== 'string' || !(TRIDY as readonly string[]).includes(trida)) {
    return { duvod: 'POZADAVEK_NEPLATNY', error: `chybí nebo je neplatná třída požadavku (${HLAVICKY.TRIDA}: ${TRIDY.join(' | ')})` };
  }
  return { trida: trida as Trida };
}

/** Tělo POST /v1/embeddings (fáze 1). */
export function overTeloEmbeddings(telo: unknown, maxVstupu: number): Omit<Extract<VysledekTvaru, { ok: true }>, 'trida'> | { ok: false; duvod: Duvod; error: string; pole?: string } {
  if (!telo || typeof telo !== 'object' || Array.isArray(telo)) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'tělo musí být JSON objekt' };
  const t = telo as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (POLE_PLATFORMY_TELA.includes(k)) return { ok: false, duvod: 'POLE_PLATFORMY', error: 'pole patří platformě, ne klientovi', pole: k };
    if (!POVOLENA_POLE['/v1/embeddings'].includes(k)) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: `neznámé pole '${k}'` };
  }
  if (typeof t.model !== 'string' || t.model.length === 0) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'chybí model' };
  // Prostor jmen určuje identita vstupu, ne klient (V3): jméno s lomítkem = pokus o cizí prostor.
  if (t.model.includes('/')) return { ok: false, duvod: 'POLE_PLATFORMY', error: 'prostor jmen modelu určuje platforma', pole: 'model' };
  if (t.encoding_format !== undefined && t.encoding_format !== 'float') return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: "encoding_format smí být jen 'float'" };
  const vstupy = typeof t.input === 'string' ? [t.input] : Array.isArray(t.input) && t.input.every((x) => typeof x === 'string') ? (t.input as string[]) : null;
  if (!vstupy || vstupy.length === 0 || vstupy.some((x) => x.length === 0)) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'input musí být neprázdný řetězec nebo pole neprázdných řetězců' };
  if (vstupy.length > maxVstupu) return { ok: false, duvod: 'KVOTA_PREKROCENA', error: `víc vstupů v jednom požadavku, než dovoluje kvóta (${maxVstupu})`, pole: 'davka_max_vstupu' };
  return { ok: true, alias: t.model, vstupy };
}

export type TeloChatu = { ok: true; alias: string; telo: Record<string, unknown>; proud: boolean };

/**
 * Tělo POST /v1/chat/completions. `maxTokenu` = strop vygenerovaných tokenů aliasu z deklarace:
 * chybějící `max_tokens` se DOSADÍ stropem (bez něj by generování drželo engine neomezeně),
 * vyšší = POZADAVEK_NEPLATNY (tvar, ne kvóta). Vrací tělo pro engine BEZ polí platformy —
 * model a sůl cache dosadí vstup.
 */
export function overTeloChatu(telo: unknown, maxTokenu: (alias: string) => number | undefined): TeloChatu | { ok: false; duvod: Duvod; error: string; pole?: string } {
  if (!telo || typeof telo !== 'object' || Array.isArray(telo)) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'tělo musí být JSON objekt' };
  const t = telo as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (POLE_PLATFORMY_TELA.includes(k)) return { ok: false, duvod: 'POLE_PLATFORMY', error: 'pole patří platformě, ne klientovi', pole: k };
    if (!POVOLENA_POLE['/v1/chat/completions'].includes(k)) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: `neznámé pole '${k}'` };
  }
  if (typeof t.model !== 'string' || t.model.length === 0) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'chybí model' };
  if (t.model.includes('/')) return { ok: false, duvod: 'POLE_PLATFORMY', error: 'prostor jmen modelu určuje platforma', pole: 'model' };
  const zpravy = t.messages;
  const zpravaOk = (m: unknown) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    const r = m as Record<string, unknown>;
    return Object.keys(r).every((k) => k === 'role' || k === 'content') && ROLE_CHATU.includes(String(r.role)) && typeof r.content === 'string';
  };
  if (!Array.isArray(zpravy) || zpravy.length === 0 || !zpravy.every(zpravaOk)) {
    return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: `messages musí být neprázdné pole {role: ${ROLE_CHATU.join('|')}, content: text}`, pole: 'messages' };
  }
  if (t.n !== undefined && t.n !== 1) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'n smí být jen 1', pole: 'n' };
  if (t.stream !== undefined && typeof t.stream !== 'boolean') return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'stream je boolean', pole: 'stream' };
  for (const k of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) {
    if (t[k] !== undefined && (typeof t[k] !== 'number' || !Number.isFinite(t[k]))) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: `${k} je číslo`, pole: k };
  }
  if (t.seed !== undefined && !Number.isInteger(t.seed)) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'seed je celé číslo', pole: 'seed' };
  if (t.stop !== undefined && !(typeof t.stop === 'string' || (Array.isArray(t.stop) && t.stop.length <= 4 && t.stop.every((x) => typeof x === 'string')))) {
    return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'stop je text nebo nejvýš 4 texty', pole: 'stop' };
  }
  const strop = maxTokenu(t.model);
  if (strop === undefined) return { ok: true, alias: t.model, telo: { ...t }, proud: t.stream === true };
  if (t.max_tokens !== undefined && (!Number.isInteger(t.max_tokens) || (t.max_tokens as number) < 1)) return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: 'max_tokens je kladné celé číslo', pole: 'max_tokens' };
  if ((t.max_tokens as number | undefined) !== undefined && (t.max_tokens as number) > strop) {
    return { ok: false, duvod: 'POZADAVEK_NEPLATNY', error: `max_tokens ${t.max_tokens} je nad stropem aliasu ${strop}`, pole: 'max_tokens' };
  }
  return { ok: true, alias: t.model, telo: { ...t, max_tokens: t.max_tokens ?? strop }, proud: t.stream === true };
}
