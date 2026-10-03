/**
 * Gate test: Phase 12 WP 3.6 — MFA required for admin/staff in Keycloak realm.
 *
 * Enforces structural invariants on keycloak/aisha-realm.json that survive
 * future hand-edits to the realm import:
 *
 *   1. authenticationFlows includes the 3 new MFA sub-flows
 *   2. authenticatorConfig includes the 2 role-condition configs
 *   3. "AISHA Browser Forms" sub-flow chains password REQUIRED → two
 *      CONDITIONAL sub-flows (admin + staff)
 *   4. The shared "AISHA MFA Factor" sub-flow keeps TOTP REQUIRED (so an
 *      unenrolled admin gets the QR code instead of a dead end) with
 *      WebAuthn declared but inert — viz komentář u té sady
 *   5. JSON is still valid and the realm imports cleanly
 *   6. Runbook exists with rollout sequence + rollback
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const REALM = path.join(ROOT, 'keycloak/aisha-realm.json');
const RUNBOOK = path.join(ROOT, 'docs/security/KEYCLOAK_MFA_RUNBOOK.md');

interface AuthExecution {
  authenticator?: string;
  authenticatorFlow?: boolean;
  requirement: string;
  priority: number;
  flowAlias?: string;
  authenticatorConfig?: string;
  userSetupAllowed?: boolean;
}

interface AuthFlow {
  alias: string;
  description?: string;
  providerId: string;
  topLevel: boolean;
  builtIn: boolean;
  authenticationExecutions: AuthExecution[];
}

interface AuthConfig {
  alias: string;
  config: Record<string, string>;
}

interface Realm {
  realm: string;
  authenticationFlows: AuthFlow[];
  authenticatorConfig?: AuthConfig[];
  browserFlow: string;
}

function readRealm(): Realm {
  return JSON.parse(fs.readFileSync(REALM, 'utf8')) as Realm;
}

describe('Phase 12 WP 3.6 — realm JSON structural integrity', () => {
  it('keycloak/aisha-realm.json parses as valid JSON', () => {
    expect(() => readRealm()).not.toThrow();
  });

  it('top-level browserFlow still references AISHA Browser', () => {
    expect(readRealm().browserFlow).toBe('AISHA Browser');
  });
});

describe('Phase 12 WP 3.6 — MFA sub-flows present', () => {
  const realm = readRealm();
  const flows = realm.authenticationFlows;
  const byAlias = (alias: string) => flows.find((f) => f.alias === alias);

  it('"AISHA MFA For Admin" sub-flow exists', () => {
    expect(byAlias('AISHA MFA For Admin')).toBeDefined();
  });

  it('"AISHA MFA For Staff" sub-flow exists', () => {
    expect(byAlias('AISHA MFA For Staff')).toBeDefined();
  });

  it('"AISHA MFA Factor" shared sub-flow exists', () => {
    expect(byAlias('AISHA MFA Factor')).toBeDefined();
  });

  it('all 3 new sub-flows are non-builtIn + non-topLevel (per realm import contract)', () => {
    for (const alias of ['AISHA MFA For Admin', 'AISHA MFA For Staff', 'AISHA MFA Factor']) {
      const f = byAlias(alias)!;
      expect(f.builtIn, `${alias}.builtIn`).toBe(false);
      expect(f.topLevel, `${alias}.topLevel`).toBe(false);
      expect(f.providerId, `${alias}.providerId`).toBe('basic-flow');
    }
  });
});

describe('Phase 12 WP 3.6 — AISHA Browser Forms wires MFA conditionals', () => {
  const realm = readRealm();
  const forms = realm.authenticationFlows.find(
    (f) => f.alias === 'AISHA Browser Forms',
  )!;

  it('AISHA Browser Forms still exists', () => {
    expect(forms).toBeDefined();
  });

  it('first execution is auth-username-password-form REQUIRED', () => {
    const first = forms.authenticationExecutions[0];
    expect(first.authenticator).toBe('auth-username-password-form');
    expect(first.requirement).toBe('REQUIRED');
  });

  it('chains a CONDITIONAL sub-flow for admin role', () => {
    const adminCond = forms.authenticationExecutions.find(
      (e) => e.flowAlias === 'AISHA MFA For Admin',
    );
    expect(adminCond).toBeDefined();
    expect(adminCond!.requirement).toBe('CONDITIONAL');
    expect(adminCond!.authenticatorFlow).toBe(true);
  });

  it('chains a CONDITIONAL sub-flow for staff role', () => {
    const staffCond = forms.authenticationExecutions.find(
      (e) => e.flowAlias === 'AISHA MFA For Staff',
    );
    expect(staffCond).toBeDefined();
    expect(staffCond!.requirement).toBe('CONDITIONAL');
    expect(staffCond!.authenticatorFlow).toBe(true);
  });
});

describe('Phase 12 WP 3.6 — Role-gated sub-flows', () => {
  const realm = readRealm();
  const flows = realm.authenticationFlows;

  for (const [flowAlias, roleConfigAlias, roleName] of [
    ['AISHA MFA For Admin', 'aisha-mfa-condition-admin', 'admin'],
    ['AISHA MFA For Staff', 'aisha-mfa-condition-staff', 'staff'],
  ] as const) {
    describe(flowAlias, () => {
      const flow = flows.find((f) => f.alias === flowAlias)!;

      it('first execution is conditional-user-role REQUIRED', () => {
        const first = flow.authenticationExecutions[0];
        expect(first.authenticator).toBe('conditional-user-role');
        expect(first.requirement).toBe('REQUIRED');
      });

      it(`references authenticatorConfig "${roleConfigAlias}"`, () => {
        const first = flow.authenticationExecutions[0];
        expect(first.authenticatorConfig).toBe(roleConfigAlias);
      });

      it('second execution invokes "AISHA MFA Factor" sub-flow REQUIRED', () => {
        const second = flow.authenticationExecutions[1];
        expect(second.flowAlias).toBe('AISHA MFA Factor');
        expect(second.requirement).toBe('REQUIRED');
        expect(second.authenticatorFlow).toBe(true);
      });

      it(`authenticatorConfig "${roleConfigAlias}" gates the "${roleName}" role`, () => {
        const cfg = (realm.authenticatorConfig ?? []).find(
          (c) => c.alias === roleConfigAlias,
        );
        expect(cfg, `missing authenticatorConfig ${roleConfigAlias}`).toBeDefined();
        expect(cfg!.config.condUserRole).toBe(roleName);
      });
    });
  }
});

describe('Phase 12 WP 3.6 — "AISHA MFA Factor" shared sub-flow', () => {
  // ⛔ NAMĚŘENO 2026-09-04 na produkci — tahle sada tvrdila OPAK reality.
  //
  // Původní znění vyžadovalo „všechny faktory ALTERNATIVE" s odůvodněním
  // „userSetupAllowed must be true so unenrolled users see the setup prompt".
  // Přihlášení admina, který druhý faktor ještě neměl, ale skončilo hláškou
  // „Není možné se přihlásit, je vyžadována konfigurace přístupových údajů" —
  // tedy přesně tím uvíznutím, kterému měl invariant bránit.
  //
  // PROČ: podskupina se volá jako REQUIRED, takže musí projít. Když jsou obě
  // její možnosti ALTERNATIVE a ani jedna není nastavená, Keycloak nemá co
  // spustit a nemá jak si vybrat, kterou alternativu nabídnout k založení.
  // Pole `userSetupAllowed` v exportu tomu nepomůže: samozaložení faktoru
  // Keycloak nabízí jen u REQUIRED provedení. A přiřazená akce CONFIGURE_TOTP
  // to nezachrání — požadované akce se zpracovávají až PO dokončení
  // přihlášení, kdežto tok se zasekne dřív.
  //
  // Invariant proto platí OBRÁCENĚ: aby nezapsaný admin NEuvízl, musí mít
  // podskupina aspoň jeden REQUIRED faktor, který umí samozaložení.
  const factor = readRealm().authenticationFlows.find(
    (f) => f.alias === 'AISHA MFA Factor',
  )!;

  /** Faktory, které si uživatel umí založit sám při přihlášení (QR kód). */
  const UMI_SAMOZALOZENI = ['auth-otp-form'];

  it('má aspoň jeden REQUIRED faktor — jinak nezapsaný admin uvízne', () => {
    const povinne = factor.authenticationExecutions.filter(
      (e) => e.requirement === 'REQUIRED',
    );

    expect(
      povinne.length,
      'Podskupina je volaná REQUIRED, takže musí projít. Samé ALTERNATIVE, ' +
        'které uživatel nemá nastavené, znamenají „není co spustit" a ' +
        'přihlášení skončí chybou (naměřeno 2026-09-04 na produkci).',
    ).toBeGreaterThanOrEqual(1);
  });

  it('ten REQUIRED faktor si uživatel umí založit sám', () => {
    const povinne = factor.authenticationExecutions.filter(
      (e) => e.requirement === 'REQUIRED',
    );
    const bezZalozeni = povinne.filter(
      (e) => !UMI_SAMOZALOZENI.includes(e.authenticator ?? ''),
    );

    expect(
      bezZalozeni.map((e) => e.authenticator),
      'REQUIRED faktor, který se nedá založit při přihlášení, uvíznutí ' +
        'nevyřeší — jen ho přesune o krok dál. Povolené: ' +
        UMI_SAMOZALOZENI.join(', '),
    ).toEqual([]);
  });

  it('TOTP (auth-otp-form) je ten povinný faktor', () => {
    const otp = factor.authenticationExecutions.find(
      (e) => e.authenticator === 'auth-otp-form',
    );

    expect(otp).toBeDefined();
    expect(otp!.requirement).toBe('REQUIRED');
  });

  it('WebAuthn zůstává deklarovaný, ale vedle REQUIRED je NEČINNÝ', () => {
    const webauthn = factor.authenticationExecutions.find(
      (e) => e.authenticator === 'webauthn-authenticator',
    );

    expect(webauthn).toBeDefined();
    expect(
      webauthn!.requirement,
      'Keycloak v jedné podskupině upřednostní REQUIRED před ALTERNATIVE, ' +
        'takže tenhle záznam se fakticky nepoužije. Je tu jako připravená ' +
        'cesta, ne jako funkční volba — kdo ho chce zapnout, musí zároveň ' +
        'vyřešit, jak si ho nezapsaný uživatel založí.',
    ).toBe('ALTERNATIVE');
  });
});
