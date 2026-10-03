import { describe, expect, it } from 'vitest';
import { num } from '../config.js';

/**
 * Prázdná hodnota v prostředí znamená „nenastaveno", ne „nula".
 *
 * ⛔ `Number('')` NENÍ `NaN`, je to `0` — a `?? default` hlídá jen `undefined`.
 * Klíč deklarovaný s prázdnou hodnotou (v `.env` běžný stav) tak dal nulu:
 * `WS_MAX_TOPICS=` = nula témat, `WS_GATEWAY_PORT=` = port 0. Táž třída
 * jako `SPA_OTP_SKEW` ve `svc-knock` (PR #335), naměřeno 2026-09-10.
 */
describe('num(): prázdno je „nenastaveno", ne nula', () => {
  it('⛔ prázdný řetězec vrací VÝCHOZÍ hodnotu, ne 0', () => {
    expect(num('', 50)).toBe(50);
  });
  it('⛔ samé mezery jsou taky prázdno', () => {
    expect(num('   ', 3002)).toBe(3002);
  });
  it('nenastavená proměnná vrací výchozí hodnotu', () => {
    expect(num(undefined, 30000)).toBe(30000);
  });
  /** ⭐ Hranice: výslovnou nulu napsal člověk. Stráž `if (!n)` by ji zahodila — tenhle test ji chytí. */
  it('⭐ výslovná nula ZŮSTÁVÁ nulou', () => {
    expect(num('0', 5)).toBe(0);
  });
  it('nečíselná hodnota vrací výchozí', () => {
    expect(num('abc', 3)).toBe(3);
  });
  it('platné číslo projde beze změny', () => {
    expect(num('42', 3)).toBe(42);
  });
});
