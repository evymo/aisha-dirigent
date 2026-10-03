/**
 * Mode ladder (rollout contract): off → shadow → warn → enforce.
 *
 *   off      SDK is a pass-through; zero behavioural change (No Regressions).
 *   shadow   Envelopes are built, logged and validated; failures only counted.
 *   warn     As shadow, plus invalid traffic is loudly logged with rejection codes.
 *   enforce  Invalid traffic is rejected / dead-lettered; signatures required.
 *
 * Global default via ACS_MODE; per-message-type override via ACS_MODE_OVERRIDES
 * (JSON, e.g. {"acs.task.assign@1.0":"enforce"}). Unknown values fail closed to
 * "off" at parse time with a warning callback — a typo must not accidentally
 * enforce (nor accidentally disable an explicitly enforced type: overrides are
 * validated strictly).
 */
export type AcsMode = 'off' | 'shadow' | 'warn' | 'enforce';

const MODES: readonly AcsMode[] = ['off', 'shadow', 'warn', 'enforce'];

export interface ModeConfig {
  globalMode: AcsMode;
  overrides: Readonly<Record<string, AcsMode>>;
}

export function parseModeConfig(
  env: NodeJS.ProcessEnv = process.env,
  onConfigError: (detail: string) => void = () => {},
): ModeConfig {
  const rawGlobal = (env['ACS_MODE'] ?? 'off').trim().toLowerCase();
  let globalMode: AcsMode = 'off';
  if ((MODES as readonly string[]).includes(rawGlobal)) {
    globalMode = rawGlobal as AcsMode;
  } else if (rawGlobal !== '') {
    onConfigError(`ACS_MODE="${rawGlobal}" is not one of ${MODES.join('|')} — falling back to "off"`);
  }

  const overrides: Record<string, AcsMode> = {};
  const rawOverrides = env['ACS_MODE_OVERRIDES'];
  if (rawOverrides) {
    try {
      const parsed = JSON.parse(rawOverrides) as Record<string, unknown>;
      for (const [ref, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && (MODES as readonly string[]).includes(value)) {
          overrides[ref] = value as AcsMode;
        } else {
          onConfigError(`ACS_MODE_OVERRIDES["${ref}"]="${String(value)}" invalid — ignored`);
        }
      }
    } catch {
      onConfigError('ACS_MODE_OVERRIDES is not valid JSON — ignored entirely');
    }
  }
  return { globalMode, overrides };
}

export function modeFor(config: ModeConfig, schemaRef: string): AcsMode {
  return config.overrides[schemaRef] ?? config.globalMode;
}

export const modeAtLeast = (mode: AcsMode, floor: AcsMode): boolean =>
  MODES.indexOf(mode) >= MODES.indexOf(floor);
