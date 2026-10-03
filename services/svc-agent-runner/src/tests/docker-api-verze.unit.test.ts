import { describe, expect, it } from 'vitest';
import { dockerApiSegment } from '../docker-api-verze.js';

describe('dockerApiSegment — verze Docker API jako segment cesty', () => {
  it('zápis doktora prostředí (konvence Dockeru, bez „v“) dá platný segment', () => {
    // Naměřeno 2026-09-30: `/1.45/networks` → Docker 404 „page not found“.
    expect(dockerApiSegment('1.45')).toBe('v1.45');
  });

  it('zápis s „v“ (výchozí v compose) zůstane', () => {
    expect(dockerApiSegment('v1.46')).toBe('v1.46');
  });

  it('okolní mezery z env nevadí', () => {
    expect(dockerApiSegment(' 1.45\n')).toBe('v1.45');
  });

  it.each(['', 'v', 'latest', '1', '1.45.0', 'vv1.45', '/v1.45'])('„%s“ není verze → chyba při startu', (raw) => {
    expect(() => dockerApiSegment(raw)).toThrow(/DOCKER_API_VERSION/);
  });
});
