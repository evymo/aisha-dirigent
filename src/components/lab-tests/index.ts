/**
 * Lab Tests Components
 *
 * Components for displaying lab test recommendations, panels, and orders.
 *
 * @module components/lab-tests
 *
 * @example
 * ```tsx
 * import {
 *   LabTestRecommendations,
 *   LabTestCard,
 *   LabTestPanel,
 *   LabTestOrderSummary,
 * } from '@/components/lab-tests';
 *
 * function MyLabTestsPage() {
 *   return (
 *     <LabTestRecommendations
 *       products={['demo-product-1', 'demo-product-3']}
 *       conditions={['diabetes']}
 *       onSubmitOrder={(tests) => console.log('Ordered:', tests)}
 *     />
 *   );
 * }
 * ```
 */

export { LabTestCard } from "./LabTestCard";
export { LabTestPanel } from "./LabTestPanel";
export { LabTestOrderSummary } from "./LabTestOrderSummary";
export { LabTestRecommendations } from "./LabTestRecommendations";
