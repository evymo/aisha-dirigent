import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
// ⛔ 2026-08-19: config svc-pki-bridge je nově fail-closed (adresa se NEHÁDÁ)
// a hází už při importu. Test proto svoje vstupy DEKLARUJE — testovacím tvarem,
// ne jménem žádné instance — a importuje až PO nich (statický import se zvedá
// nad kód, dynamický ne).
process.env.KEYCLOAK_INTERNAL_URL ??= 'http://testinst-keycloak:80';
process.env.KEYCLOAK_URL ??= 'http://testinst-keycloak:80';
process.env.KEYCLOAK_REALM ??= 'testrealm';
const { calculateHmac } = await import('../../../services/svc-pki-bridge/src/openxpki-rpc');

describe('svc-pki-bridge OpenXPKI HMAC contract', () => {
  test('calculates HMAC over CSR DER payload, not raw PEM text', () => {
    const secret = 'test-shared-secret';
    const csrPem = [
      '-----BEGIN CERTIFICATE REQUEST-----',
      'AQIDBAU=',
      '-----END CERTIFICATE REQUEST-----',
      '',
    ].join('\n');

    const expectedDerHmac = createHmac('sha256', secret)
      .update(Buffer.from([1, 2, 3, 4, 5]))
      .digest('hex');
    const rawPemHmac = createHmac('sha256', secret).update(csrPem).digest('hex');

    expect(calculateHmac(csrPem, secret)).toBe(expectedDerHmac);
    expect(calculateHmac(csrPem, secret)).not.toBe(rawPemHmac);
  });
});
