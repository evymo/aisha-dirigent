/** Dirigent (conductor) daily rate in CZK — same as specialist 4h block */
export const CONDUCTOR_DAY_RATE = 13_000;

/** Base monthly token cost per AI agent in CZK */
export const BASE_AGENT_TOKEN_COST = 8_000;

/** Maximum volume discount (30%) applied when 10+ agents are used */
export const VOLUME_DISCOUNT_MAX = 0.30;

/** Working hours per month (standard) */
export const HOURS_PER_MONTH = 160;

/** Default hourly rate in CZK for "no team" traditional comparison */
export const DEFAULT_HOURLY_RATE = 1_200;

/** Default project duration in months for "no team" mode */
export const DEFAULT_PROJECT_MONTHS = 6;

/** Conductor setup days per role in "no team" mode */
export const CONDUCTOR_DAYS_PER_ROLE = 2.5;

/** Conductor days factor per person-month in "has team" mode */
export const CONDUCTOR_DAYS_FACTOR = 0.4;

/** U-curve parameters for capacity boost calculation */
export const U_CURVE = {
  /** Maximum boost at extremes (conservative/creative poles) */
  maxBoost: 75,
  /** Amplitude of the U-curve dip in the middle */
  amplitude: 35,
  /** Threshold below which the team is considered "conservative" */
  conservativeThreshold: 45,
  /** Threshold above which the team is considered "creative" */
  creativeThreshold: 70,
  /** Threshold below which training recommendation is shown */
  trainingThreshold: 50,
} as const;

// ---------------------------------------------------------------------------
// Marketplace / Specialist Revenue Model
// ---------------------------------------------------------------------------

/** Standard consultation block in hours (= 1 day) */
export const SPECIALIST_BLOCK_HOURS = 4;

/** Default specialist hourly rate derived from block rate (13 000 / 4 = 3 250) */
export const DEFAULT_SPECIALIST_HOURLY_RATE = CONDUCTOR_DAY_RATE / SPECIALIST_BLOCK_HOURS;

/** Revenue splits — PROJECT work (specialist-heavy) */
export const PROJECT_SPLIT = {
  specialist: 0.70,
  knowledge: 0.20,
  platform: 0.10,
} as const;

/** Revenue splits — MAINTENANCE work (platform-heavy) */
export const MAINTENANCE_SPLIT = {
  specialist: 0.10,
  knowledge: 0.20,
  platform: 0.70,
} as const;
