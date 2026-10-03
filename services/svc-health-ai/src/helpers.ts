import { config } from './config.js';

// ── PII Redaction ──

export function redactText(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL-REDACTED]')
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded quantifiers + optional non-repeating groups: linear, no ambiguous quantified loop
    .replace(/\b(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)?\d{3}[ .-]?\d{3,4}\b/g, '[PHONE-REDACTED]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ID-REDACTED]');
}

export function parseCustomRedactions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length >= 2 && v.length <= 120);
  const deduplicated = Array.from(new Set(normalized.map((v) => v.toLowerCase())));
  return deduplicated.slice(0, 50);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyCustomRedactions(input: string, customTerms: string[]): string {
  if (customTerms.length === 0) return input;
  let result = input;
  for (const term of customTerms) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- term is regex-escaped (escapeRegExp) and length-clamped 2-120, max 50 terms
    const pattern = new RegExp(escapeRegExp(term), 'gi');
    result = result.replace(pattern, '[CUSTOM-REDACTED]');
  }
  return result;
}

export function redactWithCustomTerms(input: string, customTerms: string[]): string {
  return applyCustomRedactions(redactText(input), customTerms);
}

export function clampText(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

// ── SHA-256 ──

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Wearable Heuristic Insights ──

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function buildHeuristicInsights(aggregates: Record<string, unknown>): string[] {
  const insights: string[] = [];
  const stepsAvg = safeNumber(aggregates.steps_avg);
  const sleepAvg = safeNumber(aggregates.sleep_hours_avg);
  const hrAvg = safeNumber(aggregates.heart_rate_avg);
  const activeMinutesTotal = safeNumber(aggregates.activity_minutes_total);
  const samples = safeNumber(aggregates.samples);

  if (samples === 0) {
    insights.push('No wearable samples were available for this sync batch.');
    return insights;
  }

  if (stepsAvg >= 8000) insights.push('Average daily step count indicates strong activity.');
  else if (stepsAvg >= 5000) insights.push('Average daily step count indicates moderate activity.');
  else insights.push('Average daily step count indicates low activity.');

  if (sleepAvg >= 7) insights.push('Average sleep duration is within recommended range.');
  else if (sleepAvg > 0) insights.push('Average sleep duration appears below recommended range.');

  if (hrAvg >= 0) {
    if (hrAvg > 100) insights.push('Average heart rate is elevated and should be reviewed in context.');
    else if (hrAvg >= 50 && hrAvg <= 90) insights.push('Average heart rate is within a typical resting range.');
  }

  if (activeMinutesTotal > 0) {
    insights.push('Active minutes were captured in this sync batch.');
  }

  return insights;
}

// ── AI System Prompt ──

export const HEALTH_DOCUMENT_SYSTEM_PROMPT = `You are a medical document analysis assistant. Analyze health documents and extract structured information.

Your task is to:
1. Identify the type of document (lab results, imaging report, prescription, etc.)
2. Extract key medical data points (values, dates, diagnoses, medications, etc.)
3. Provide a brief summary in plain language
4. Identify any notable findings or insights
5. Suggest relevant categories/tags

IMPORTANT: 
- Be factual and objective
- Do not provide medical advice
- Flag any values that appear outside normal ranges
- Use ISO date formats where applicable
- Extract numerical values with their units

Respond in JSON format with the following structure:
{
  "document_type": "string",
  "summary": "string (plain language summary, max 200 words)",
  "test_date": "YYYY-MM-DD or null",
  "lab_name": "string or null",
  "extracted_data": {},
  "insights": [],
  "categories": ["array", "of", "relevant", "tags"],
  "confidence": "high|medium|low"
}`;
