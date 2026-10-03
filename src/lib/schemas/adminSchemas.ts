/**
 * Admin Schemas — barrel re-export from domain sub-modules
 *
 * All schemas have been split into domain-specific files under ./admin/
 * for better maintainability and readability.
 *
 * Sub-modules:
 * - adminCoreSchemas: profile, roles, questionnaires, translations, helpers
 * - adminProductionSchemas: batches, workflows, vials, milestones, logs, labels
 * - adminStudySchemas: studies, consultants, contributions, consent items
 * - adminCommerceSchemas: products, orders, payments, subscriptions, distribution
 * - adminMiscSchemas: notifications, test questions, partners, archive
 */

export * from "./admin";
